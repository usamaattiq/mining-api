import { env } from '../../config/env';
import type {
  PingDevice,
  PingRegisterDeviceRequest,
  PingSendNotificationRequest,
  PingSendNotificationResult,
} from './ping.types';
import { unwrapPingData } from './ping.types';

// mining-api is a Ping "app" tenant. Authenticate with the per-app API key.
// Ping is the only service that talks to Expo/FCM/APNs — all other services go through it.
export class PingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'PingApiError';
  }
}

class PingClient {
  private readonly apiKey = env.PING_API_KEY;
  private readonly timeoutMs = env.PING_API_TIMEOUT;

  private get apiRoot(): string {
    const base = env.PING_BASE_URL.replace(/\/+$/, '');
    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
  }

  async registerDevice(payload: PingRegisterDeviceRequest): Promise<PingDevice> {
    const data = await this.request<unknown>('POST', '/devices', payload);
    return unwrapPingData<PingDevice>(data);
  }

  async unregisterDevice(pushToken: string): Promise<void> {
    await this.request<unknown>('POST', '/devices/unregister', { pushToken });
  }

  async sendNotification(
    payload: PingSendNotificationRequest,
  ): Promise<PingSendNotificationResult> {
    const { idempotencyKey, ...body } = payload;
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const data = await this.request<unknown>('POST', '/notifications/send', body, headers);
    return unwrapPingData<PingSendNotificationResult>(data);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.apiRoot}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : undefined;

      if (!res.ok) {
        throw new PingApiError(`Ping request failed: ${method} ${path}`, res.status, data);
      }

      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const pingClient = new PingClient();
