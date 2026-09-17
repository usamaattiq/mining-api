import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
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

function mapRfqError(error: unknown, fallback: string): never {
  if (error instanceof RfqApiError) {
    const detail =
      error.body && typeof error.body === 'object' && 'detail' in error.body
        ? String((error.body as { detail: unknown }).detail)
        : fallback;
    throw new AppError(
      detail,
      error.status >= 400 && error.status < 500 ? error.status : 400,
      ErrorCode.VALIDATION_ERROR,
    );
  }
  throw error;
}

async function withOfferNames(listing: ListingDto): Promise<ListingDto> {
  if (listing.category === 'gold' || !listing.rfq?.offers?.length) return listing;
  const ids = [...new Set(listing.rfq.offers.map((offer) => offer.responderId).filter(Boolean))];
  if (ids.length === 0) return listing;
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.fullName]));
  return {
    ...listing,
    rfq: {
      ...listing.rfq,
      offers: listing.rfq.offers.map((offer) => ({
        ...offer,
        responderName: names.get(offer.responderId) || offer.responderName || 'Buyer',
      })),
    },
  };
}

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
    return withOfferNames(dto);
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
      mapRfqError(error, 'Could not submit offer');
    }

    return this.getById(listingId, viewerId);
  }

  async decideOffer(
    listingId: string,
    ownerId: string,
    offerId: string,
    action: 'accept' | 'reject',
  ): Promise<ListingDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.ownerId !== ownerId) {
      throw new AppError('Only the listing owner can decide offers', 403, ErrorCode.FORBIDDEN);
    }
    if (!listing.rfqId) {
      throw new AppError(
        'Offers are not available for this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    try {
      await rfqClient.decideOffer({
        rfqId: listing.rfqId,
        offerId,
        ownerId,
        action,
      });
    } catch (error) {
      mapRfqError(error, `Could not ${action} offer`);
    }

    return this.getById(listingId, ownerId);
  }
}

export const listingService = new ListingService();
