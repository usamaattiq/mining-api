import { pingClient } from '../../../integrations/ping/ping.client';

export interface NotifyUserInput {
  userId: string;
  title: string;
  body: string;
  /** Absolute URI — required by Ping (e.g. miningmobile://home). */
  deepLink: string;
  data?: Record<string, unknown>;
  idempotencyKey?: string;
  channelId?: string;
}

// Single entry every domain module should use for push — keeps Ping out of business logic.
export const notifyService = {
  async notifyUser(input: NotifyUserInput) {
    return pingClient.sendNotification({
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      data: input.data,
      userIds: [input.userId],
      channelId: input.channelId ?? 'default',
      idempotencyKey: input.idempotencyKey,
    });
  },
};
