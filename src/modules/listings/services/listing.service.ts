import type { Prisma } from '@prisma/client';
import { runInTransaction } from '../../../common/database/transaction';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { rfqClient, RfqApiError } from '../../../integrations/rfq/rfq.client';
import { inboxRepository } from '../../notifications/repositories/inbox.repository';
import { notifyService } from '../../notifications/services/notify.service';
import { listingRepository } from '../repositories/listing.repository';
import type { ListingDto } from '../types/listing.types';
import { attachRfqStatuses, createListingRfq, withRfq } from '../utils/listing-rfq';
import { toListingDto } from '../utils/listing.mapper';
import type {
  CreateListingBody,
  ListFeedQuery,
  ListListingsQuery,
  SubmitListingOfferBody,
} from '../validation/listing.schema';

function epochToDate(value: number | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return new Date(value);
}

function listingCreateData(ownerId: string, input: CreateListingBody): Prisma.ListingCreateInput {
  const media = {
    create: input.media.map((item, index) => ({
      ...(item.id ? { id: item.id } : {}),
      uri: item.uri,
      kind: item.kind,
      name: item.name,
      key: item.key,
      sortOrder: index,
    })),
  };

  if (input.category === 'equipment') {
    return {
      owner: { connect: { id: ownerId } },
      category: 'equipment',
      title: input.title,
      description: input.description,
      location: input.location,
      equipmentMode: input.mode,
      equipmentTypeLabel: input.equipmentTypeLabel,
      hourlyRental: input.hourlyRental,
      monthlyRental: input.monthlyRental,
      weeklyRental: input.weeklyRental,
      salePrice: input.salePrice,
      units: input.units,
      deliveryAvailable: input.deliveryAvailable,
      deliveryType: input.deliveryType,
      deliveryPricePerKm: input.deliveryPricePerKm,
      postedAs: input.postedAs,
      media,
    };
  }

  if (input.category === 'services') {
    return {
      owner: { connect: { id: ownerId } },
      category: 'services',
      title: input.title,
      description: input.description,
      location: input.serviceType === 'onsite' ? input.location : '',
      serviceType: input.serviceType,
      serviceCategoryLabel: input.serviceCategoryLabel,
      yearsOfExperience: input.yearsOfExperience,
      price: input.price,
      serviceDate: epochToDate(input.serviceDate),
      postedAs: input.postedAs,
      media,
    };
  }

  return {
    owner: { connect: { id: ownerId } },
    category: 'gold',
    title: input.title,
    description: input.description,
    location: input.location,
    weight: input.weight,
    purityLabel: input.purityLabel,
    price: input.price,
    auctionEndDate: epochToDate(input.auctionEndDate),
    postedAs: input.postedAs,
    media,
  };
}

class ListingService {
  async create(ownerId: string, input: CreateListingBody): Promise<ListingDto> {
    const listing = await runInTransaction(async (tx) => {
      const created = await listingRepository.create(listingCreateData(ownerId, input), tx);
      await inboxRepository.create(
        {
          userId: ownerId,
          titleKey: 'notifications.listingLiveTitle',
          bodyKey: 'notifications.listingLiveBody',
          icon: 'checkmark-circle-outline',
          target: 'Requests',
          listingId: created.id,
        },
        tx,
      );
      return created;
    });

    void notifyService
      .notifyUser({
        userId: ownerId,
        title: 'Listing is live',
        body: `"${listing.title}" is now visible to buyers.`,
        deepLink: `miningmobile://listing/${listing.category}/${listing.id}`,
        data: { listingId: listing.id, category: listing.category },
        idempotencyKey: `listing-live-${listing.id}`,
      })
      .catch(() => undefined);

    const { listing: withRfqRow, snapshot } = await createListingRfq(listing);
    return withRfq(toListingDto(withRfqRow), snapshot);
  }

  async listMine(ownerId: string, query: ListListingsQuery): Promise<ListingDto[]> {
    const rows = await listingRepository.findMine({
      ownerId,
      postedAs: query.postedAs,
      category: query.category,
    });
    return attachRfqStatuses(rows.map(toListingDto), rows, ownerId);
  }

  async listFeed(viewerId: string, query: ListFeedQuery): Promise<ListingDto[]> {
    const rows = await listingRepository.findFeed({
      postedAs: query.postedAs,
      excludeOwnerId: viewerId,
      category: query.category,
    });
    return attachRfqStatuses(rows.map(toListingDto), rows, viewerId);
  }

  async getById(id: string, viewerId: string): Promise<ListingDto> {
    const listing = await listingRepository.findById(id);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    const [dto] = await attachRfqStatuses([toListingDto(listing)], [listing], viewerId);
    return dto;
  }

  async submitOffer(
    listingId: string,
    viewerId: string,
    input: SubmitListingOfferBody,
  ): Promise<ListingDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.category === 'gold' || !listing.rfqId) {
      throw new AppError(
        'Offers are not available for this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (listing.ownerId === viewerId) {
      throw new AppError('You cannot offer on your own listing', 400, ErrorCode.FORBIDDEN);
    }
    if (listing.postedAs !== 'supplier') {
      throw new AppError(
        'Only supplier listings accept buyer offers',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    try {
      await rfqClient.submitOffer({
        rfqId: listing.rfqId,
        responderId: viewerId,
        price: Number(input.price),
        capacityMode: 'full',
      });
    } catch (error) {
      if (error instanceof RfqApiError) {
        const detail =
          error.body && typeof error.body === 'object' && 'detail' in error.body
            ? String((error.body as { detail: unknown }).detail)
            : 'Could not submit offer';
        throw new AppError(
          detail,
          error.status >= 400 && error.status < 500 ? error.status : 400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      throw error;
    }

    return this.getById(listingId, viewerId);
  }
}

export const listingService = new ListingService();
