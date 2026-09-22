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
import {
  attachRfqStatuses,
  attachedRfqIdsForViewer,
  createListingRfq,
  snapshotHasAttachedOffer,
  withRfq,
} from '../utils/listing-rfq';
import { notifyListingRfq } from '../utils/listing-rfq-notify';
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
  if (!('rfq' in listing) || !listing.rfq?.offers?.length) return listing;
  const offers = listing.rfq.offers;
  const ids = [...new Set(offers.map((offer) => offer.responderId).filter(Boolean))];
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
      offers: offers.map((offer) => ({
        ...offer,
        responderName: names.get(offer.responderId) || offer.responderName || '—',
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
      serviceDate: epochToDate(input.neededDate),
      media,
    };
  }

  if (input.category === 'services') {
    return {
      owner: { connect: { id: ownerId } },
      category: 'services',
      title: input.title,
      description: input.description,
      location: input.serviceType === 'online' ? '' : input.location,
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
    const listings = await attachRfqStatuses(rows.map(toListingDto), rows, viewerId);
    const hideRfqIds = await attachedRfqIdsForViewer(viewerId);
    return listings.filter((listing) => {
      if (!('rfq' in listing) || !listing.rfq) return true;
      return !hideRfqIds.has(listing.rfq.id);
    });
  }

  async listMyOffers(viewerId: string): Promise<ListingDto[]> {
    if (!rfqClient.isConfigured()) return [];
    let snapshots: Awaited<ReturnType<typeof rfqClient.listForResponder>> = [];
    try {
      snapshots = await rfqClient.listForResponder(viewerId);
    } catch {
      return [];
    }
    const attached = snapshots.filter(snapshotHasAttachedOffer);
    const rows = await listingRepository.findOffered({
      listingIds: attached
        .map((snapshot) => snapshot.external_ref)
        .filter((id): id is string => Boolean(id)),
      rfqIds: attached.map((snapshot) => snapshot.id),
    });
    return attachRfqStatuses(rows.map(toListingDto), rows, viewerId);
  }

  async getById(id: string, viewerId: string): Promise<ListingDto> {
    const listing = await listingRepository.findById(id);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    const [dto] = await attachRfqStatuses([toListingDto(listing)], [listing], viewerId);
    if (!dto) {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
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
    if (!listing.rfqId) {
      throw new AppError(
        'Offers are not available for this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (listing.ownerId === viewerId) {
      throw new AppError('You cannot offer on your own listing', 400, ErrorCode.FORBIDDEN);
    }

    try {
      const units =
        listing.category === 'equipment'
          ? Math.min(Math.max(input.units ?? 1, 1), Math.max(listing.units ?? 1, 1))
          : undefined;
      const unitPrice = Number(input.price);
      const totalPrice = units != null ? Math.round(unitPrice * units * 100) / 100 : unitPrice;
      await rfqClient.submitOffer({
        rfqId: listing.rfqId,
        responderId: viewerId,
        price: totalPrice,
        capacityMode: 'full',
        ...(units != null ? { offeredQuantity: units } : {}),
      });
    } catch (error) {
      mapRfqError(error, 'Could not submit offer');
    }

    notifyListingRfq(
      listing.ownerId,
      'New offer received',
      `Someone submitted an offer on "${listing.title}".`,
      listing,
      `rfq-offer:${listing.rfqId}:${viewerId}`,
    );

    return this.getById(listingId, viewerId);
  }

  async decideOffer(
    listingId: string,
    viewerId: string,
    offerId: string,
    action: 'select' | 'reject' | 'confirm' | 'decline' | 'withdraw',
  ): Promise<ListingDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (!listing.rfqId) {
      throw new AppError(
        'Offers are not available for this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const ownerAction = action === 'select' || action === 'reject';
    if (ownerAction && listing.ownerId !== viewerId) {
      throw new AppError('Only the listing owner can decide offers', 403, ErrorCode.FORBIDDEN);
    }
    if (!ownerAction && listing.ownerId === viewerId) {
      throw new AppError('The listing owner cannot confirm this offer', 400, ErrorCode.FORBIDDEN);
    }

    let responderId: string | undefined;
    try {
      const snapshot = await rfqClient.getSnapshot(listing.rfqId, viewerId);
      const offer = [...(snapshot.offers ?? []), ...(snapshot.my_offers ?? [])].find(
        (row) => String(row.id) === offerId,
      );
      responderId = offer ? String(offer.responder_id ?? offer.responderId ?? '') : undefined;
      await rfqClient.decideOffer({
        rfqId: listing.rfqId,
        offerId,
        actorId: viewerId,
        action,
      });
      if (action === 'confirm') {
        await rfqClient.completeRfq(listing.rfqId, listing.ownerId).catch(() => undefined);
      }
    } catch (error) {
      mapRfqError(error, `Could not ${action} offer`);
    }

    if (action === 'select' && responderId) {
      notifyListingRfq(
        responderId,
        'You were selected',
        `Your offer on "${listing.title}" was selected. Confirm to proceed.`,
        listing,
        `rfq-select:${offerId}`,
      );
    } else if (action === 'reject' && responderId) {
      notifyListingRfq(
        responderId,
        'Offer rejected',
        `Your offer on "${listing.title}" was not accepted.`,
        listing,
        `rfq-reject:${offerId}`,
      );
    } else if (action === 'confirm') {
      notifyListingRfq(
        listing.ownerId,
        'Offer confirmed',
        `An offer on "${listing.title}" was confirmed.`,
        listing,
        `rfq-confirm:${offerId}`,
      );
    } else if (action === 'decline') {
      notifyListingRfq(
        listing.ownerId,
        'Offer declined',
        `A selected offer on "${listing.title}" was declined.`,
        listing,
        `rfq-decline:${offerId}`,
      );
    } else if (action === 'withdraw') {
      notifyListingRfq(
        listing.ownerId,
        'Offer withdrawn',
        `An offer on "${listing.title}" was withdrawn.`,
        listing,
        `rfq-withdraw:${offerId}`,
      );
    }

    return this.getById(listingId, viewerId);
  }
}

export const listingService = new ListingService();
