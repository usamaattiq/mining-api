export type RmsNotificationTrigger =
  | 'rfq_created'
  | 'rfq_live'
  | 'offer_submitted'
  | 'offer_selected'
  | 'offer_confirmed'
  | 'offer_declined'
  | 'offer_declined_by_responder'
  | 'offer_timed_out'
  | 'offer_withdrawn'
  | 'rfq_partially_consolidated'
  | 'rfq_completed'
  | 'rfq_closed'
  | 'rfq_expired'
  | 'confirmation_reminder'
  | 'messaging_window_closing';

export type RmsNotificationEvent = {
  event_id: string;
  occurred_at?: string;
  trigger: RmsNotificationTrigger | string;
  rfq_id: string;
  platform_id: string;
  owner_id: string;
  external_ref?: string | null;
  payload?: {
    offer_id?: string | null;
    responder_id?: string | null;
    recipient_id?: string | null;
    quantity?: number | null;
    confirmed_quantity?: number | null;
    remaining_quantity?: number | null;
    rfq_status?: string | null;
    confirmation_deadline_at?: string | null;
  } | null;
};

export type NotificationCopy = {
  title: string;
  body: string;
  deepLink: string;
  data: Record<string, unknown>;
};

function rfqDeepLink(externalRef: string | null | undefined): string {
  if (externalRef) {
    return `miningmobile://listing/equipment/${externalRef}`;
  }
  return 'miningmobile://home';
}

/** Maps RFQ Pub/Sub facts → mobile copy. Return null to skip delivery. */
export function mapRmsEventToNotification(event: RmsNotificationEvent): NotificationCopy | null {
  const requestId = event.external_ref ?? undefined;
  const deepLink = rfqDeepLink(requestId ?? null);
  const baseData: Record<string, unknown> = {
    trigger: event.trigger,
    rfqId: event.rfq_id,
    ...(requestId ? { requestId } : {}),
    ...(event.payload?.offer_id ? { offerId: event.payload.offer_id } : {}),
  };

  switch (event.trigger) {
    case 'offer_submitted':
      return {
        title: 'New offer',
        body: 'You received a new offer.',
        deepLink,
        data: baseData,
      };
    case 'offer_selected':
      return {
        title: 'Offer accepted',
        body: 'Your offer was accepted. Confirm it before the deadline.',
        deepLink,
        data: baseData,
      };
    case 'confirmation_reminder':
      return {
        title: 'Confirm your offer',
        body: 'Confirm your accepted offer before the deadline.',
        deepLink,
        data: baseData,
      };
    case 'offer_confirmed':
      return {
        title: 'Offer confirmed',
        body: 'An offer on your listing is confirmed.',
        deepLink,
        data: baseData,
      };
    case 'offer_declined':
    case 'offer_declined_by_responder':
      return {
        title: 'Offer declined',
        body: 'An offer on your listing was declined.',
        deepLink,
        data: baseData,
      };
    case 'offer_timed_out':
      return {
        title: 'Offer expired',
        body: 'An accepted offer expired before it was confirmed.',
        deepLink,
        data: baseData,
      };
    case 'offer_withdrawn':
      return {
        title: 'Offer withdrawn',
        body: 'An offer on your listing was withdrawn.',
        deepLink,
        data: baseData,
      };
    case 'rfq_partially_consolidated':
      return {
        title: 'Listing partly filled',
        body: 'Part of your listing has been filled.',
        deepLink,
        data: baseData,
      };
    case 'rfq_completed':
      return {
        title: 'Listing completed',
        body: 'Your listing is complete.',
        deepLink,
        data: baseData,
      };
    case 'rfq_closed':
      return {
        title: 'Listing closed',
        body: 'Your listing was closed.',
        deepLink,
        data: baseData,
      };
    case 'rfq_expired':
      return {
        title: 'Listing expired',
        body: 'Your listing expired without a deal.',
        deepLink,
        data: baseData,
      };
    case 'messaging_window_closing':
      return {
        title: 'Chat closing soon',
        body: 'The chat for this listing closes soon.',
        deepLink,
        data: baseData,
      };
    case 'rfq_created':
    case 'rfq_live':
      return null;
    default:
      return null;
  }
}

/** Prefer payload.recipient_id, else owner_id — both are RMS UUIDs until linked to mining users. */
export function resolveRmsRecipientId(event: RmsNotificationEvent): string | null {
  const fromPayload = event.payload?.recipient_id?.trim();
  if (fromPayload) return fromPayload;
  const owner = event.owner_id?.trim();
  return owner || null;
}
