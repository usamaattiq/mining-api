import { env } from '../../config/env';
import type { CreateRfqInput, RfqSnapshot, SubmitRfqOfferInput } from './rfq.types';

export class RfqApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'RfqApiError';
  }
}

class RfqClient {
  private readonly timeoutMs = env.RFQ_API_TIMEOUT;

  isConfigured(): boolean {
    return Boolean(env.RFQ_BASE_URL?.trim() && env.RFQ_API_KEY?.trim());
  }

  private get apiRoot(): string {
    return (env.RFQ_BASE_URL ?? '').replace(/\/+$/, '');
  }

  async createRfq(input: CreateRfqInput): Promise<RfqSnapshot> {
    return this.request<RfqSnapshot>(
      'POST',
      '/rfqs',
      {
        platform_id: env.RMS_PLATFORM_ID,
        owner_id: input.ownerId,
        enforce_capacity_limit: input.enforceCapacityLimit,
        total_quantity: input.totalQuantity,
        expiry_hours: input.expiryHours ?? 24,
        external_ref: input.listingId,
      },
      { 'X-Responder-Id': input.ownerId },
    );
  }

  async getSnapshot(rfqId: string, viewerId: string): Promise<RfqSnapshot> {
    return this.request<RfqSnapshot>('GET', `/rfqs/${rfqId}`, undefined, {
      'X-Responder-Id': viewerId,
    });
  }

  async submitOffer(input: SubmitRfqOfferInput): Promise<unknown> {
    return this.request(
      'POST',
      `/rfqs/${input.rfqId}/offers`,
      {
        capacity_mode: input.capacityMode ?? 'full',
        price: input.price,
        ...(input.offeredQuantity != null ? { offered_quantity: input.offeredQuantity } : {}),
      },
      { 'X-Responder-Id': input.responderId },
    );
  }

  async getSnapshots(rfqIds: string[], viewerId: string): Promise<Map<string, RfqSnapshot>> {
    const unique = [...new Set(rfqIds.filter(Boolean))];
    const results = await Promise.all(
      unique.map(async (id) => {
        try {
          const snapshot = await this.getSnapshot(id, viewerId);
          return [id, snapshot] as const;
        } catch {
          return null;
        }
      }),
    );

    const map = new Map<string, RfqSnapshot>();
    for (const row of results) {
      if (row) map.set(row[0], row[1]);
    }
    return map;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new RfqApiError('RFQ client is not configured', 0, null);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.apiRoot}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.RFQ_API_KEY ?? '',
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : undefined;

      if (!res.ok) {
        throw new RfqApiError(`RFQ request failed: ${method} ${path}`, res.status, data);
      }

      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const rfqClient = new RfqClient();
