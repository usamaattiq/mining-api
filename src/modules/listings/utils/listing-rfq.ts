import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { RfqOfferSummary, RfqSnapshot } from '../../../integrations/rfq/rfq.types';
import { listingRepository } from '../repositories/listing.repository';
import type {
  ListingDto,
  ListingRfqDto,
  ListingRfqOfferDto,
  ListingWithMedia,
} from '../types/listing.types';

function mapOffer(offer: RfqOfferSummary): ListingRfqOfferDto {
  return {
    id: String(offer.id),
    responderId: String(offer.responder_id ?? offer.responderId ?? ''),
    responderName: '',
    status: offer.status,
    ...(offer.price != null ? { price: String(offer.price) } : {}),
  };
}

export function toListingRfqDto(snapshot: RfqSnapshot): ListingRfqDto {
  const ownerOffers = (snapshot.offers ?? []).map(mapOffer);
  const myOffers = (snapshot.my_offers ?? []).map(mapOffer);
  const offers = ownerOffers.length > 0 ? ownerOffers : undefined;
  const offersCount = ownerOffers.length || myOffers.length || undefined;
  const myOffer =
    snapshot.my_offers?.find((offer) =>
      ['active', 'selected', 'confirmed'].includes(offer.status),
    ) ?? snapshot.my_offers?.[0];
  return {
    id: snapshot.id,
    status: snapshot.status,
    statusLabel: snapshot.status_label,
    statusVariant: snapshot.status_variant,
    expiresAt: snapshot.expires_at ? new Date(snapshot.expires_at).getTime() : null,
    ...(offersCount !== undefined ? { offersCount } : {}),
    canSubmitOffer: snapshot.actions?.can_submit_offer,
    canDecideOffers: snapshot.actions?.can_select,
    ...(myOffer
      ? {
          myOfferStatus: myOffer.status,
          myOfferPrice: myOffer.price != null ? String(myOffer.price) : undefined,
        }
      : {}),
    ...(offers ? { offers } : {}),
  };
}

export function withRfq(listing: ListingDto, snapshot: RfqSnapshot | undefined): ListingDto {
  if (listing.category === 'gold') return listing;
  if (!snapshot) return listing;
  return { ...listing, rfq: toListingRfqDto(snapshot) };
}

function fallbackSnapshot(rfqId: string): RfqSnapshot {
  return {
    id: rfqId,
    status: 'live',
    status_label: 'Live',
    status_variant: 'accent',
    actions: { can_submit_offer: true },
  };
}

export async function attachRfqStatuses(
  listings: ListingDto[],
  rows: ListingWithMedia[],
  viewerId: string,
): Promise<ListingDto[]> {
  const byListingId = new Map(
    rows
      .filter((row) => row.category !== 'gold' && row.rfqId)
      .map((row) => [row.id, row.rfqId as string]),
  );
  if (byListingId.size === 0) return listings;

  const snapshots = rfqClient.isConfigured()
    ? await rfqClient.getSnapshots([...byListingId.values()], viewerId)
    : new Map<string, RfqSnapshot>();

  return listings.map((listing) => {
    const rfqId = byListingId.get(listing.id);
    if (!rfqId) return listing;
    return withRfq(listing, snapshots.get(rfqId) ?? fallbackSnapshot(rfqId));
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
