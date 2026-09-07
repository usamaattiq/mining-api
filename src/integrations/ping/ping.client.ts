import { env } from '../../config/env';
import type {
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  SendNotificationRequest,
  SendNotificationResponse,
} from './ping.types';

// mining-api is registered as an "app" tenant in Ping and authenticates
// with a per-app API key. Ping is the ONLY thing that talks to Expo/FCM/APNs
// directly — every other service (this one included) goes through it.
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
  private readonly baseUrl = env.PING_BASE_URL.replace(/\/+$/, '');
  private readonly apiKey = env.PING_API_KEY;
  private readonly timeoutMs = env.PING_API_TIMEOUT;

  async registerDevice(payload: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    return this.request<RegisterDeviceResponse>('POST', '/api/v1/devices', payload);
  }

  async unregisterDevice(pingDeviceId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/devices/${pingDeviceId}`);
  }

  async sendNotification(payload: SendNotificationRequest): Promise<SendNotificationResponse> {
    return this.request<SendNotificationResponse>('POST', '/api/v1/notifications/send', payload);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;

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
