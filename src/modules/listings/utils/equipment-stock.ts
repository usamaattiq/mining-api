import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { RfqOfferSummary } from '../../../integrations/rfq/rfq.types';
import type { EquipmentListingDto, ListingDto, ListingRfqDto } from '../types/listing.types';

const RESERVED = ['selected', 'active'] as const;
const REQUEST_RESERVED = new Set(['active', 'pending', 'selected', 'confirmed']);
const OPEN_OFFER = ['pending', 'selected', 'active'] as const;
const VISIBLE_OFFER = ['pending', 'selected', 'active', 'declined'] as const;

export type EquipmentDealKind = 'rent' | 'sale';

export function confirmedOfferUnits(
  offers: Array<RfqOfferSummary | { status?: string; quantity?: number }> | undefined,
): number {
  return (offers ?? [])
    .filter((offer) => offer.status === 'confirmed' || offer.status === 'completed')
    .reduce((sum, offer) => {
      const raw = 'offered_quantity' in offer ? offer.offered_quantity : undefined;
      const quantity = raw ?? ('quantity' in offer ? offer.quantity : undefined);
      return sum + Math.max(Number(quantity) || 1, 1);
    }, 0);
}

/** Confirmed units are only listed on the owner's RFQ snapshot, not on another supplier's. */
export async function confirmedUnitsForBuyerRequests(
  listings: ListingDto[],
): Promise<Map<string, number>> {
  const filled = new Map<string, number>();
  const requests = listings.filter(
    (listing): listing is EquipmentListingDto =>
      listing.category === 'equipment' &&
      listing.postedAs === 'buyer' &&
      listing.requestMode !== 'auction' &&
      Boolean(listing.rfq?.id && listing.ownerId),
  );
  await Promise.all(
    requests.map(async (listing) => {
      const rfqId = listing.rfq?.id;
      if (!rfqId) return;
      try {
        const snapshot = await rfqClient.getSnapshot(rfqId, listing.ownerId);
        const fromOwner = confirmedOfferUnits(snapshot.offers);
        const fromViewer = confirmedOfferUnits(listing.rfq?.offers);
        filled.set(listing.id, Math.max(fromOwner, fromViewer));
      } catch {
        filled.set(listing.id, confirmedOfferUnits(listing.rfq?.offers));
      }
    }),
  );
  return filled;
}

export function buyerRequestUnitSplit(listing: {
  units: number;
  rfq?: { offers?: { status: string; quantity?: number }[] };
}): { reserved: number; filled: number; available: number } {
  let reserved = 0;
  let filled = 0;
  for (const offer of listing.rfq?.offers ?? []) {
    const units = Math.max(offer.quantity ?? 1, 1);
    if (REQUEST_RESERVED.has(offer.status)) reserved += units;
    if (offer.status === 'confirmed') filled += units;
  }
  const total = Math.max(listing.units, 1);
  return {
    reserved,
    filled,
    available: Math.max(0, total - filled),
  };
}

export function isSupplierEquipment(listing: { category: string; postedAs: string }): boolean {
  return listing.category === 'equipment' && listing.postedAs === 'supplier';
}

export function resolveDealKind(
  mode: 'rent' | 'sell' | 'both',
  requested: EquipmentDealKind | undefined,
): EquipmentDealKind {
  if (mode === 'rent') return 'rent';
  if (mode === 'sell') return 'sale';
  return requested === 'sale' ? 'sale' : 'rent';
}

export async function reservedUnitsByListing(
  listingIds: string[],
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (listingIds.length === 0) return map;
  const rows = await client.equipmentHold.groupBy({
    by: ['listingId'],
    where: { listingId: { in: listingIds }, status: { in: [...RESERVED] } },
    _sum: { units: true },
  });
  for (const row of rows) {
    map.set(row.listingId, row._sum.units ?? 0);
  }
  return map;
}

/**
 * client defaults to the global prisma singleton, but pass the active
 * `tx` when this check must be atomic with the write that follows it
 * (see runSerializable in common/database/transaction.ts) — otherwise two
 * concurrent requests can both read "units available" before either writes.
 */
export async function availableUnitsFor(
  listingId: string,
  totalUnits: number,
  client: Prisma.TransactionClient = prisma,
): Promise<number> {
  const reserved = await reservedUnitsByListing([listingId], client);
  return Math.max(0, totalUnits - (reserved.get(listingId) ?? 0));
}

/** Supplier equipment RFQs stay open so more buyers can offer against remaining units. */
export function keepSupplierEquipmentOpen(listing: ListingDto, available: number): ListingDto {
  if (listing.category !== 'equipment' || listing.postedAs !== 'supplier' || !listing.rfq) {
    return listing;
  }
  const ended =
    listing.rfq.status === 'completed' ||
    listing.rfq.status === 'closed' ||
    listing.rfq.status === 'expired';
  return {
    ...listing,
    availableUnits: available,
    rfq: {
      ...listing.rfq,
      ...(ended
        ? {
            status: 'live',
            statusLabel: 'Live',
            statusVariant: 'accent' as const,
            expiresAt: null,
          }
        : {}),
      canSubmitOffer: available > 0 ? true : listing.rfq.canSubmitOffer,
      canDecideOffers: listing.rfq.canDecideOffers !== false,
    },
  };
}

function offerStatus(status: string): string {
  if (status === 'pending') return 'active';
  if (status === 'active') return 'confirmed';
  return status;
}

export async function withEquipmentAvailability(
  listings: ListingDto[],
  viewerId?: string,
): Promise<ListingDto[]> {
  const ids = listings
    .filter((listing): listing is EquipmentListingDto => listing.category === 'equipment')
    .map((listing) => listing.id);
  const reserved = await reservedUnitsByListing(ids);
  const holds =
    ids.length === 0
      ? []
      : await prisma.equipmentHold.findMany({
          where: {
            listingId: { in: ids },
            status: { in: [...VISIBLE_OFFER, 'returned'] },
          },
          include: { buyer: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        });
  const confirmedByListing = await confirmedUnitsForBuyerRequests(listings);
  return listings.map((listing) => {
    if (listing.category !== 'equipment') return listing;
    const available = Math.max(0, listing.units - (reserved.get(listing.id) ?? 0));
    if (!isSupplierEquipment(listing)) {
      if (listing.postedAs === 'buyer' && listing.requestMode !== 'auction' && listing.rfq) {
        const filled = confirmedByListing.get(listing.id) ?? buyerRequestUnitSplit(listing).filled;
        const remaining = Math.max(0, listing.units - filled);
        const done = filled >= listing.units;
        return {
          ...listing,
          availableUnits: remaining,
          rfq: {
            ...listing.rfq,
            canSubmitOffer: remaining > 0 && listing.rfq.canSubmitOffer !== false,
            ...(done
              ? {
                  status: 'completed',
                  statusLabel: 'Completed',
                  statusVariant: 'muted' as const,
                  canSubmitOffer: false,
                }
              : {}),
          },
        };
      }
      return { ...listing, availableUnits: available };
    }
    const mineOpen = holds.find(
      (hold) =>
        hold.listingId === listing.id &&
        hold.buyerId === viewerId &&
        OPEN_OFFER.includes(hold.status as (typeof OPEN_OFFER)[number]),
    );
    const mineHistory = holds.filter(
      (hold) =>
        hold.listingId === listing.id && hold.buyerId === viewerId && hold.status === 'returned',
    );
    const mine = mineOpen ?? mineHistory[0];
    const visible = holds.filter(
      (hold) =>
        hold.listingId === listing.id && (VISIBLE_OFFER as readonly string[]).includes(hold.status),
    );
    const localRfq: ListingRfqDto = {
      id: `equipment:${listing.id}`,
      status: 'live',
      statusLabel: 'Live',
      statusVariant: 'accent',
      expiresAt: null,
      offersCount: visible.length,
      canSubmitOffer: available > 0,
      canDecideOffers: true,
      canConfirmOffer: mineOpen?.status === 'selected',
      canDeclineOffer: mineOpen?.status === 'selected',
      canWithdrawOffer: mineOpen?.status === 'pending',
      ...(mine
        ? {
            myOfferId: mine.offerId,
            myOfferStatus: mineOpen ? offerStatus(mine.status) : 'returned',
            myOfferPrice: mine.price || undefined,
            myOfferQuantity: mine.units,
            myOfferKind: mine.kind,
            myOfferHandover: mine.handover,
          }
        : {}),
      offers: [...visible, ...mineHistory].map((hold) => ({
        id: hold.offerId,
        responderId: hold.buyerId,
        responderName: hold.buyer.fullName,
        status: hold.status === 'returned' ? 'returned' : offerStatus(hold.status),
        price: hold.price || undefined,
        quantity: hold.units,
        kind: hold.kind,
        handover: hold.handover,
        createdAt: hold.createdAt.getTime(),
      })),
    };
    return { ...listing, availableUnits: available, rfq: localRfq };
  });
}
