import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { runInTransaction } from '../../../common/database/transaction';
import { listingRepository } from '../../listings/repositories/listing.repository';
import { inboxRepository } from '../../notifications/repositories/inbox.repository';
import { notifyService } from '../../notifications/services/notify.service';
import { conversationRepository } from '../repositories/conversation.repository';
import { messageRepository } from '../repositories/message.repository';
import type { ConversationDto } from '../types/message.types';
import { toConversationDto } from '../utils/conversation.mapper';
import { emitChatMessage } from '../../../realtime/chat.emitter';

function assertParticipant(buyerId: string, sellerId: string, userId: string): void {
  if (buyerId !== userId && sellerId !== userId) {
    throw new AppError('Forbidden', 403, ErrorCode.FORBIDDEN);
  }
}

class MessageService {
  async listConversations(userId: string): Promise<ConversationDto[]> {
    const rows = await conversationRepository.listForUser(userId);
    const unread = await conversationRepository.unreadCounts(
      userId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toConversationDto(row, userId, unread.get(row.id) ?? 0));
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, ErrorCode.NOT_FOUND);
    }
    assertParticipant(conversation.buyerId, conversation.sellerId, userId);
    return toConversationDto(conversation, userId);
  }

  async startConversation(userId: string, listingId: string): Promise<ConversationDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.ownerId === userId) {
      throw new AppError('Cannot message your own listing', 400, ErrorCode.VALIDATION_ERROR);
    }

    const existing = await conversationRepository.findByListingAndBuyer(listingId, userId);
    if (existing) {
      return toConversationDto(existing, userId);
    }

    const created = await conversationRepository.create({
      listingId,
      buyerId: userId,
      sellerId: listing.ownerId,
    });
    return toConversationDto(created, userId);
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    text: string,
  ): Promise<ConversationDto> {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, ErrorCode.NOT_FOUND);
    }
    assertParticipant(conversation.buyerId, conversation.sellerId, userId);

    const recipientId =
      conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;

    const updated = await runInTransaction(async (tx) => {
      const created = await messageRepository.create(
        { conversationId, senderId: userId, text },
        tx,
      );
      await conversationRepository.touch(conversationId, tx);
      await conversationRepository.upsertReceipt(conversationId, userId, new Date(), tx);
      await inboxRepository.create(
        {
          userId: recipientId,
          titleKey: 'notifications.messageTitle',
          bodyKey: 'notifications.messageBody',
          icon: 'chatbubble-ellipses-outline',
          target: 'Messages',
          listingId: conversation.listingId,
          conversationId,
        },
        tx,
      );
      return { row: await conversationRepository.findById(conversationId, tx), created };
    });

    if (!updated.row) {
      throw new AppError('Conversation not found', 404, ErrorCode.NOT_FOUND);
    }

    emitChatMessage(conversation.buyerId, conversation.sellerId, {
      conversationId,
      senderId: userId,
      listingTitle: updated.row.listing.title,
      message: {
        id: updated.created.id,
        text: updated.created.text,
        sentAt: updated.created.createdAt.getTime(),
      },
    });

    void notifyService
      .notifyUser({
        userId: recipientId,
        title: 'New message',
        body: text.slice(0, 120),
        deepLink: `miningmobile://conversation/${conversationId}`,
        data: { conversationId, listingId: conversation.listingId },
        idempotencyKey: `message-${updated.created.id}`,
      })
      .catch(() => undefined);

    return toConversationDto(updated.row, userId);
  }

  async markRead(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, ErrorCode.NOT_FOUND);
    }
    assertParticipant(conversation.buyerId, conversation.sellerId, userId);
    await conversationRepository.upsertReceipt(conversationId, userId, new Date());
    const refreshed = await conversationRepository.findById(conversationId);
    return toConversationDto(refreshed ?? conversation, userId);
  }
}

export const messageService = new MessageService();
