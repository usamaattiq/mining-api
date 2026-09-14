import type { DevicePlatform } from '@prisma/client';
import type { PingDevicePlatform } from '../../../integrations/ping/ping.types';

export function toPingPlatform(platform: DevicePlatform | 'ios' | 'android'): PingDevicePlatform {
  return platform === 'ios' ? 'IOS' : 'ANDROID';
}
