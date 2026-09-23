import type { ConversationWithRelations } from '../repositories/conversation.repository';
import type { ChatMessageDto, ConversationDto } from '../types/message.types';

export function toConversationDto(
  conversation: ConversationWithRelations,
  viewerId: string,
  unreadOverride?: number,
): ConversationDto {
  const counterpart = conversation.buyerId === viewerId ? conversation.seller : conversation.buyer;
  const receipt = conversation.receipts.find((item) => item.userId === viewerId);
  const lastReadAt = receipt?.lastReadAt ?? new Date(0);
  const peerId = conversation.buyerId === viewerId ? conversation.sellerId : conversation.buyerId;
  const peerReadAt =
    conversation.receipts.find((item) => item.userId === peerId)?.lastReadAt ?? new Date(0);

  const chronological = [...conversation.messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const messages: ChatMessageDto[] = chronological.map((message) => {
    const fromMe = message.senderId === viewerId;
    return {
      id: message.id,
      text: message.text,
      sentAt: message.createdAt.getTime(),
      fromMe,
      ...(fromMe
        ? { status: message.createdAt.getTime() <= peerReadAt.getTime() ? 'read' : 'sent' }
        : {}),
    };
  });

  const unreadCount =
    unreadOverride ??
    chronological.filter(
      (message) => message.senderId !== viewerId && message.createdAt > lastReadAt,
    ).length;

  return {
    id: conversation.id,
    listingId: conversation.listingId,
    listingTitle: conversation.listing.title,
    listingCategory: conversation.listing.category,
    participantName: counterpart.fullName,
    unreadCount,
    messages,
  };
}
