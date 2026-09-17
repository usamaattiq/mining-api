export type RfqStatusVariant = 'muted' | 'accent' | 'warning' | 'success';

export type RfqSnapshot = {
  id: string;
  role?: 'public' | 'owner' | 'responder';
  status: string;
  status_label: string;
  status_variant: RfqStatusVariant;
  expires_at?: string | null;
  offers?: unknown[];
  my_offers?: RfqOfferSummary[];
  actions?: {
    can_submit_offer?: boolean;
    can_withdraw?: boolean;
    can_confirm?: boolean;
    can_decline?: boolean;
  };
};

export type RfqOfferSummary = {
  id: string;
  status: string;
  price?: string | number | null;
  offered_quantity?: string | number | null;
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
