import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

class MessageRepository {
  create(
    data: { conversationId: string; senderId: string; text: string },
    tx: Tx | typeof prisma = prisma,
  ) {
    return tx.message.create({ data });
  }
}

export const messageRepository = new MessageRepository();
