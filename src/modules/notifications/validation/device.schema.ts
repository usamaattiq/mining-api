import { z } from 'zod';

export const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  expoPushToken: z.string().min(1, 'expoPushToken is required'),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
