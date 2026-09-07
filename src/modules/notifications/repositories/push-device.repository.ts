import type { DevicePlatform, PushDevice } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

export const pushDeviceRepository = {
  upsertByToken(params: {
    userId: string;
    platform: DevicePlatform;
    expoPushToken: string;
    pingDeviceId: string;
  }): Promise<PushDevice> {
    return prisma.pushDevice.upsert({
      where: { expoPushToken: params.expoPushToken },
      create: { ...params, isActive: true, lastRegisteredAt: new Date() },
      update: {
        userId: params.userId,
        platform: params.platform,
        pingDeviceId: params.pingDeviceId,
        isActive: true,
        lastRegisteredAt: new Date(),
      },
    });
  },

  findByToken(expoPushToken: string): Promise<PushDevice | null> {
    return prisma.pushDevice.findUnique({ where: { expoPushToken } });
  },

  deactivate(expoPushToken: string): Promise<PushDevice> {
    return prisma.pushDevice.update({
      where: { expoPushToken },
      data: { isActive: false },
    });
  },
};
