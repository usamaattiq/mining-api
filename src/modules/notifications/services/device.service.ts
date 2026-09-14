import { pingClient } from '../../../integrations/ping/ping.client';
import { pushDeviceRepository } from '../repositories/push-device.repository';
import type { RegisterDeviceInput } from '../validation/device.schema';
import { toPingPlatform } from '../utils/ping-platform';

export const deviceService = {
  // Registers with Ping first (delivery source of truth), then mirrors locally.
  async registerDevice(userId: string, input: RegisterDeviceInput) {
    const existing = await pushDeviceRepository.findByToken(input.expoPushToken);
    if (existing?.pingDeviceId && existing.userId === userId && existing.isActive) {
      return existing;
    }

    const registered = await pingClient.registerDevice({
      userId,
      platform: toPingPlatform(input.platform),
      pushToken: input.expoPushToken,
      expoPushToken: input.expoPushToken,
    });

    return pushDeviceRepository.upsertByToken({
      userId,
      platform: input.platform,
      expoPushToken: input.expoPushToken,
      pingDeviceId: registered.id,
    });
  },

  async unregisterDevice(userId: string, expoPushToken: string) {
    const device = await pushDeviceRepository.findByToken(expoPushToken);

    if (!device || device.userId !== userId) {
      return;
    }

    try {
      await pingClient.unregisterDevice(expoPushToken);
    } catch {
      // Still deactivate locally if Ping already dropped the token.
    }

    await pushDeviceRepository.deactivate(expoPushToken);
  },
};
