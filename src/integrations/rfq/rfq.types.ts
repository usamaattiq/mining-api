export type RfqStatusVariant = 'muted' | 'accent' | 'warning' | 'success';

export type RfqOfferSummary = {
  id: string;
  responder_id?: string;
  responderId?: string;
  status: string;
  price?: string | number | null;
  offered_quantity?: string | number | null;
  rank?: number;
};

export type RfqSnapshot = {
  id: string;
  role?: 'public' | 'owner' | 'responder';
  status: string;
  status_label: string;
  status_variant: RfqStatusVariant;
  external_ref?: string | null;
  expires_at?: string | null;
  offers?: RfqOfferSummary[];
  my_offers?: RfqOfferSummary[];
  is_leading?: boolean;
  actions?: {
    can_submit_offer?: boolean;
    can_select?: boolean;
    can_withdraw?: boolean;
    can_confirm?: boolean;
    can_decline?: boolean;
  };
};

export type CreateRfqInput = {
  ownerId: string;
  listingId: string;
  totalQuantity: number;
  enforceCapacityLimit: boolean;
  expiryHours?: number;
};

export type SubmitRfqOfferInput = {
  rfqId: string;
  responderId: string;
  price: number;
  offeredQuantity?: number;
  capacityMode?: 'full' | 'partial';
};

export type DecideRfqOfferInput = {
  rfqId: string;
  offerId: string;
  actorId: string;
  action: 'select' | 'reject' | 'confirm' | 'decline' | 'withdraw';
};
