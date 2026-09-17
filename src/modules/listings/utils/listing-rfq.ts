import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { RfqSnapshot } from '../../../integrations/rfq/rfq.types';
import { listingRepository } from '../repositories/listing.repository';
import type { ListingDto, ListingRfqDto, ListingWithMedia } from '../types/listing.types';

export function toListingRfqDto(snapshot: RfqSnapshot): ListingRfqDto {
  const offersCount = snapshot.offers?.length ?? snapshot.my_offers?.length ?? undefined;
  const myOffer = snapshot.my_offers?.[0];
  return {
    id: snapshot.id,
    status: snapshot.status,
    statusLabel: snapshot.status_label,
    statusVariant: snapshot.status_variant,
    expiresAt: snapshot.expires_at ? new Date(snapshot.expires_at).getTime() : null,
    ...(offersCount !== undefined ? { offersCount } : {}),
    canSubmitOffer: snapshot.actions?.can_submit_offer,
    ...(myOffer
      ? {
          myOfferStatus: myOffer.status,
          myOfferPrice: myOffer.price != null ? String(myOffer.price) : undefined,
        }
      : {}),
  };
}

export function withRfq(listing: ListingDto, snapshot: RfqSnapshot | undefined): ListingDto {
  if (!snapshot || listing.category === 'gold') return listing;
  return { ...listing, rfq: toListingRfqDto(snapshot) };
}

export async function attachRfqStatuses(
  listings: ListingDto[],
  rows: ListingWithMedia[],
  viewerId: string,
): Promise<ListingDto[]> {
  if (!rfqClient.isConfigured()) return listings;

  const rfqIds = rows
    .filter((row) => row.category !== 'gold' && row.rfqId)
    .map((row) => row.rfqId as string);
  if (rfqIds.length === 0) return listings;

  const snapshots = await rfqClient.getSnapshots(rfqIds, viewerId);
  const byListingId = new Map(rows.map((row) => [row.id, row.rfqId]));

  return listings.map((listing) => {
    const rfqId = byListingId.get(listing.id);
    if (!rfqId) return listing;
    return withRfq(listing, snapshots.get(rfqId));
  });
}

export async function createListingRfq(
  listing: ListingWithMedia,
): Promise<{ listing: ListingWithMedia; snapshot?: RfqSnapshot }> {
  if (!rfqClient.isConfigured()) return { listing };
  if (listing.category !== 'equipment' && listing.category !== 'services') return { listing };

  try {
    const snapshot = await rfqClient.createRfq({
      ownerId: listing.ownerId,
      listingId: listing.id,
      totalQuantity: listing.category === 'equipment' ? Math.max(listing.units ?? 1, 1) : 1,
      enforceCapacityLimit: true,
      expiryHours: 24,
    });
    const updated = await listingRepository.setRfqId(listing.id, snapshot.id);
    return { listing: updated, snapshot };
  } catch (error) {
    console.error('Failed to create RFQ for listing', { listingId: listing.id, error });
    return { listing };
  }
}
