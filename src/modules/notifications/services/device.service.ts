import { pingClient } from '../../../integrations/ping/ping.client';
import { pushDeviceRepository } from '../repositories/push-device.repository';
import type { RegisterDeviceInput } from '../validation/device.schema';

export const deviceService = {
  // Registers the token with Ping first (source of truth for delivery), then
  // mirrors the mapping locally so mining-api knows which Ping device to
  // unregister on logout without another round trip.
  async registerDevice(userId: string, input: RegisterDeviceInput) {
    const existing = await pushDeviceRepository.findByToken(input.expoPushToken);
    if (existing?.pingDeviceId && existing.userId === userId && existing.isActive) {
      return existing;
    }

    const registered = await pingClient.registerDevice({
      userId,
      platform: input.platform,
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

    if (device.pingDeviceId) {
      await pingClient.unregisterDevice(device.pingDeviceId);
    }

    await pushDeviceRepository.deactivate(expoPushToken);
  },
};
