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
  participantName: string;
  unreadCount: number;
  messages: ChatMessageDto[];
};
