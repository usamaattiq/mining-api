import { logger } from '../../../common/logger';
import { auctionClient } from '../../../integrations/auction/auction.client';
import type { AuctionBid, AuctionSnapshot } from '../../../integrations/auction/auction.types';
import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { RfqOfferSummary, RfqSnapshot } from '../../../integrations/rfq/rfq.types';
import { AUCTION_CONFIRMATION_TIMEOUT_MS } from '../constants';
import { listingRepository } from '../repositories/listing.repository';
import type {
  ListingDto,
  ListingRfqDto,
  ListingRfqOfferDto,
  ListingWithMedia,
} from '../types/listing.types';

export const ATTACHED_OFFER_STATUSES = new Set([
  'active',
  'selected',
  'confirmed',
  'declined',
  'timed_out',
  'timed-out',
]);

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

/** Both sides have accepted: the offer is confirmed. */
export function snapshotHasSettledOffer(snapshot: RfqSnapshot): boolean {
  return (snapshot.my_offers ?? []).some((offer) => offer.status === 'confirmed');
}

/** An offer is in, but the other side has not confirmed it yet. */
export function snapshotHasOpenOffer(snapshot: RfqSnapshot): boolean {
  return (snapshot.my_offers ?? []).some(
    (offer) =>
      offer.status === 'active' ||
      offer.status === 'selected' ||
      offer.status === 'declined' ||
      offer.status === 'timed_out' ||
      offer.status === 'timed-out',
  );
}

async function rfqIdsForViewer(
  viewerId: string,
  keep: (snapshot: RfqSnapshot) => boolean,
): Promise<Set<string>> {
  if (!rfqClient.isConfigured()) return new Set();
  try {
    const snapshots = await rfqClient.listForResponder(viewerId);
    return new Set(snapshots.filter(keep).map((snapshot) => snapshot.id));
  } catch {
    return new Set();
  }
}

export function openRfqIdsForViewer(viewerId: string): Promise<Set<string>> {
  return rfqIdsForViewer(viewerId, snapshotHasOpenOffer);
}

export function settledRfqIdsForViewer(viewerId: string): Promise<Set<string>> {
  return rfqIdsForViewer(viewerId, snapshotHasSettledOffer);
}

function parseQuantity(value: string | number | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function offerSentAt(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function mapOffer(offer: RfqOfferSummary): ListingRfqOfferDto {
  const quantity = parseQuantity(offer.offered_quantity);
  const createdAt = offerSentAt(offer.created_at);
  return {
    id: String(offer.id),
    responderId: String(offer.responder_id ?? offer.responderId ?? ''),
    responderName: '',
    status: offer.status,
    ...(offer.price != null ? { price: String(offer.price) } : {}),
    ...(quantity != null ? { quantity } : {}),
    ...(offer.rank != null ? { rank: offer.rank } : {}),
    ...(createdAt != null ? { createdAt } : {}),
  };
}

function myOfferStatus(snapshot: AuctionSnapshot): string {
  if (snapshot.participant_status === 'timed_out' || snapshot.participant_status === 'timed-out') {
    return 'timed_out';
  }
  if (snapshot.participant_status === 'declined') return 'declined';
  if (snapshot.participant_status === 'withdrawn') return 'withdrawn';
  if (snapshot.status === 'awaiting-your-confirmation') return 'selected';
  if (snapshot.status === 'completed') return 'confirmed';
  return 'active';
}

function auctionRowStatus(
  participantId: string,
  participantStatus: string | null | undefined,
  selectedId: string | undefined,
  confirmedId: string | undefined,
): string {
  if (confirmedId === participantId) return 'confirmed';
  const status = (participantStatus ?? '').replace('-', '_');
  if (status === 'declined' || status === 'timed_out' || status === 'withdrawn') return status;
  if (selectedId === participantId) return 'selected';
  return 'active';
}

function auctionOffersFromBids(
  bids: AuctionBid[],
  selectedId: string | undefined,
  confirmedId: string | undefined,
): RfqOfferSummary[] {
  const byParticipant = new Map<string, AuctionBid>();
  for (const bid of bids) {
    const id = String(bid.participant_id);
    if (!byParticipant.has(id)) byParticipant.set(id, bid);
  }
  return [...byParticipant.values()]
    .sort((left, right) => right.amount - left.amount)
    .map((bid, index) => {
      const participantId = String(bid.participant_id);
      return {
        id: participantId,
        responder_id: participantId,
        status: auctionRowStatus(participantId, bid.participant_status, selectedId, confirmedId),
        price: bid.amount,
        rank: index + 1,
        created_at: bid.placed_at,
      };
    });
}

/** Auction snapshots reuse the listing RFQ shape the app already renders. */
export function auctionSnapshotToRfq(snapshot: AuctionSnapshot, bids?: AuctionBid[]): RfqSnapshot {
  const selectedId = snapshot.selected_participant_id
    ? String(snapshot.selected_participant_id)
    : undefined;
  const confirmedId = snapshot.confirmed_participant_id
    ? String(snapshot.confirmed_participant_id)
    : undefined;
  const offers =
    bids && bids.length > 0
      ? auctionOffersFromBids(bids, selectedId, confirmedId)
      : (snapshot.ranking ?? []).map((row) => ({
          id: String(row.participant_id),
          responder_id: String(row.participant_id),
          status: auctionRowStatus(
            String(row.participant_id),
            row.participant_status,
            selectedId,
            confirmedId,
          ),
          price: row.peak_amount,
          rank: row.rank,
          created_at: row.last_bid_at,
        }));
  const myOffers =
    snapshot.has_participated || snapshot.my_peak_amount != null
      ? [
          {
            id: 'mine',
            status: myOfferStatus(snapshot),
            price: snapshot.my_peak_amount,
          },
        ]
      : [];
  return {
    id: String(snapshot.id),
    status: snapshot.status,
    status_label: snapshot.status_label,
    status_variant: snapshot.status_variant,
    external_ref: snapshot.external_ref,
    expires_at: snapshot.ends_at,
    ...(snapshot.current_amount != null ? { current_amount: snapshot.current_amount } : {}),
    ...(offers.length > 0 ? { offers } : {}),
    ...(myOffers.length > 0 ? { my_offers: myOffers } : {}),
    ...(snapshot.is_leading != null ? { is_leading: snapshot.is_leading } : {}),
    actions: {
      can_submit_offer: snapshot.actions?.can_place_bid,
      can_select: snapshot.actions?.can_select_next,
      can_withdraw: snapshot.actions?.can_withdraw,
      can_confirm: snapshot.actions?.can_confirm,
      can_decline: snapshot.actions?.can_decline,
    },
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
  const mappedMyOffer = myOffer ? mapOffer(myOffer) : undefined;
  return {
    id: snapshot.id,
    status: snapshot.status,
    statusLabel: snapshot.status_label,
    statusVariant: snapshot.status_variant,
    expiresAt: snapshot.expires_at ? new Date(snapshot.expires_at).getTime() : null,
    ...(snapshot.current_amount != null ? { currentPrice: String(snapshot.current_amount) } : {}),
    ...(offersCount !== undefined ? { offersCount } : {}),
    canSubmitOffer: snapshot.actions?.can_submit_offer,
    canDecideOffers: snapshot.actions?.can_select,
    canConfirmOffer: snapshot.actions?.can_confirm,
    canDeclineOffer: snapshot.actions?.can_decline,
    canWithdrawOffer: snapshot.actions?.can_withdraw,
    ...(mappedMyOffer
      ? {
          myOfferId: mappedMyOffer.id,
          myOfferStatus: mappedMyOffer.status,
          myOfferPrice: mappedMyOffer.price,
          ...(mappedMyOffer.quantity != null ? { myOfferQuantity: mappedMyOffer.quantity } : {}),
          ...(mappedMyOffer.createdAt != null ? { myOfferCreatedAt: mappedMyOffer.createdAt } : {}),
        }
      : {}),
    ...(snapshot.is_leading ? { isLeading: true } : {}),
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

  const goldIds: string[] = [];
  const rfqIds: string[] = [];
  for (const row of rows) {
    if (!row.rfqId) continue;
    if (row.category === 'gold' || row.requestMode === 'auction') goldIds.push(row.rfqId);
    else rfqIds.push(row.rfqId);
  }

  const [rfqSnapshots, auctionSnapshots] = await Promise.all([
    rfqClient.isConfigured() && rfqIds.length > 0
      ? rfqClient.getSnapshots(rfqIds, viewerId)
      : Promise.resolve(new Map<string, RfqSnapshot>()),
    loadAuctionSnapshots(goldIds, viewerId),
  ]);

  return listings.map((listing) => {
    const remoteId = byListingId.get(listing.id);
    if (!remoteId) return listing;
    const snapshot =
      listing.category === 'gold' ||
      (listing.category === 'equipment' && listing.requestMode === 'auction')
        ? auctionSnapshots.get(remoteId)
        : rfqSnapshots.get(remoteId);
    const next = withRfq(listing, snapshot);
    const mine = next.rfq?.offers?.find((offer) => offer.responderId === viewerId);
    const withSentAt =
      next.rfq && next.rfq.myOfferCreatedAt == null && mine?.createdAt != null
        ? { ...next, rfq: { ...next.rfq, myOfferCreatedAt: mine.createdAt } }
        : next;
    const row = rows.find((item) => item.id === listing.id);
    const selectedAt = row?.auctionOfferSelectedAt?.getTime();
    const ownerViewing = Boolean(row && row.ownerId === viewerId);
    const awaiting =
      withSentAt.rfq &&
      withSentAt.rfq.status !== 'completed' &&
      withSentAt.rfq.status !== 'confirmed' &&
      withSentAt.rfq.status !== 'closed';
    if (
      !ownerViewing ||
      !withSentAt.rfq ||
      !awaiting ||
      selectedAt == null ||
      Date.now() - selectedAt < AUCTION_CONFIRMATION_TIMEOUT_MS
    ) {
      return withSentAt;
    }
    return {
      ...withSentAt,
      rfq: { ...withSentAt.rfq, needsOwnerSkipConfirm: true },
    };
  });
}

async function loadAuctionSnapshots(
  auctionIds: string[],
  viewerId: string,
): Promise<Map<string, RfqSnapshot>> {
  const map = new Map<string, RfqSnapshot>();
  if (!auctionClient.isConfigured() || auctionIds.length === 0) return map;
  const rows = await Promise.all(
    [...new Set(auctionIds)].map(async (id) => {
      try {
        const [snapshot, bidList] = await Promise.all([
          auctionClient.getSnapshot(id, viewerId),
          auctionClient.listBids(id, viewerId).catch(() => ({ bids: [] })),
        ]);
        return [id, auctionSnapshotToRfq(snapshot, bidList.bids)] as const;
      } catch {
        return null;
      }
    }),
  );
  for (const row of rows) {
    if (row) map.set(row[0], row[1]);
  }
  return map;
}

export async function createListingRfq(
  listing: ListingWithMedia,
  expiryHours = 24,
  schedule?: { startsAt: number | null; endsAt: number | null; startingAmount: number },
): Promise<{ listing: ListingWithMedia; snapshot?: RfqSnapshot }> {
  if (listing.category === 'gold') {
    return createGoldAuction(listing, schedule);
  }
  if (listing.category === 'equipment' && listing.postedAs === 'supplier') {
    return { listing };
  }
  if (
    listing.category === 'equipment' &&
    listing.postedAs === 'buyer' &&
    listing.requestMode === 'auction'
  ) {
    return createEquipmentAuction(listing, schedule);
  }
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
      enforceCapacityLimit: false,
      expiryHours:
        listing.category === 'equipment' && listing.postedAs === 'supplier'
          ? 8760
          : Math.min(8760, Math.max(1, Math.round(expiryHours) || 24)),
    });
    const updated = await listingRepository.setRfqId(listing.id, snapshot.id);
    return { listing: updated, snapshot };
  } catch (error) {
    logger.error({ err: error, listingId: listing.id }, 'Failed to create RFQ for listing');
    throw error;
  }
}

async function createEquipmentAuction(
  listing: ListingWithMedia,
  schedule?: { startsAt: number | null; endsAt: number | null; startingAmount: number },
): Promise<{ listing: ListingWithMedia; snapshot?: RfqSnapshot }> {
  if (!auctionClient.isConfigured()) return { listing };
  const now = Date.now();
  const startsAt = schedule?.startsAt ?? null;
  const endsAt = schedule?.endsAt ?? listing.auctionEndDate?.getTime() ?? null;
  const durationMinutes =
    startsAt != null && endsAt != null
      ? Math.max(1, Math.round((endsAt - startsAt) / 60_000))
      : endsAt != null
        ? Math.max(1, Math.round((endsAt - now) / 60_000))
        : 60;
  const activateImmediately = startsAt == null || startsAt <= now;
  try {
    const snapshot = await auctionClient.createAuction({
      ownerId: listing.ownerId,
      listingId: listing.id,
      startingAmount: 1,
      durationMinutes,
      ...(startsAt != null && !activateImmediately
        ? { startsAt: new Date(startsAt).toISOString() }
        : {}),
      activateImmediately,
    });
    const updated = await listingRepository.setRfqId(listing.id, snapshot.id);
    return { listing: updated, snapshot: auctionSnapshotToRfq(snapshot) };
  } catch (error) {
    logger.error(
      { err: error, listingId: listing.id },
      'Failed to create auction for equipment listing',
    );
    return { listing };
  }
}

async function createGoldAuction(
  listing: ListingWithMedia,
  schedule?: { startsAt: number | null; endsAt: number | null; startingAmount: number },
): Promise<{ listing: ListingWithMedia; snapshot?: RfqSnapshot }> {
  if (!auctionClient.isConfigured()) return { listing };
  const now = Date.now();
  const startsAt = schedule?.startsAt ?? null;
  const endsAt = schedule?.endsAt ?? listing.auctionEndDate?.getTime() ?? null;
  const durationMinutes =
    startsAt != null && endsAt != null
      ? Math.max(1, Math.round((endsAt - startsAt) / 60_000))
      : endsAt != null
        ? Math.max(1, Math.round((endsAt - now) / 60_000))
        : 60;
  const activateImmediately = startsAt == null || startsAt <= now;

  try {
    const snapshot = await auctionClient.createAuction({
      ownerId: listing.ownerId,
      listingId: listing.id,
      startingAmount: Math.max(1, Math.round(schedule?.startingAmount ?? 1)),
      durationMinutes,
      ...(startsAt != null && !activateImmediately
        ? { startsAt: new Date(startsAt).toISOString() }
        : {}),
      activateImmediately,
    });
    const updated = await listingRepository.setRfqId(listing.id, snapshot.id);
    return { listing: updated, snapshot: auctionSnapshotToRfq(snapshot) };
  } catch (error) {
    logger.error(
      { err: error, listingId: listing.id },
      'Failed to create auction for gold listing',
    );
    return { listing };
  }
}
