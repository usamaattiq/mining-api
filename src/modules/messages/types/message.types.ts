export type ChatMessageDeliveryStatus = 'sent' | 'delivered' | 'read';

export type ChatMessageDto = {
  id: string;
  text: string;
  sentAt: number;
  fromMe: boolean;
  /** Present on the viewer's own messages. */
  status?: ChatMessageDeliveryStatus;
};

export type ConversationDto = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingCategory: 'equipment' | 'services' | 'gold';
  participantName: string;
  unreadCount: number;
  messages: ChatMessageDto[];
};
