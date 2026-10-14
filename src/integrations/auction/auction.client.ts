import { env } from '../../config/env';
import { RfqApiError } from '../rfq/rfq.client';
import type { AuctionBidList, AuctionSnapshot, CreateAuctionInput } from './auction.types';

class AuctionClient {
  private readonly timeoutMs = env.AUCTION_API_TIMEOUT;

  isConfigured(): boolean {
    return Boolean(env.AUCTION_BASE_URL?.trim());
  }

  async isReachable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch(`${this.apiRoot}/health`, { signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private get apiRoot(): string {
    return (env.AUCTION_BASE_URL ?? '').replace(/\/+$/, '');
  }

  async createAuction(input: CreateAuctionInput): Promise<AuctionSnapshot> {
    return this.request<AuctionSnapshot>('POST', '/auctions', {
      platform_id: env.RMS_PLATFORM_ID,
      owner_id: input.ownerId,
      auction_type: 'forward',
      duration_minutes: input.durationMinutes,
      starting_amount: input.startingAmount,
      ...(input.startsAt ? { starts_at: input.startsAt } : {}),
      external_ref: input.listingId,
      activate_immediately: input.activateImmediately,
      save_as_draft: false,
    });
  }

  async getSnapshot(auctionId: string, viewerId: string): Promise<AuctionSnapshot> {
    return this.request<AuctionSnapshot>('GET', `/auctions/${auctionId}`, undefined, {
      'X-Participant-Id': viewerId,
    });
  }

  async listBids(auctionId: string, viewerId: string): Promise<AuctionBidList> {
    const data = await this.request<AuctionBidList | AuctionBidList['bids']>(
      'GET',
      `/auctions/${auctionId}/bids`,
      undefined,
      { 'X-Participant-Id': viewerId },
    );
    if (Array.isArray(data)) return { bids: data };
    return { bids: data.bids ?? [] };
  }

  async listForParticipant(participantId: string): Promise<AuctionSnapshot[]> {
    const params = new URLSearchParams({
      platform_id: env.RMS_PLATFORM_ID,
      scope: 'participant',
      limit: '200',
    });
    return this.request<AuctionSnapshot[]>('GET', `/auctions?${params.toString()}`, undefined, {
      'X-Participant-Id': participantId,
    });
  }

  async placeBid(
    auctionId: string,
    participantId: string,
    amount: number,
  ): Promise<AuctionSnapshot> {
    return this.request<AuctionSnapshot>(
      'POST',
      `/auctions/${auctionId}/bids`,
      { amount },
      { 'X-Participant-Id': participantId },
    );
  }

  async participantAction(
    auctionId: string,
    participantId: string,
    action: 'withdraw' | 'confirm' | 'decline',
  ): Promise<AuctionSnapshot> {
    return this.request<AuctionSnapshot>(
      'POST',
      `/auctions/${auctionId}/${action}`,
      {},
      { 'X-Participant-Id': participantId },
    );
  }

  async ownerAction(
    auctionId: string,
    ownerId: string,
    action: 'select-next' | 'close',
  ): Promise<AuctionSnapshot> {
    return this.request<AuctionSnapshot>(
      'POST',
      `/auctions/${auctionId}/owner/${action}`,
      {},
      { 'X-Participant-Id': ownerId },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new RfqApiError('Auction client is not configured', 0, null);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...extraHeaders,
      };
      if (env.AUCTION_API_KEY?.trim()) {
        headers['X-API-Key'] = env.AUCTION_API_KEY;
      }

      const res = await fetch(`${this.apiRoot}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : undefined;

      if (!res.ok) {
        throw new RfqApiError(`Auction request failed: ${method} ${path}`, res.status, data);
      }

      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const auctionClient = new AuctionClient();
