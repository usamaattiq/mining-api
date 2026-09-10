import { env } from '../../../config/env';
import { userRepository } from '../../auth/repositories/user.repository';
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

    const rmsRecipientId = resolveRmsRecipientId(event);
    if (!rmsRecipientId) {
      return { delivered: false, reason: 'missing_recipient' };
    }

    const user = await userRepository.findByRmsId(rmsRecipientId);
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
