export type PingDevicePlatform = 'IOS' | 'ANDROID';

export type PingRegisterDeviceRequest = {
  userId: string;
  platform: PingDevicePlatform;
  pushToken: string;
  expoPushToken?: string;
};

export type PingDevice = {
  id: string;
  userId: string;
  platform: PingDevicePlatform;
  pushToken: string;
  expoPushToken: string | null;
  isActive: boolean;
};

export type PingSendNotificationRequest = {
  title: string;
  body: string;
  deepLink: string;
  data?: Record<string, unknown>;
  userIds: string[];
  channelId?: string;
  sound?: string;
  idempotencyKey?: string;
};

export type PingSendNotificationResult = {
  mode: 'sync' | 'async';
  notification: {
    id: string;
    title: string;
    body: string;
    deepLink: string;
    status: string;
  };
  summary?: {
    total: number;
    sent: number;
    failed: number;
  };
};

type PingSuccessEnvelope<T> = {
  success: true;
  message: string;
  data: T;
};

export function unwrapPingData<T>(payload: unknown): T {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'success' in payload &&
    (payload as PingSuccessEnvelope<T>).success === true &&
    'data' in payload
  ) {
    return (payload as PingSuccessEnvelope<T>).data;
  }

  return payload as T;
}
