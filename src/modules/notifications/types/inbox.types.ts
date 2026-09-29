export type InAppNotificationDto = {
  id: string;
  titleKey: string;
  bodyKey: string;
  sentAt: number;
  read: boolean;
  icon: string;
  target: 'Requests' | 'Messages' | 'HomeTab';
  listingId: string | null;
  listingCategory: 'equipment' | 'services' | 'gold' | null;
  conversationId: string | null;
};
