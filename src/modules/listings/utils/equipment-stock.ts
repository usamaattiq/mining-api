import { prisma } from '../../../common/database/prisma';
import type { EquipmentListingDto, ListingDto, ListingRfqDto } from '../types/listing.types';

const RESERVED = ['selected', 'active'] as const;
const OPEN_OFFER = ['pending', 'selected', 'active'] as const;

export type EquipmentDealKind = 'rent' | 'sale';

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

export async function reservedUnitsByListing(listingIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (listingIds.length === 0) return map;
  const rows = await prisma.equipmentHold.groupBy({
    by: ['listingId'],
    where: { listingId: { in: listingIds }, status: { in: [...RESERVED] } },
    _sum: { units: true },
  });
  for (const row of rows) {
    map.set(row.listingId, row._sum.units ?? 0);
  }
  return map;
}

export async function availableUnitsFor(listingId: string, totalUnits: number): Promise<number> {
  const reserved = await reservedUnitsByListing([listingId]);
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
          where: { listingId: { in: ids }, status: { in: [...OPEN_OFFER, 'returned'] } },
          include: { buyer: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        });
  return listings.map((listing) => {
    if (listing.category !== 'equipment') return listing;
    const available = Math.max(0, listing.units - (reserved.get(listing.id) ?? 0));
    if (!isSupplierEquipment(listing)) {
      return { ...listing, availableUnits: available };
    }
    const mine = holds.find(
      (hold) =>
        hold.listingId === listing.id &&
        hold.buyerId === viewerId &&
        OPEN_OFFER.includes(hold.status as (typeof OPEN_OFFER)[number]),
    );
    const visible = holds.filter(
      (hold) =>
        hold.listingId === listing.id && ['pending', 'selected', 'active'].includes(hold.status),
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
      canConfirmOffer: mine?.status === 'selected',
      canDeclineOffer: mine?.status === 'selected',
      canWithdrawOffer: mine?.status === 'pending',
      ...(mine
        ? {
            myOfferId: mine.offerId,
            myOfferStatus: offerStatus(mine.status),
            myOfferPrice: mine.price || undefined,
            myOfferQuantity: mine.units,
            myOfferKind: mine.kind,
          }
        : {}),
      offers: visible.map((hold) => ({
        id: hold.offerId,
        responderId: hold.buyerId,
        responderName: hold.buyer.fullName,
        status: offerStatus(hold.status),
        price: hold.price || undefined,
        quantity: hold.units,
        kind: hold.kind,
      })),
    };
    return { ...listing, availableUnits: available, rfq: localRfq };
  });
}
