export type ChatMessageDto = {
  id: string;
  text: string;
  sentAt: number;
  fromMe: boolean;
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
