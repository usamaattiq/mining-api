export type PingDevicePlatform = 'ios' | 'android';

export interface RegisterDeviceRequest {
  userId: string;
  platform: PingDevicePlatform;
  expoPushToken: string;
}

export interface RegisterDeviceResponse {
  id: string;
  userId: string;
  platform: PingDevicePlatform;
  expoPushToken: string;
  isActive: boolean;
}

export interface SendNotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  deepLink?: string;
}

export interface SendNotificationResponse {
  id: string;
  status: string;
}
