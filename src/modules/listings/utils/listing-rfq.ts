import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { RfqOfferSummary, RfqSnapshot } from '../../../integrations/rfq/rfq.types';
import { listingRepository } from '../repositories/listing.repository';
import type {
  ListingDto,
  ListingRfqDto,
  ListingRfqOfferDto,
  ListingWithMedia,
} from '../types/listing.types';

export const ATTACHED_OFFER_STATUSES = new Set(['active', 'selected', 'confirmed']);

function latestOffersByResponder(offers: RfqOfferSummary[]): RfqOfferSummary[] {
  const seen = new Set<string>();
  const latest: RfqOfferSummary[] = [];
  for (const offer of offers) {
    const responderId = String(offer.responder_id ?? offer.responderId ?? offer.id);
    if (seen.has(responderId)) continue;
    seen.add(responderId);
    latest.push(offer);
  }
  return latest;
}

export function snapshotHasAttachedOffer(snapshot: RfqSnapshot): boolean {
  return (snapshot.my_offers ?? []).some((offer) => ATTACHED_OFFER_STATUSES.has(offer.status));
}

export async function attachedRfqIdsForViewer(viewerId: string): Promise<Set<string>> {
  if (!rfqClient.isConfigured()) return new Set();
  try {
    const snapshots = await rfqClient.listForResponder(viewerId);
    return new Set(snapshots.filter(snapshotHasAttachedOffer).map((snapshot) => snapshot.id));
  } catch {
    return new Set();
  }
}

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
  const ownerOffers = latestOffersByResponder(snapshot.offers ?? []).map(mapOffer);
  const myOffers = (snapshot.my_offers ?? []).map(mapOffer);
  const offers = ownerOffers.length > 0 ? ownerOffers : undefined;
  const offersCount = ownerOffers.length || myOffers.length || undefined;
  const myOffer =
    snapshot.my_offers?.find((offer) => ATTACHED_OFFER_STATUSES.has(offer.status)) ??
    snapshot.my_offers?.[0];
  return {
    id: snapshot.id,
    status: snapshot.status,
    statusLabel: snapshot.status_label,
    statusVariant: snapshot.status_variant,
    expiresAt: snapshot.expires_at ? new Date(snapshot.expires_at).getTime() : null,
    ...(offersCount !== undefined ? { offersCount } : {}),
    canSubmitOffer: snapshot.actions?.can_submit_offer,
    canDecideOffers: snapshot.actions?.can_select,
    canConfirmOffer: snapshot.actions?.can_confirm,
    canDeclineOffer: snapshot.actions?.can_decline,
    canWithdrawOffer: snapshot.actions?.can_withdraw,
    ...(myOffer
      ? {
          myOfferId: String(myOffer.id),
          myOfferStatus: myOffer.status,
          myOfferPrice: myOffer.price != null ? String(myOffer.price) : undefined,
        }
      : {}),
    ...(offers ? { offers } : {}),
  };
}

export function withRfq(listing: ListingDto, snapshot: RfqSnapshot | undefined): ListingDto {
  if (!snapshot) return listing;
  return { ...listing, rfq: toListingRfqDto(snapshot) };
}

export async function attachRfqStatuses(
  listings: ListingDto[],
  rows: ListingWithMedia[],
  viewerId: string,
): Promise<ListingDto[]> {
  const byListingId = new Map(
    rows.filter((row) => row.rfqId).map((row) => [row.id, row.rfqId as string]),
  );
  if (byListingId.size === 0) return listings;

  const snapshots = rfqClient.isConfigured()
    ? await rfqClient.getSnapshots([...byListingId.values()], viewerId)
    : new Map<string, RfqSnapshot>();

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
  if (
    listing.category !== 'equipment' &&
    listing.category !== 'services' &&
    listing.category !== 'gold'
  ) {
    return { listing };
  }

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
