import { pingClient } from '../../../integrations/ping/ping.client';

export interface NotifyUserInput {
  userId: string;
  title: string;
  body: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

// Single call site every domain module (trip, credits, admin, ...) should
// use to push a notification — keeps Ping as the only thing that talks to
// Expo/FCM/APNs, and keeps that call out of business logic.
export const notifyService = {
  async notifyUser(input: NotifyUserInput) {
    return pingClient.sendNotification({
      userId: input.userId,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      data: input.data,
    });
  },
};
