import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { runInTransaction, runSerializable } from '../../../common/database/transaction';
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
  auctionSnapshotToRfq,
  createListingRfq,
  openRfqIdsForViewer,
  settledRfqIdsForViewer,
  snapshotHasAttachedOffer,
  snapshotHasOpenOffer,
  snapshotHasSettledOffer,
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

async function withOfferSentAt(listing: ListingDto, viewerId: string): Promise<ListingDto> {
  if (!listing.rfq) return listing;
  const stamps = await prisma.$queryRaw<Array<{ responderId: string; sentAt: Date }>>`
    SELECT "responderId", "sentAt" FROM "listing_offer_stamps" WHERE "listingId" = ${listing.id}
  `;
  const sentAt = new Map(
    stamps.map((stamp) => [stamp.responderId, new Date(stamp.sentAt).getTime()]),
  );
  const missing = new Set<string>();
  for (const offer of listing.rfq.offers ?? []) {
    if (offer.createdAt == null && offer.responderId && !sentAt.has(offer.responderId)) {
      missing.add(offer.responderId);
    }
  }
  if (
    listing.rfq.myOfferId &&
    listing.rfq.myOfferCreatedAt == null &&
    viewerId &&
    !sentAt.has(viewerId)
  ) {
    missing.add(viewerId);
  }
  if (missing.size > 0) {
    const now = Date.now();
    for (const responderId of missing) {
      await prisma.$executeRaw`
        INSERT INTO "listing_offer_stamps" ("id", "listingId", "responderId", "sentAt")
        VALUES (${crypto.randomUUID()}, ${listing.id}, ${responderId}, NOW())
        ON CONFLICT ("listingId", "responderId") DO NOTHING
      `;
      sentAt.set(responderId, now);
    }
  }
  if (sentAt.size === 0) return listing;
  const offers = listing.rfq.offers?.map((offer) =>
    offer.createdAt != null
      ? offer
      : {
          ...offer,
          ...(sentAt.has(offer.responderId) ? { createdAt: sentAt.get(offer.responderId) } : {}),
        },
  );
  const mine = sentAt.get(viewerId);
  return {
    ...listing,
    rfq: {
      ...listing.rfq,
      ...(offers ? { offers } : {}),
      ...(listing.rfq.myOfferCreatedAt == null && mine != null ? { myOfferCreatedAt: mine } : {}),
    },
  };
}

async function withEquipmentOfferKind(listing: ListingDto, viewerId: string): Promise<ListingDto> {
  if (listing.category !== 'equipment' || listing.postedAs !== 'buyer' || !listing.rfq) {
    return listing;
  }
  const choices = await prisma.equipmentOfferChoice.findMany({
    where: { listingId: listing.id },
    select: { responderId: true, kind: true },
  });
  if (choices.length === 0) return listing;
  const byResponder = new Map(choices.map((choice) => [choice.responderId, choice.kind]));
  const offers = listing.rfq.offers?.map((offer) => {
    const kind = byResponder.get(offer.responderId);
    return kind ? { ...offer, kind } : offer;
  });
  const mine = byResponder.get(viewerId);
  return {
    ...listing,
    rfq: {
      ...listing.rfq,
      ...(offers ? { offers } : {}),
      ...(mine ? { myOfferKind: mine } : {}),
    },
  };
}

async function withServiceDelivery(listing: ListingDto, viewerId: string): Promise<ListingDto> {
  if (listing.category !== 'services' || !listing.rfq) return listing;
  const choices = await prisma.serviceOfferChoice.findMany({
    where: { listingId: listing.id },
    select: { responderId: true, mode: true },
  });
  if (choices.length === 0) return listing;
  const byResponder = new Map(choices.map((choice) => [choice.responderId, choice.mode]));
  const offers = listing.rfq.offers?.map((offer) => {
    const delivery = byResponder.get(offer.responderId);
    return delivery ? { ...offer, delivery } : offer;
  });
  const mine = byResponder.get(viewerId);
  return {
    ...listing,
    rfq: {
      ...listing.rfq,
      ...(offers ? { offers } : {}),
      ...(mine ? { myOfferDelivery: mine } : {}),
    },
  };
}

/** Phones are attached only for a confirmed deal, and only to the two parties. */
async function withDealContactPhones(
  listings: ListingDto[],
  viewerId: string,
): Promise<ListingDto[]> {
  const userIds = new Set<string>();
  for (const listing of listings) {
    const rfq = 'rfq' in listing ? listing.rfq : undefined;
    if (!rfq) continue;
    if (listing.ownerId === viewerId) {
      for (const offer of rfq.offers ?? []) {
        if (offer.status === 'confirmed' && offer.responderId) userIds.add(offer.responderId);
      }
    } else if (
      rfq.myOfferStatus === 'confirmed' ||
      (rfq.offers ?? []).some(
        (offer) => offer.responderId === viewerId && offer.status === 'confirmed',
      )
    ) {
      userIds.add(listing.ownerId);
    }
  }
  if (userIds.size === 0) return listings;
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] }, deletedAt: null },
    select: { id: true, phoneE164: true },
  });
  const phones = new Map(users.map((user) => [user.id, user.phoneE164]));
  return listings.map((listing) => {
    const rfq = 'rfq' in listing ? listing.rfq : undefined;
    if (!rfq) return listing;
    if (listing.ownerId === viewerId) {
      return {
        ...listing,
        rfq: {
          ...rfq,
          offers: rfq.offers?.map((offer) => {
            const phone = offer.status === 'confirmed' ? phones.get(offer.responderId) : undefined;
            return phone ? { ...offer, responderPhone: phone } : offer;
          }),
        },
      };
    }
    const dealOpen = (rfq.offers ?? []).some(
      (offer) => offer.responderId === viewerId && offer.status === 'confirmed',
    );
    if (rfq.myOfferStatus !== 'confirmed' && !dealOpen) {
      return listing;
    }
    const ownerPhone = phones.get(listing.ownerId);
    return ownerPhone ? { ...listing, rfq: { ...rfq, ownerPhone } } : listing;
  });
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

function reservedRequestUnits(
  offers: { status?: string; offered_quantity?: number | string | null }[] | undefined,
): number {
  return (offers ?? [])
    .filter((offer) =>
      ['active', 'pending', 'selected', 'confirmed'].includes(String(offer.status)),
    )
    .reduce((sum, offer) => sum + Math.max(Number(offer.offered_quantity) || 1, 1), 0);
}

function epochToDate(value: number | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return new Date(value);
}

function listingCreateData(
  ownerId: string,
  input: CreateListingBody,
): Omit<Prisma.ListingCreateInput, 'reference'> {
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
      requestMode: input.postedAs === 'buyer' ? input.requestMode : 'rfq',
      auctionEndDate:
        input.postedAs === 'buyer' && input.requestMode === 'auction'
          ? epochToDate(input.auctionEndDate)
          : null,
      serviceDate: epochToDate(input.neededDate),
      media,
    };
  }

  if (input.category === 'services') {
    const onsitePrice =
      input.serviceType === 'online' ? '' : input.onsitePrice || input.price || '';
    const onlinePrice =
      input.serviceType === 'onsite' ? '' : input.onlinePrice || input.price || '';
    return {
      owner: { connect: { id: ownerId } },
      category: 'services',
      title: input.title,
      description: input.description,
      location: input.location,
      serviceType: input.serviceType,
      serviceCategoryLabel: input.serviceCategoryLabel,
      yearsOfExperience: input.yearsOfExperience,
      price: onsitePrice || onlinePrice,
      onsitePrice,
      onlinePrice,
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

function listingReferencePrefix(input: CreateListingBody): 'SEQ' | 'AUC' | 'RFQ' {
  if (input.category === 'equipment' && input.postedAs === 'supplier') return 'SEQ';
  if (input.category === 'gold') return 'AUC';
  if (input.category === 'equipment' && input.requestMode === 'auction') return 'AUC';
  return 'RFQ';
}

async function allocateListingReference(
  tx: Prisma.TransactionClient,
  prefix: 'SEQ' | 'AUC' | 'RFQ',
): Promise<string> {
  const year = new Date().getUTCFullYear();
  await tx.listingReferenceCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, next: 1 },
    update: {},
  });
  const row = await tx.listingReferenceCounter.update({
    where: { prefix_year: { prefix, year } },
    data: { next: { increment: 1 } },
  });
  const sequence = row.next - 1;
  return `${prefix}-${String(year).slice(-2)}-${String(sequence).padStart(4, '0')}`;
}

class ListingService {
  async create(ownerId: string, input: CreateListingBody): Promise<ListingDto> {
    const usesAuction =
      input.category === 'gold' ||
      (input.category === 'equipment' &&
        input.postedAs === 'buyer' &&
        input.requestMode === 'auction');
    const supplierEquipment = input.category === 'equipment' && input.postedAs === 'supplier';
    const usesRfq = !usesAuction && !supplierEquipment;
    if (usesAuction && !(await auctionClient.isReachable())) {
      throw new AppError('Auction service is down', 503, ErrorCode.INTERNAL_ERROR);
    }
    if (usesRfq && !(await rfqClient.isReachable())) {
      throw new AppError('RFQ Management System Down', 503, ErrorCode.INTERNAL_ERROR);
    }

    const listing = await runInTransaction(async (tx) => {
      const reference = await allocateListingReference(tx, listingReferencePrefix(input));
      const created = await listingRepository.create(
        { ...listingCreateData(ownerId, input), reference },
        tx,
      );
      await inboxRepository.create(
        {
          userId: ownerId,
          titleKey:
            input.postedAs === 'buyer'
              ? 'notifications.requestLiveTitle'
              : 'notifications.listingLiveTitle',
          bodyKey: `"${input.title}" is now live.`,
          icon: 'checkmark-circle-outline',
          target: 'Requests',
          listingId: created.id,
        },
        tx,
      );
      return created;
    });

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
        : input.category === 'equipment' && input.requestMode === 'auction'
          ? {
              startsAt: input.auctionStartDate ?? null,
              endsAt: input.auctionEndDate ?? null,
              startingAmount: 1,
            }
          : undefined;
    let withRfqRow = listing;
    let snapshot: Awaited<ReturnType<typeof createListingRfq>>['snapshot'];
    try {
      const created = await createListingRfq(listing, expiryHours, schedule);
      withRfqRow = created.listing;
      snapshot = created.snapshot;
      if ((usesRfq || usesAuction) && !withRfqRow.rfqId) {
        throw new AppError(
          usesAuction ? 'Auction service is down' : 'RFQ Management System Down',
          503,
          ErrorCode.INTERNAL_ERROR,
        );
      }
    } catch (error) {
      await prisma.inAppNotification
        .deleteMany({ where: { listingId: listing.id } })
        .catch(() => undefined);
      await prisma.listing.delete({ where: { id: listing.id } }).catch(() => undefined);
      if (error instanceof AppError) throw error;
      mapRfqError(error, usesAuction ? 'Auction service is down' : 'RFQ Management System Down');
    }

    void notifyService
      .notifyUser({
        userId: ownerId,
        title: 'Your listing is live',
        body: `"${listing.title}" is now live.`,
        deepLink: `miningmobile://listing/${listing.category}/${listing.id}`,
        data: { listingId: listing.id, category: listing.category },
        idempotencyKey: `listing-live-${listing.id}`,
      })
      .catch(() => undefined);

    const [withStock] = await withEquipmentAvailability(
      [withRfq(toListingDto(withRfqRow), snapshot)],
      ownerId,
    );
    return withStock ?? withRfq(toListingDto(withRfqRow), snapshot);
  }

  async update(listingId: string, ownerId: string, input: CreateListingBody): Promise<ListingDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.ownerId !== ownerId) {
      throw new AppError('Only the listing owner can edit it', 403, ErrorCode.FORBIDDEN);
    }
    if (listing.category !== input.category) {
      throw new AppError('Listing category cannot be changed', 400, ErrorCode.VALIDATION_ERROR);
    }

    if (
      listing.category === 'equipment' &&
      listing.postedAs === 'supplier' &&
      input.category === 'equipment'
    ) {
      const holds = await prisma.equipmentHold.findMany({
        where: { listingId, status: { in: ['selected', 'active'] } },
        select: { units: true },
      });
      const reserved = holds.reduce((sum, hold) => sum + hold.units, 0);
      if (input.units < reserved) {
        throw new AppError(
          'Units cannot be less than those already rented or sold',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
    }

    const postedAs = listing.postedAs;
    const draft = listingCreateData(ownerId, { ...input, postedAs });
    const { owner: _owner, media: _media, category: _category, ...fields } = draft;
    await listingRepository.updateContent(
      listing.id,
      fields,
      input.media.map((item, index) => ({
        uri: item.uri,
        kind: item.kind,
        name: item.name,
        key: item.key,
        sortOrder: index,
      })),
    );
    return this.getById(listing.id, ownerId);
  }

  async listMine(ownerId: string, query: ListListingsQuery): Promise<ListingDto[]> {
    const rows = (
      await listingRepository.findMine({
        ownerId,
        postedAs: query.postedAs,
        category: query.category,
      })
    ).filter(supplierEquipmentStillListed);
    return withDealContactPhones(
      await withEquipmentAvailability(
        await attachRfqStatuses(rows.map(toListingDto), rows, ownerId),
        ownerId,
      ),
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
    const [openRfqIds, settledRfqIds, openAuctionIds, settledAuctionIds] = await Promise.all([
      openRfqIdsForViewer(viewerId),
      settledRfqIdsForViewer(viewerId),
      openAuctionIdsForViewer(viewerId),
      settledAuctionIdsForViewer(viewerId),
    ]);
    const equipmentHolds = await prisma.equipmentHold.findMany({
      where: { buyerId: viewerId, status: { in: ['pending', 'selected', 'active'] } },
      select: { listingId: true, status: true },
    });
    const settledEquipment = new Set(
      equipmentHolds.filter((hold) => hold.status === 'active').map((hold) => hold.listingId),
    );
    const openEquipment = new Set(
      equipmentHolds
        .filter((hold) => hold.status === 'pending' || hold.status === 'selected')
        .map((hold) => hold.listingId),
    );
    const viewerOpen = (listing: (typeof listings)[number]): boolean => {
      if (!('rfq' in listing) || !listing.rfq) return false;
      if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
        return openEquipment.has(listing.id);
      }
      if (
        listing.category === 'gold' ||
        (listing.category === 'equipment' && listing.requestMode === 'auction')
      ) {
        return openAuctionIds.has(listing.rfq.id);
      }
      return openRfqIds.has(listing.rfq.id);
    };
    const viewerSettled = (listing: (typeof listings)[number]): boolean => {
      if (!('rfq' in listing) || !listing.rfq) return false;
      if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
        return settledEquipment.has(listing.id);
      }
      if (
        listing.category === 'gold' ||
        (listing.category === 'equipment' && listing.requestMode === 'auction')
      ) {
        return settledAuctionIds.has(listing.rfq.id);
      }
      return settledRfqIds.has(listing.rfq.id);
    };
    return listings
      .filter((listing) => {
        if (!('rfq' in listing) || !listing.rfq) return false;
        if (viewerSettled(listing)) return false;
        if (viewerOpen(listing)) return true;
        return listing.rfq.status === 'live';
      })
      .sort((a, b) => Number(viewerOpen(b)) - Number(viewerOpen(a)));
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
      .map((snapshot) => auctionSnapshotToRfq(snapshot))
      .filter(snapshotHasAttachedOffer);
    const attached = snapshots.filter(snapshotHasAttachedOffer);
    const linked = [...attached, ...attachedAuctions];
    const localHolds = await prisma.equipmentHold.findMany({
      where: {
        buyerId: viewerId,
        status: { in: ['pending', 'selected', 'active', 'returned', 'declined'] },
      },
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
    const visible = listings.filter((listing) => {
      if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
        return Boolean(listing.rfq?.myOfferId);
      }
      return true;
    });
    return withDealContactPhones(visible, viewerId);
  }

  async getById(id: string, viewerId: string): Promise<ListingDto> {
    const listing = await listingRepository.findById(id);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { accountType: true },
    });
    const rfqViewerId = viewer?.accountType === 'ADMIN' ? listing.ownerId : viewerId;
    const [dto] = await attachRfqStatuses([toListingDto(listing)], [listing], rfqViewerId);
    if (!dto) {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    const named = await withOfferNames(dto);
    const withDelivery = await withServiceDelivery(named, viewerId);
    const withKind = await withEquipmentOfferKind(withDelivery, viewerId);
    const [withStock] = await withEquipmentAvailability([withKind], viewerId);
    const [withPhones] = await withDealContactPhones([withStock ?? withKind], viewerId);
    return withOfferSentAt(withPhones ?? withStock ?? withKind, viewerId);
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
      const auctionBid = listing.category === 'gold' || listing.requestMode === 'auction';
      const buyerEquipmentRequest =
        listing.category === 'equipment' && listing.postedAs === 'buyer' && !auctionBid;
      const catalogUnits = Math.max(listing.units ?? 1, 1);
      const buyerSnapshot = buyerEquipmentRequest
        ? await rfqClient.getSnapshot(listing.rfqId, viewerId)
        : undefined;
      const available = auctionBid
        ? catalogUnits
        : buyerEquipmentRequest
          ? Math.max(0, catalogUnits - reservedRequestUnits(buyerSnapshot?.offers))
          : listing.category === 'equipment'
            ? await availableUnitsFor(listing.id, catalogUnits)
            : catalogUnits;
      if (!auctionBid && listing.category === 'equipment' && available < 1) {
        throw new AppError('No units left on this listing', 400, ErrorCode.VALIDATION_ERROR);
      }
      const units = auctionBid
        ? undefined
        : listing.category === 'equipment'
          ? Math.min(Math.max(input.units ?? 1, 1), available)
          : undefined;
      if (
        listing.category === 'equipment' &&
        listing.equipmentMode === 'both' &&
        listing.requestMode !== 'auction' &&
        input.fulfillment !== 'rent' &&
        input.fulfillment !== 'sale'
      ) {
        throw new AppError('Choose rent or sale for this offer', 400, ErrorCode.VALIDATION_ERROR);
      }
      if (
        listing.category === 'services' &&
        listing.serviceType === 'both' &&
        input.delivery !== 'onsite' &&
        input.delivery !== 'online'
      ) {
        throw new AppError(
          'Choose onsite or online for this offer',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      if (!auctionBid && listing.category === 'equipment' && (input.units ?? 1) > available) {
        throw new AppError(
          `Only ${available} units are still available`,
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const unitPrice = Number(input.price);
      const totalPrice = units != null ? Math.round(unitPrice * units * 100) / 100 : unitPrice;
      if (auctionBid) {
        const amount = Math.round(unitPrice);
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
        if (
          listing.category === 'services' &&
          listing.serviceType === 'both' &&
          (input.delivery === 'onsite' || input.delivery === 'online')
        ) {
          await prisma.serviceOfferChoice.upsert({
            where: { listingId_responderId: { listingId: listing.id, responderId: viewerId } },
            create: { listingId: listing.id, responderId: viewerId, mode: input.delivery },
            update: { mode: input.delivery },
          });
        }
        if (
          listing.category === 'equipment' &&
          listing.requestMode !== 'auction' &&
          (input.fulfillment === 'rent' || input.fulfillment === 'sale')
        ) {
          await prisma.equipmentOfferChoice.upsert({
            where: { listingId_responderId: { listingId: listing.id, responderId: viewerId } },
            create: { listingId: listing.id, responderId: viewerId, kind: input.fulfillment },
            update: { kind: input.fulfillment },
          });
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      mapRfqError(error, 'Could not submit offer');
    }

    await prisma.$executeRaw`
      INSERT INTO "listing_offer_stamps" ("id", "listingId", "responderId", "sentAt")
      VALUES (${crypto.randomUUID()}, ${listing.id}, ${viewerId}, NOW())
      ON CONFLICT ("listingId", "responderId") DO NOTHING
    `;

    notifyListingRfq(
      listing.ownerId,
      'New offer',
      `You received an offer on "${listing.title}".`,
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
      if (listing.category === 'gold' || listing.requestMode === 'auction') {
        const snapshot = auctionSnapshotToRfq(
          await auctionClient.getSnapshot(listing.rfqId, viewerId),
        );
        const offer = (snapshot.offers ?? []).find((row) => String(row.id) === offerId);
        responderId = offer ? String(offer.responder_id ?? offer.responderId ?? '') : undefined;
        if (action === 'select') {
          await auctionClient.ownerAction(listing.rfqId, viewerId, 'select-next');
          const after = await auctionClient.getSnapshot(listing.rfqId, viewerId);
          const selected = after.selected_participant_id
            ? String(after.selected_participant_id)
            : undefined;
          responderId = selected ?? responderId;
          await listingRepository.setAuctionSelection(listing.id, {
            participantId: selected ?? null,
            selectedAt: selected ? new Date() : null,
          });
        } else if (action === 'reject') {
          await auctionClient.ownerAction(listing.rfqId, viewerId, 'close');
          await listingRepository.setAuctionSelection(listing.id, {
            participantId: null,
            selectedAt: null,
          });
        } else {
          await auctionClient.participantAction(listing.rfqId, viewerId, action);
          if (action === 'confirm' || action === 'decline') {
            await listingRepository.setAuctionSelection(listing.id, {
              participantId: null,
              selectedAt: null,
            });
          }
        }
      } else {
        const snapshot = await rfqClient.getSnapshot(listing.rfqId, viewerId);
        const offer = [...(snapshot.offers ?? []), ...(snapshot.my_offers ?? [])].find(
          (row) => String(row.id) === offerId,
        );
        responderId = offer ? String(offer.responder_id ?? offer.responderId ?? '') : undefined;
        const buyerEquipmentRequest =
          listing.category === 'equipment' && listing.postedAs === 'buyer';
        if (buyerEquipmentRequest && (action === 'select' || action === 'confirm')) {
          const accepting = Math.max(Number(offer?.offered_quantity) || 1, 1);
          const alreadyFilled = (snapshot.offers ?? [])
            .filter(
              (row) =>
                String(row.id) !== offerId &&
                (row.status === 'selected' || row.status === 'confirmed'),
            )
            .reduce((sum, row) => sum + Math.max(Number(row.offered_quantity) || 1, 1), 0);
          if (alreadyFilled + accepting > Math.max(listing.units ?? 1, 1)) {
            throw new AppError(
              'That offer is more units than this request still needs',
              400,
              ErrorCode.VALIDATION_ERROR,
            );
          }
        }
        await rfqClient.decideOffer({
          rfqId: listing.rfqId,
          offerId,
          actorId: viewerId,
          action,
        });
        if (buyerEquipmentRequest && (action === 'select' || action === 'confirm')) {
          const after = await rfqClient.getSnapshot(listing.rfqId, listing.ownerId);
          const filled = (after.offers ?? [])
            .filter((row) => row.status === 'selected' || row.status === 'confirmed')
            .reduce((sum, row) => sum + Math.max(Number(row.offered_quantity) || 1, 1), 0);
          if (filled >= Math.max(listing.units ?? 1, 1)) {
            await rfqClient.completeRfq(listing.rfqId, listing.ownerId).catch(() => undefined);
          }
        } else if (action === 'confirm') {
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
        'Offer accepted',
        `Your offer on "${listing.title}" was accepted. Confirm to continue.`,
        listing,
        `rfq-select:${offerId}`,
      );
    } else if (action === 'reject' && responderId) {
      notifyListingRfq(
        responderId,
        'Offer declined',
        `Your offer on "${listing.title}" was declined.`,
        listing,
        `rfq-reject:${offerId}`,
      );
    } else if (action === 'confirm') {
      notifyListingRfq(
        listing.ownerId,
        'Offer confirmed',
        `An offer on "${listing.title}" is confirmed.`,
        listing,
        `rfq-confirm:${offerId}`,
      );
    } else if (action === 'decline') {
      notifyListingRfq(
        listing.ownerId,
        'Offer declined',
        `The accepted offer on "${listing.title}" was declined.`,
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
    const listing = await requireSupplierEquipment(listingId, viewerId, { allowAdmin: true });
    const holds = await prisma.equipmentHold.findMany({
      where: { listingId, status: { in: ['selected', 'active', 'returned'] } },
      include: { buyer: { select: { id: true, fullName: true, phoneE164: true } } },
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
        buyerId: hold.buyer.id,
        buyerName: hold.buyer.fullName,
        buyerPhone: hold.buyer.phoneE164,
        price: hold.price,
        createdAt: hold.createdAt.getTime(),
        acceptedAt: hold.acceptedAt?.getTime(),
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

  async updateOffer(
    listingId: string,
    viewerId: string,
    offerId: string,
    input: {
      price: string;
      units?: number;
      fulfillment?: 'rent' | 'sale';
      delivery?: 'onsite' | 'online';
      handover?: 'pickup' | 'delivery';
    },
  ): Promise<ListingDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (!isSupplierEquipment(listing)) {
      if (!listing.rfqId) {
        throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
      }
      if (listing.ownerId === viewerId) {
        throw new AppError('The listing owner cannot update this offer', 400, ErrorCode.FORBIDDEN);
      }
      if (listing.category === 'gold' || listing.requestMode === 'auction') {
        throw new AppError(
          'Update this bid from the auction input',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const unitPrice = Number(input.price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new AppError('Enter a valid amount', 400, ErrorCode.VALIDATION_ERROR);
      }
      if (
        listing.category === 'services' &&
        listing.serviceType === 'both' &&
        input.delivery !== 'onsite' &&
        input.delivery !== 'online'
      ) {
        throw new AppError(
          'Choose onsite or online for this offer',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      if (
        listing.category === 'equipment' &&
        listing.equipmentMode === 'both' &&
        input.fulfillment !== 'rent' &&
        input.fulfillment !== 'sale'
      ) {
        throw new AppError('Choose rent or sale for this offer', 400, ErrorCode.VALIDATION_ERROR);
      }
      const buyerEquipmentRequest =
        listing.category === 'equipment' && listing.postedAs === 'buyer';
      const nextUnits = Math.max(input.units ?? 1, 1);
      if (buyerEquipmentRequest) {
        const snapshot = await rfqClient.getSnapshot(listing.rfqId, viewerId);
        const others = (snapshot.offers ?? []).filter((row) => String(row.id) !== offerId);
        const available = Math.max(
          0,
          Math.max(listing.units ?? 1, 1) - reservedRequestUnits(others),
        );
        if (available < 1 || nextUnits > available) {
          throw new AppError(
            available < 1
              ? 'No units left on this request'
              : `Only ${available} units are still available`,
            400,
            ErrorCode.VALIDATION_ERROR,
          );
        }
      }
      try {
        try {
          await rfqClient.updateOffer(listing.rfqId, offerId, viewerId, unitPrice);
        } catch {
          await rfqClient.submitOffer({
            rfqId: listing.rfqId,
            responderId: viewerId,
            price: unitPrice,
            ...(listing.category === 'equipment' ? { offeredQuantity: nextUnits } : {}),
          });
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        mapRfqError(error, 'Could not update offer');
      }
      if (
        listing.category === 'services' &&
        listing.serviceType === 'both' &&
        (input.delivery === 'onsite' || input.delivery === 'online')
      ) {
        await prisma.serviceOfferChoice.upsert({
          where: { listingId_responderId: { listingId: listing.id, responderId: viewerId } },
          create: { listingId: listing.id, responderId: viewerId, mode: input.delivery },
          update: { mode: input.delivery },
        });
      }
      if (
        listing.category === 'equipment' &&
        (input.fulfillment === 'rent' || input.fulfillment === 'sale')
      ) {
        await prisma.equipmentOfferChoice.upsert({
          where: { listingId_responderId: { listingId: listing.id, responderId: viewerId } },
          create: { listingId: listing.id, responderId: viewerId, kind: input.fulfillment },
          update: { kind: input.fulfillment },
        });
      }
      return this.getById(listing.id, viewerId);
    }
    await runSerializable(async (tx) => {
      const hold = await tx.equipmentHold.findFirst({
        where: { offerId, listingId: listing.id },
      });
      if (!hold || hold.buyerId !== viewerId) {
        throw new AppError('Offer not found', 404, ErrorCode.NOT_FOUND);
      }
      if (hold.status !== 'pending') {
        throw new AppError('This offer can no longer be updated', 400, ErrorCode.VALIDATION_ERROR);
      }
      const totalUnits = Math.max(listing.units ?? 1, 1);
      const available = await availableUnitsFor(listing.id, totalUnits, tx);
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
      const kind = listing.equipmentMode
        ? resolveDealKind(listing.equipmentMode, input.fulfillment ?? hold.kind)
        : hold.kind;
      if (kind !== hold.kind) {
        const openSameKind = await tx.equipmentHold.findFirst({
          where: {
            listingId: listing.id,
            buyerId: viewerId,
            kind,
            status: { in: ['pending', 'selected'] },
            NOT: { id: hold.id },
          },
        });
        if (openSameKind) {
          throw new AppError(
            'You already have an open offer of this type',
            400,
            ErrorCode.VALIDATION_ERROR,
          );
        }
      }
      const handover = listing.deliveryAvailable
        ? input.handover === 'delivery' || input.handover === 'pickup'
          ? input.handover
          : hold.handover
        : 'pickup';
      const unitPrice = Number(input.price);
      const totalPrice = Math.round(unitPrice * units * 100) / 100;
      await tx.equipmentHold.update({
        where: { id: hold.id },
        data: { units, price: String(totalPrice), kind, handover },
      });
    });
    return this.getById(listing.id, viewerId);
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
    const kind = resolveDealKind(listing.equipmentMode, input.fulfillment);
    const offerId = crypto.randomUUID();
    await runSerializable(async (tx) => {
      const totalUnits = Math.max(listing.units ?? 1, 1);
      const available = await availableUnitsFor(listing.id, totalUnits, tx);
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
      const openSameKind = await tx.equipmentHold.findFirst({
        where: {
          listingId: listing.id,
          buyerId: viewerId,
          kind,
          status: { in: ['pending', 'selected'] },
        },
      });
      if (openSameKind) {
        throw new AppError(
          'You already have an open offer of this type',
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const unitPrice = Number(input.price);
      const totalPrice = Math.round(unitPrice * units * 100) / 100;
      const handover =
        listing.deliveryAvailable && input.handover === 'delivery' ? 'delivery' : 'pickup';
      await tx.equipmentHold.create({
        data: {
          listingId: listing.id,
          offerId,
          buyerId: viewerId,
          kind,
          handover,
          units,
          price: String(totalPrice),
          status: 'pending',
        },
      });
    });
    notifyListingRfq(
      listing.ownerId,
      'New offer',
      `You received an offer on "${listing.title}".`,
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
    const hold = await runSerializable(async (tx) => {
      const hold = await tx.equipmentHold.findFirst({
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
          throw new AppError(
            'This offer can no longer be accepted',
            400,
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const available = await availableUnitsFor(listing.id, Math.max(listing.units ?? 1, 1), tx);
        if (available < 1 || hold.units > available) {
          throw new AppError(
            available < 1 ? 'No units available' : 'Less units available',
            400,
            ErrorCode.VALIDATION_ERROR,
          );
        }
        await tx.equipmentHold.update({
          where: { id: hold.id },
          data: { status: 'selected', acceptedAt: new Date() },
        });
      } else if (action === 'reject' && hold.status === 'pending') {
        await tx.equipmentHold.update({ where: { id: hold.id }, data: { status: 'rejected' } });
      } else if (action === 'confirm' && hold.status === 'selected') {
        await tx.equipmentHold.update({ where: { id: hold.id }, data: { status: 'active' } });
      } else if (action === 'decline' && hold.status === 'selected') {
        await tx.equipmentHold.update({ where: { id: hold.id }, data: { status: 'declined' } });
      } else if (action === 'withdraw' && hold.status === 'pending') {
        await tx.equipmentHold.update({ where: { id: hold.id }, data: { status: 'withdrawn' } });
      } else {
        throw new AppError('This offer can no longer be updated', 400, ErrorCode.VALIDATION_ERROR);
      }
      return hold;
    });

    // hold.status below is the pre-update snapshot — same values the
    // original code branched on, since notifications are a side effect of
    // which branch ran, not of the row's state after the write.
    if (action === 'select') {
      notifyListingRfq(
        hold.buyerId,
        'Offer accepted',
        `Your offer on "${listing.title}" was accepted. Confirm to continue.`,
        listing,
        `equipment-select:${hold.id}`,
      );
    } else if (action === 'reject' && hold.status === 'pending') {
      notifyListingRfq(
        hold.buyerId,
        'Offer declined',
        `Your offer on "${listing.title}" was declined.`,
        listing,
        `equipment-reject:${hold.id}`,
      );
    } else if (action === 'confirm' && hold.status === 'selected') {
      notifyListingRfq(
        listing.ownerId,
        'Offer confirmed',
        `An offer on "${listing.title}" is confirmed.`,
        listing,
        `equipment-confirm:${hold.id}`,
      );
    }
    return this.getById(listing.id, viewerId);
  }
}

async function requireSupplierEquipment(
  listingId: string,
  viewerId: string,
  options?: { allowAdmin?: boolean },
) {
  const listing = await listingRepository.findById(listingId);
  if (!listing || listing.status !== 'ACTIVE' || !isSupplierEquipment(listing)) {
    throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
  }
  if (listing.ownerId !== viewerId) {
    if (options?.allowAdmin) {
      const viewer = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { accountType: true },
      });
      if (viewer?.accountType === 'ADMIN') return listing;
    }
    throw new AppError('Only the listing owner can manage units', 403, ErrorCode.FORBIDDEN);
  }
  return listing;
}

async function auctionIdsForViewer(
  viewerId: string,
  keep: (snapshot: ReturnType<typeof auctionSnapshotToRfq>) => boolean,
): Promise<Set<string>> {
  if (!auctionClient.isConfigured()) return new Set();
  try {
    const snapshots = await auctionClient.listForParticipant(viewerId);
    return new Set(
      snapshots
        .map((snapshot) => auctionSnapshotToRfq(snapshot))
        .filter(keep)
        .map((snapshot) => snapshot.id),
    );
  } catch {
    return new Set();
  }
}

function openAuctionIdsForViewer(viewerId: string): Promise<Set<string>> {
  return auctionIdsForViewer(viewerId, snapshotHasOpenOffer);
}

function settledAuctionIdsForViewer(viewerId: string): Promise<Set<string>> {
  return auctionIdsForViewer(viewerId, snapshotHasSettledOffer);
}

export const listingService = new ListingService();
