import { z } from 'zod';

export const registerDeviceBodySchema = z.object({
  body: z.object({
    platform: z.enum(['ios', 'android']),
    expoPushToken: z.string().trim().min(16, 'expoPushToken is required').max(512),
  }),
});

export const unregisterDeviceBodySchema = z.object({
  body: z.object({
    expoPushToken: z.string().trim().min(16, 'expoPushToken is required').max(512),
  }),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceBodySchema>['body'];
export type UnregisterDeviceInput = z.infer<typeof unregisterDeviceBodySchema>['body'];
