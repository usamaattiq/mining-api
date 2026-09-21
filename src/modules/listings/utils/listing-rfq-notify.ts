import { env } from '../../../config/env';
import { notifyService } from '../../notifications/services/notify.service';
import type { ListingWithMedia } from '../types/listing.types';

export function listingDeepLink(listing: Pick<ListingWithMedia, 'id' | 'category'>): string {
  return `miningmobile://listing/${listing.category}/${listing.id}`;
}

export function notifyListingRfq(
  userId: string,
  title: string,
  body: string,
  listing: Pick<ListingWithMedia, 'id' | 'category'>,
  idempotencyKey: string,
): void {
  if (env.PUBSUB_ENABLED) return;
  void notifyService
    .notifyUser({
      userId,
      title,
      body,
      deepLink: listingDeepLink(listing),
      data: { listingId: listing.id, category: listing.category },
      idempotencyKey,
    })
    .catch(() => undefined);
}
