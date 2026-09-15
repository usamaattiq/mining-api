export type ChatRealtimeMessage = {
  conversationId: string;
  senderId: string;
  listingTitle: string;
  message: {
    id: string;
    text: string;
    sentAt: number;
  };
};
