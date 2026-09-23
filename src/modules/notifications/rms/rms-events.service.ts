import { env } from '../../../config/env';
import { userRepository } from '../../auth/repositories/user.repository';
import { listingRepository } from '../../listings/repositories/listing.repository';
import { listingDeepLink } from '../../listings/utils/listing-rfq-notify';
import { notifyService } from '../services/notify.service';
import {
  mapRmsEventToNotification,
  resolveRmsRecipientId,
  type RmsNotificationEvent,
} from './rms-notification.mapper';

export type HandleRmsEventResult = {
  delivered: boolean;
  reason?: string;
};

export const rmsEventsService = {
  async handleEvent(event: RmsNotificationEvent): Promise<HandleRmsEventResult> {
    if (event.platform_id && event.platform_id !== env.RMS_PLATFORM_ID) {
      return { delivered: false, reason: 'platform_mismatch' };
    }

    const copy = mapRmsEventToNotification(event);
    if (!copy) {
      return { delivered: false, reason: 'unmapped_trigger' };
    }

    if (event.external_ref) {
      const listing = await listingRepository.findById(event.external_ref);
      if (listing) {
        copy.deepLink = listingDeepLink(listing);
        copy.data = { ...copy.data, listingId: listing.id, category: listing.category };
      }
    }

    const rmsRecipientId = resolveRmsRecipientId(event);
    if (!rmsRecipientId) {
      return { delivered: false, reason: 'missing_recipient' };
    }

    const user =
      (await userRepository.findById(rmsRecipientId)) ??
      (await userRepository.findByRmsId(rmsRecipientId));
    if (!user) {
      return { delivered: false, reason: 'user_not_linked' };
    }

    await notifyService.notifyUser({
      userId: user.id,
      title: copy.title,
      body: copy.body,
      deepLink: copy.deepLink,
      data: copy.data,
      idempotencyKey: event.event_id,
    });

    return { delivered: true };
  },
};
