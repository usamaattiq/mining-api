import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { runInTransaction } from '../../../common/database/transaction';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { auctionClient } from '../../../integrations/auction/auction.client';
import { rfqClient, RfqApiError } from '../../../integrations/rfq/rfq.client';
import { inboxRepository } from '../../notifications/repositories/inbox.repository';
import { notifyService } from '../../notifications/services/notify.service';
import { listingRepository } from '../repositories/listing.repository';
import type { ListingDto } from '../types/listing.types';
import {
  attachRfqStatuses,
  attachedRfqIdsForViewer,
  auctionSnapshotToRfq,
  createListingRfq,
  snapshotHasAttachedOffer,
  withRfq,
} from '../utils/listing-rfq';
import { notifyListingRfq } from '../utils/listing-rfq-notify';
import {
  availableUnitsFor,
  isSupplierEquipment,
  resolveDealKind,
  withEquipmentAvailability,
} from '../utils/equipment-stock';
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

const SUPPLIER_EQUIPMENT_LISTING_MS = 365 * 24 * 60 * 60 * 1000;

function supplierEquipmentStillListed(listing: {
  category: string;
  postedAs: string;
  createdAt: Date;
}): boolean {
  if (listing.category !== 'equipment' || listing.postedAs !== 'supplier') return true;
  return Date.now() - listing.createdAt.getTime() < SUPPLIER_EQUIPMENT_LISTING_MS;
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
      yearlyRental: input.yearlyRental,
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
    if (input.category === 'gold') {
      if (!(await auctionClient.isReachable())) {
        throw new AppError('Auction service is down', 503, ErrorCode.INTERNAL_ERROR);
      }
    } else if (!(await rfqClient.isReachable())) {
      throw new AppError('RFQ Management System Down', 503, ErrorCode.INTERNAL_ERROR);
    }

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

    const expiryHours =
      input.category === 'equipment' || input.category === 'services'
        ? input.expiryHours
        : undefined;
    const schedule =
      input.category === 'gold'
        ? {
            startsAt: input.auctionStartDate ?? null,
            endsAt: input.auctionEndDate ?? null,
            startingAmount: Number(input.price) || 1,
          }
        : undefined;
    const { listing: withRfqRow, snapshot } = await createListingRfq(
      listing,
      expiryHours,
      schedule,
    );
    const [withStock] = await withEquipmentAvailability(
      [withRfq(toListingDto(withRfqRow), snapshot)],
      ownerId,
    );
    return withStock ?? withRfq(toListingDto(withRfqRow), snapshot);
  }

  async listMine(ownerId: string, query: ListListingsQuery): Promise<ListingDto[]> {
    const rows = (
      await listingRepository.findMine({
        ownerId,
        postedAs: query.postedAs,
        category: query.category,
      })
    ).filter(supplierEquipmentStillListed);
    return withEquipmentAvailability(
      await attachRfqStatuses(rows.map(toListingDto), rows, ownerId),
      ownerId,
    );
  }

  async listFeed(viewerId: string, query: ListFeedQuery): Promise<ListingDto[]> {
    const rows = (
      await listingRepository.findFeed({
        postedAs: query.postedAs,
        excludeOwnerId: viewerId,
        category: query.category,
      })
    ).filter(supplierEquipmentStillListed);
    const listings = await withEquipmentAvailability(
      await attachRfqStatuses(rows.map(toListingDto), rows, viewerId),
      viewerId,
    );
    const [hideRfqIds, hideAuctionIds] = await Promise.all([
      attachedRfqIdsForViewer(viewerId),
      attachedAuctionIdsForViewer(viewerId),
    ]);
    const offeredEquipment = new Set(
      (
        await prisma.equipmentHold.findMany({
          where: { buyerId: viewerId, status: { in: ['pending', 'selected', 'active'] } },
          select: { listingId: true },
        })
      ).map((hold) => hold.listingId),
    );
    return listings.filter((listing) => {
      if (!('rfq' in listing) || listing.rfq?.status !== 'live') return false;
      if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
        return !offeredEquipment.has(listing.id);
      }
      if (listing.category === 'gold') return !hideAuctionIds.has(listing.rfq.id);
      return !hideRfqIds.has(listing.rfq.id);
    });
  }

  async listMyOffers(viewerId: string): Promise<ListingDto[]> {
    let snapshots: Awaited<ReturnType<typeof rfqClient.listForResponder>> = [];
    if (rfqClient.isConfigured()) {
      try {
        snapshots = await rfqClient.listForResponder(viewerId);
      } catch {
        snapshots = [];
      }
    }
    const auctionSnapshots = auctionClient.isConfigured()
      ? await auctionClient.listForParticipant(viewerId).catch(() => [])
      : [];
    const attachedAuctions = auctionSnapshots
      .map(auctionSnapshotToRfq)
      .filter(snapshotHasAttachedOffer);
    const attached = snapshots.filter(snapshotHasAttachedOffer);
    const linked = [...attached, ...attachedAuctions];
    const localHolds = await prisma.equipmentHold.findMany({
      where: { buyerId: viewerId, status: { in: ['pending', 'selected', 'active'] } },
      select: { listingId: true },
    });
    if (linked.length === 0 && localHolds.length === 0) return [];
    const rows = await listingRepository.findOffered({
      listingIds: [
        ...linked
          .map((snapshot) => snapshot.external_ref)
          .filter((id): id is string => Boolean(id)),
        ...localHolds.map((hold) => hold.listingId),
      ],
      rfqIds: linked.map((snapshot) => snapshot.id),
    });
    const listings = await withEquipmentAvailability(
      await attachRfqStatuses(rows.map(toListingDto), rows, viewerId),
      viewerId,
    );
    return listings.filter((listing) => {
      if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
        return Boolean(listing.rfq?.myOfferId);
      }
      return true;
    });
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
    const named = await withOfferNames(dto);
    const [withStock] = await withEquipmentAvailability([named], viewerId);
    return withStock ?? named;
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
    if (listing.ownerId === viewerId) {
      throw new AppError('You cannot offer on your own listing', 400, ErrorCode.FORBIDDEN);
    }
    if (isSupplierEquipment(listing)) {
      return this.submitEquipmentOffer(listing, viewerId, input);
    }
    if (!listing.rfqId) {
      throw new AppError(
        'Offers are not available for this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    try {
      const catalogUnits = Math.max(listing.units ?? 1, 1);
      const available =
        listing.category === 'equipment'
          ? await availableUnitsFor(listing.id, catalogUnits)
          : catalogUnits;
      if (listing.category === 'equipment' && available < 1) {
        throw new AppError('No units left on this listing', 400, ErrorCode.VALIDATION_ERROR);
      }
      const units =
        listing.category === 'equipment'
          ? Math.min(Math.max(input.units ?? 1, 1), available)
          : undefined;
      if (
        isSupplierEquipment(listing) &&
        listing.equipmentMode === 'both' &&
        input.fulfillment !== 'rent' &&
        input.fulfillment !== 'sale'
      ) {
        throw new AppError('Choose rent or sale for this offer', 400, ErrorCode.VALIDATION_ERROR);
      }
      if (listing.category === 'equipment' && (input.units ?? 1) > available) {
        throw new AppError(
          `Only ${available} units are still available`,
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const unitPrice = Number(input.price);
      const totalPrice = units != null ? Math.round(unitPrice * units * 100) / 100 : unitPrice;
      if (listing.category === 'gold') {
        const amount = Math.round(totalPrice);
        if (!Number.isFinite(amount) || amount < 1) {
          throw new AppError('Enter a bid of at least 1', 400, ErrorCode.VALIDATION_ERROR);
        }
        await auctionClient.placeBid(listing.rfqId, viewerId, amount);
      } else {
        await rfqClient.submitOffer({
          rfqId: listing.rfqId,
          responderId: viewerId,
          price: totalPrice,
          capacityMode: 'partial',
          offeredQuantity: units ?? 1,
        });
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
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
    if (isSupplierEquipment(listing)) {
      return this.decideEquipmentOffer(listing, viewerId, offerId, action);
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
      if (listing.category === 'gold') {
        const snapshot = auctionSnapshotToRfq(
          await auctionClient.getSnapshot(listing.rfqId, viewerId),
        );
        const offer = (snapshot.offers ?? []).find((row) => String(row.id) === offerId);
        responderId = offer ? String(offer.responder_id ?? offer.responderId ?? '') : undefined;
        if (action === 'select') {
          await auctionClient.ownerAction(listing.rfqId, viewerId, 'select-next');
        } else if (action === 'reject') {
          await auctionClient.ownerAction(listing.rfqId, viewerId, 'close');
        } else {
          await auctionClient.participantAction(listing.rfqId, viewerId, action);
        }
      } else {
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
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
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

  async listEquipmentStock(listingId: string, viewerId: string) {
    const listing = await requireSupplierEquipment(listingId, viewerId);
    const holds = await prisma.equipmentHold.findMany({
      where: { listingId, status: { in: ['selected', 'active', 'returned'] } },
      include: { buyer: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const active = holds.filter((hold) => hold.status === 'active' || hold.status === 'selected');
    const reserved = active.reduce((sum, hold) => sum + hold.units, 0);
    const totalUnits = Math.max(listing.units ?? 1, 1);
    return {
      totalUnits,
      availableUnits: Math.max(0, totalUnits - reserved),
      rentUnits: active
        .filter((hold) => hold.kind === 'rent')
        .reduce((sum, hold) => sum + hold.units, 0),
      saleUnits: active
        .filter((hold) => hold.kind === 'sale')
        .reduce((sum, hold) => sum + hold.units, 0),
      holds: holds.map((hold) => ({
        id: hold.id,
        kind: hold.kind,
        units: hold.units,
        status: hold.status,
        buyerName: hold.buyer.fullName,
        createdAt: hold.createdAt.getTime(),
      })),
    };
  }

  async remove(listingId: string, viewerId: string): Promise<void> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.ownerId !== viewerId) {
      throw new AppError('Only the listing owner can delete it', 403, ErrorCode.FORBIDDEN);
    }
    await listingRepository.archive(listingId);
  }

  async updateEquipmentUnits(listingId: string, viewerId: string, units: number) {
    const listing = await requireSupplierEquipment(listingId, viewerId);
    const holds = await prisma.equipmentHold.findMany({
      where: { listingId, status: { in: ['selected', 'active'] } },
      select: { units: true },
    });
    const reserved = holds.reduce((sum, hold) => sum + hold.units, 0);
    if (units < reserved) {
      throw new AppError(
        'Units cannot be less than those already rented or sold',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    await listingRepository.setUnits(listing.id, units);
    return this.listEquipmentStock(listingId, viewerId);
  }

  async returnRentedUnits(listingId: string, holdId: string, viewerId: string) {
    await requireSupplierEquipment(listingId, viewerId);
    const hold = await prisma.equipmentHold.findFirst({
      where: { id: holdId, listingId, kind: 'rent', status: 'active' },
    });
    if (!hold) {
      throw new AppError('Rented units were not found', 404, ErrorCode.NOT_FOUND);
    }
    await prisma.equipmentHold.update({
      where: { id: hold.id },
      data: { status: 'returned' },
    });
    return this.listEquipmentStock(listingId, viewerId);
  }

  private async submitEquipmentOffer(
    listing: NonNullable<Awaited<ReturnType<typeof listingRepository.findById>>>,
    viewerId: string,
    input: SubmitListingOfferBody,
  ): Promise<ListingDto> {
    if (!listing.equipmentMode) {
      throw new AppError('This listing cannot take offers', 400, ErrorCode.VALIDATION_ERROR);
    }
    if (
      listing.equipmentMode === 'both' &&
      input.fulfillment !== 'rent' &&
      input.fulfillment !== 'sale'
    ) {
      throw new AppError('Choose rent or sale for this offer', 400, ErrorCode.VALIDATION_ERROR);
    }
    const open = await prisma.equipmentHold.findFirst({
      where: {
        listingId: listing.id,
        buyerId: viewerId,
        status: { in: ['pending', 'selected', 'active'] },
      },
    });
    if (open) {
      throw new AppError(
        'You already have an offer on this listing',
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const totalUnits = Math.max(listing.units ?? 1, 1);
    const available = await availableUnitsFor(listing.id, totalUnits);
    const units = Math.max(input.units ?? 1, 1);
    if (available < 1 || units > available) {
      throw new AppError(
        available < 1
          ? 'No units left on this listing'
          : `Only ${available} units are still available`,
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const unitPrice = Number(input.price);
    const totalPrice = Math.round(unitPrice * units * 100) / 100;
    const offerId = crypto.randomUUID();
    await prisma.equipmentHold.create({
      data: {
        listingId: listing.id,
        offerId,
        buyerId: viewerId,
        kind: resolveDealKind(listing.equipmentMode, input.fulfillment),
        units,
        price: String(totalPrice),
        status: 'pending',
      },
    });
    notifyListingRfq(
      listing.ownerId,
      'New offer received',
      `Someone submitted an offer on "${listing.title}".`,
      listing,
      `equipment-offer:${offerId}`,
    );
    return this.getById(listing.id, viewerId);
  }

  private async decideEquipmentOffer(
    listing: NonNullable<Awaited<ReturnType<typeof listingRepository.findById>>>,
    viewerId: string,
    offerId: string,
    action: 'select' | 'reject' | 'confirm' | 'decline' | 'withdraw',
  ): Promise<ListingDto> {
    const hold = await prisma.equipmentHold.findFirst({
      where: { offerId, listingId: listing.id },
    });
    if (!hold) {
      throw new AppError('Offer not found', 404, ErrorCode.NOT_FOUND);
    }
    const ownerAction = action === 'select' || action === 'reject';
    if (ownerAction && listing.ownerId !== viewerId) {
      throw new AppError('Only the listing owner can decide offers', 403, ErrorCode.FORBIDDEN);
    }
    if (!ownerAction && hold.buyerId !== viewerId) {
      throw new AppError('Only the buyer can update this offer', 403, ErrorCode.FORBIDDEN);
    }
    if (action === 'select') {
      if (hold.status !== 'pending') {
        throw new AppError('This offer can no longer be accepted', 400, ErrorCode.VALIDATION_ERROR);
      }
      const available = await availableUnitsFor(listing.id, Math.max(listing.units ?? 1, 1));
      if (available < 1 || hold.units > available) {
        throw new AppError(
          available < 1 ? 'No units available' : 'Less units available',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      await prisma.equipmentHold.update({ where: { id: hold.id }, data: { status: 'selected' } });
      notifyListingRfq(
        hold.buyerId,
        'You were selected',
        `Your offer on "${listing.title}" was selected. Confirm to proceed.`,
        listing,
        `equipment-select:${hold.id}`,
      );
    } else if (action === 'reject' && hold.status === 'pending') {
      await prisma.equipmentHold.update({ where: { id: hold.id }, data: { status: 'rejected' } });
    } else if (action === 'confirm' && hold.status === 'selected') {
      await prisma.equipmentHold.update({ where: { id: hold.id }, data: { status: 'active' } });
      notifyListingRfq(
        listing.ownerId,
        'Offer confirmed',
        `An offer on "${listing.title}" was confirmed.`,
        listing,
        `equipment-confirm:${hold.id}`,
      );
    } else if (action === 'decline' && hold.status === 'selected') {
      await prisma.equipmentHold.update({ where: { id: hold.id }, data: { status: 'declined' } });
    } else if (action === 'withdraw' && hold.status === 'pending') {
      await prisma.equipmentHold.update({ where: { id: hold.id }, data: { status: 'withdrawn' } });
    } else {
      throw new AppError('This offer can no longer be updated', 400, ErrorCode.VALIDATION_ERROR);
    }
    return this.getById(listing.id, viewerId);
  }
}

async function requireSupplierEquipment(listingId: string, viewerId: string) {
  const listing = await listingRepository.findById(listingId);
  if (!listing || listing.status !== 'ACTIVE' || !isSupplierEquipment(listing)) {
    throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
  }
  if (listing.ownerId !== viewerId) {
    throw new AppError('Only the listing owner can manage units', 403, ErrorCode.FORBIDDEN);
  }
  return listing;
}

async function attachedAuctionIdsForViewer(viewerId: string): Promise<Set<string>> {
  if (!auctionClient.isConfigured()) return new Set();
  try {
    const snapshots = await auctionClient.listForParticipant(viewerId);
    return new Set(
      snapshots
        .map(auctionSnapshotToRfq)
        .filter(snapshotHasAttachedOffer)
        .map((snapshot) => snapshot.id),
    );
  } catch {
    return new Set();
  }
}

export const listingService = new ListingService();
