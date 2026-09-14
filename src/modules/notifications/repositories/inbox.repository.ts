import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

class InboxRepository {
  create(
    data: {
      userId: string;
      titleKey: string;
      bodyKey: string;
      icon: string;
      target: 'Requests' | 'Messages' | 'HomeTab';
      listingId?: string | null;
      conversationId?: string | null;
    },
    tx: Tx | typeof prisma = prisma,
  ) {
    return tx.inAppNotification.create({ data });
  }

  listForUser(userId: string) {
    return prisma.inAppNotification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
    });
  }

  markRead(userId: string, id: string) {
    return prisma.inAppNotification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  markAllRead(userId: string) {
    return prisma.inAppNotification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}

export const inboxRepository = new InboxRepository();
