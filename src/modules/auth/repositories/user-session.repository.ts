import type { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

class UserSessionRepository {
  async existsForUserAndDevice(
    userId: string,
    deviceId: string,
    tx: Tx | typeof prisma = prisma,
  ): Promise<boolean> {
    const session = await tx.userSession.findFirst({
      where: { userId, deviceId },
    });
    return Boolean(session);
  }

  create(data: { userId: string; deviceId: string; jti: string }, tx: Tx | typeof prisma = prisma) {
    return tx.userSession.create({ data });
  }

  revokeAllForUser(userId: string, tx: Tx | typeof prisma = prisma) {
    return tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeByJti(jti: string, tx: Tx | typeof prisma = prisma) {
    return tx.userSession.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async isActive(jti: string, tx: Tx | typeof prisma = prisma): Promise<boolean> {
    const session = await tx.userSession.findUnique({ where: { jti } });
    return Boolean(session && !session.revokedAt);
  }
}

export const userSessionRepository = new UserSessionRepository();
