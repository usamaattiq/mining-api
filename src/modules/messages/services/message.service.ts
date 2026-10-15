import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { prisma } from '../../../common/database/prisma';
import { runInTransaction } from '../../../common/database/transaction';
import { listingRepository } from '../../listings/repositories/listing.repository';
import { inboxRepository } from '../../notifications/repositories/inbox.repository';
import { notifyService } from '../../notifications/services/notify.service';
import { conversationRepository } from '../repositories/conversation.repository';
import { messageRepository } from '../repositories/message.repository';
import type { ConversationDto } from '../types/message.types';
import { toConversationDto } from '../utils/conversation.mapper';
import { emitChatMessage, emitChatRead } from '../../../realtime/chat.emitter';
import { auctionClient } from '../../../integrations/auction/auction.client';
import { auctionSnapshotToRfq } from '../../listings/utils/listing-rfq';
import { messageOnSendEnabled } from '../../admin/app-settings';

async function buyerHasSentOffer(
  category: string,
  rfqId: string,
  ownerId: string,
  buyerId: string,
): Promise<boolean> {
  const snapshot =
    category === 'gold'
      ? auctionSnapshotToRfq(await auctionClient.getSnapshot(rfqId, ownerId))
      : await rfqClient.getSnapshot(rfqId, ownerId);
  const messageOnSend = await messageOnSendEnabled();
  return (snapshot.offers ?? []).some((offer) => {
    const responderId = String(offer.responder_id ?? offer.responderId ?? '');
    if (responderId !== buyerId) return false;
    if (messageOnSend && category === 'gold') return true;
    if (messageOnSend) {
      return (
        offer.status === 'active' || offer.status === 'selected' || offer.status === 'confirmed'
      );
    }
    return offer.status === 'selected' || offer.status === 'confirmed';
  });
}

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

  async startConversation(
    userId: string,
    listingId: string,
    buyerId?: string,
  ): Promise<ConversationDto> {
    const listing = await listingRepository.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    if (listing.ownerId === userId) {
      if (!buyerId) {
        throw new AppError('Cannot message your own listing', 400, ErrorCode.VALIDATION_ERROR);
      }
      const supplierEquipment = listing.category === 'equipment' && listing.postedAs === 'supplier';
      if (supplierEquipment) {
        const hold = await prisma.equipmentHold.findFirst({
          where: { listingId, buyerId, status: { in: ['selected', 'active'] } },
        });
        const offerOpen =
          hold != null ||
          (listing.rfqId
            ? await buyerHasSentOffer(listing.category, listing.rfqId, userId, buyerId)
            : false);
        if (!offerOpen) {
          throw new AppError('Messaging opens after an offer is sent', 403, ErrorCode.FORBIDDEN);
        }
      } else {
        if (!listing.rfqId) {
          throw new AppError('Cannot message your own listing', 400, ErrorCode.VALIDATION_ERROR);
        }
        const canMessage = await buyerHasSentOffer(
          listing.category,
          listing.rfqId,
          userId,
          buyerId,
        );
        if (!canMessage) {
          throw new AppError('Messaging opens after an offer is sent', 403, ErrorCode.FORBIDDEN);
        }
      }
      const existing = await conversationRepository.findByListingAndBuyer(listingId, buyerId);
      if (existing) {
        return toConversationDto(existing, userId);
      }
      const created = await conversationRepository.create({
        listingId,
        buyerId,
        sellerId: userId,
      });
      return toConversationDto(created, userId);
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
          bodyKey: text.slice(0, 120),
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
        status: 'sent' as const,
      },
    });

    void notifyService
      .notifyUser({
        userId: recipientId,
        title: 'New message',
        body: `${updated.row.listing.title}: ${text.slice(0, 100)}`,
        deepLink: `miningmobile://conversation/${conversationId}`,
        data: { conversationId, listingId: conversation.listingId },
        idempotencyKey: `message-${updated.created.id}`,
      })
      .catch((error) => {
        console.error('Push notify failed for message', {
          conversationId,
          recipientId,
          error,
        });
      });

    return toConversationDto(updated.row, userId);
  }

  async markRead(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404, ErrorCode.NOT_FOUND);
    }
    assertParticipant(conversation.buyerId, conversation.sellerId, userId);
    const readAt = new Date();
    await conversationRepository.upsertReceipt(conversationId, userId, readAt);
    emitChatRead(conversation.buyerId, conversation.sellerId, {
      conversationId,
      readerId: userId,
      readAt: readAt.getTime(),
    });
    const refreshed = await conversationRepository.findById(conversationId);
    return toConversationDto(refreshed ?? conversation, userId);
  }
}

export const messageService = new MessageService();
