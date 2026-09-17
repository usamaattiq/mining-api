import { Prisma } from '@prisma/client';
import type { Conversation, Message, User } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

export type ConversationWithRelations = Conversation & {
  listing: { id: string; title: string; category: 'equipment' | 'services' | 'gold' };
  buyer: Pick<User, 'id' | 'fullName'>;
  seller: Pick<User, 'id' | 'fullName'>;
  messages: Message[];
  receipts: { userId: string; lastReadAt: Date }[];
};

const conversationInclude = {
  listing: { select: { id: true, title: true, category: true } },
  buyer: { select: { id: true, fullName: true } },
  seller: { select: { id: true, fullName: true } },
  messages: { orderBy: { createdAt: 'asc' as const } },
  receipts: { select: { userId: true, lastReadAt: true } },
};

const conversationListInclude = {
  listing: { select: { id: true, title: true, category: true } },
  buyer: { select: { id: true, fullName: true } },
  seller: { select: { id: true, fullName: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  receipts: { select: { userId: true, lastReadAt: true } },
};

class ConversationRepository {
  findById(id: string, tx: Tx | typeof prisma = prisma): Promise<ConversationWithRelations | null> {
    return tx.conversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
  }

  findByListingAndBuyer(
    listingId: string,
    buyerId: string,
    tx: Tx | typeof prisma = prisma,
  ): Promise<ConversationWithRelations | null> {
    return tx.conversation.findUnique({
      where: { listingId_buyerId: { listingId, buyerId } },
      include: conversationInclude,
    });
  }

  listForUser(userId: string): Promise<ConversationWithRelations[]> {
    return prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: conversationListInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async unreadCounts(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    const unread = new Map<string, number>();
    if (conversationIds.length === 0) return unread;

    const rows = await prisma.$queryRaw<Array<{ conversationId: string; unread: number }>>(
      Prisma.sql`
        SELECT m."conversationId", COUNT(*)::int AS unread
        FROM messages m
        LEFT JOIN conversation_read_receipts r
          ON r."conversationId" = m."conversationId" AND r."userId" = ${userId}
        WHERE m."conversationId" IN (${Prisma.join(conversationIds)})
          AND m."senderId" <> ${userId}
          AND m."createdAt" > COALESCE(r."lastReadAt", TIMESTAMPTZ '1970-01-01')
        GROUP BY m."conversationId"
      `,
    );

    for (const row of rows) {
      unread.set(row.conversationId, row.unread);
    }
    return unread;
  }

  create(
    data: { listingId: string; buyerId: string; sellerId: string },
    tx: Tx | typeof prisma = prisma,
  ): Promise<ConversationWithRelations> {
    return tx.conversation.create({
      data,
      include: conversationInclude,
    });
  }

  touch(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  upsertReceipt(
    conversationId: string,
    userId: string,
    lastReadAt: Date,
    tx: Tx | typeof prisma = prisma,
  ) {
    return tx.conversationReadReceipt.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt },
      update: { lastReadAt },
    });
  }
}

export const conversationRepository = new ConversationRepository();
