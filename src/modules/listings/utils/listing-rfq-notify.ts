import { env } from '../../../config/env';
import { inboxRepository } from '../../notifications/repositories/inbox.repository';
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
  void inboxRepository
    .create({
      userId,
      titleKey: title,
      bodyKey: body,
      icon: 'notifications-outline',
      target: 'Requests',
      listingId: listing.id,
    })
    .catch(() => undefined);
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
