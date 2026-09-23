export type ChatReadReceipt = {
  conversationId: string;
  readerId: string;
  readAt: number;
};

export type ChatRealtimeMessage = {
  conversationId: string;
  senderId: string;
  listingTitle: string;
  message: {
    id: string;
    text: string;
    sentAt: number;
    status?: 'sent' | 'delivered' | 'read';
  };
};
