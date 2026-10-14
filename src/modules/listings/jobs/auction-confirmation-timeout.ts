import { logger } from '../../../common/logger';
import { auctionClient } from '../../../integrations/auction/auction.client';
import { AUCTION_CONFIRMATION_TIMEOUT_MS } from '../constants';
import { listingRepository } from '../repositories/listing.repository';
import { notifyListingRfq } from '../utils/listing-rfq-notify';
const POLL_MS = 60 * 1000;

function participantId(value: string | null | undefined): string | null {
  if (!value) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

async function promptOwnersToSkipStaleOffers(): Promise<void> {
  if (!auctionClient.isConfigured()) return;
  const stale = await listingRepository.findStaleAuctionSelections(
    new Date(Date.now() - AUCTION_CONFIRMATION_TIMEOUT_MS),
  );
  for (const listing of stale) {
    if (!listing.rfqId) continue;
    try {
      const snapshot = await auctionClient.getSnapshot(listing.rfqId, listing.ownerId);
      const selected = participantId(snapshot.selected_participant_id);
      if (snapshot.confirmed_participant_id || snapshot.status === 'completed') {
        await listingRepository.setAuctionSelection(listing.id, {
          participantId: null,
          selectedAt: null,
        });
        continue;
      }
      if (!selected || selected !== listing.auctionSelectedParticipantId) {
        await listingRepository.setAuctionSelection(listing.id, {
          participantId: selected,
          selectedAt: selected ? new Date() : null,
        });
        continue;
      }

      await listingRepository.setAuctionSelection(listing.id, {
        participantId: selected,
        selectedAt: listing.auctionOfferSelectedAt,
        skipPromptedAt: new Date(),
      });
      notifyListingRfq(
        listing.ownerId,
        'No response in 30 minutes',
        `The selected bidder has not confirmed "${listing.title}". Confirm to send the offer to the next bidder.`,
        listing,
        `auction-skip-ask:${listing.rfqId}:${selected}`,
      );
    } catch (error) {
      logger.error(
        { err: error, listingId: listing.id },
        'Failed to ask owner to skip a timed-out auction bidder',
      );
    }
  }
}

export function startAuctionConfirmationTimeoutJob(): () => void {
  const timer = setInterval(() => {
    void promptOwnersToSkipStaleOffers();
  }, POLL_MS);
  void promptOwnersToSkipStaleOffers();
  return () => clearInterval(timer);
}
