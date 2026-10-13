import type { RfqStatusVariant } from '../rfq/rfq.types';

export type AuctionRank = {
  participant_id: string;
  peak_amount: number;
  rank: number;
  last_bid_at?: string | null;
};

export type AuctionSnapshot = {
  id: string;
  role?: 'public' | 'owner' | 'participant';
  status: string;
  status_label: string;
  status_variant: RfqStatusVariant;
  external_ref?: string | null;
  ends_at?: string | null;
  current_amount?: number | null;
  selected_participant_id?: string | null;
  has_participated?: boolean;
  participant_status?: string | null;
  my_peak_amount?: number | null;
  is_leading?: boolean;
  ranking?: AuctionRank[];
  actions?: {
    can_place_bid?: boolean;
    can_withdraw?: boolean;
    can_confirm?: boolean;
    can_decline?: boolean;
    can_select_next?: boolean;
    can_close?: boolean;
  };
};

export type CreateAuctionInput = {
  ownerId: string;
  listingId: string;
  startingAmount: number;
  durationMinutes: number;
  startsAt?: string;
  activateImmediately: boolean;
};
