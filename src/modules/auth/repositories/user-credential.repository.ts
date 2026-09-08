import type { Prisma, UserCredential } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

class UserCredentialRepository {
  findByUserId(userId: string, tx: Tx | typeof prisma = prisma): Promise<UserCredential | null> {
    return tx.userCredential.findUnique({ where: { userId } });
  }

  create(
    data: { userId: string; mpinHash: string },
    tx: Tx | typeof prisma = prisma,
  ): Promise<UserCredential> {
    return tx.userCredential.create({ data });
  }

  updateMpinHash(
    userId: string,
    mpinHash: string,
    tx: Tx | typeof prisma = prisma,
  ): Promise<UserCredential> {
    return tx.userCredential.update({
      where: { userId },
      data: { mpinHash, failedAttempts: 0, lockedUntil: null },
    });
  }

  recordFailedAttempt(
    userId: string,
    lockedUntil: Date | null,
    tx: Tx | typeof prisma = prisma,
  ): Promise<UserCredential> {
    return tx.userCredential.update({
      where: { userId },
      data: { failedAttempts: { increment: 1 }, lockedUntil },
    });
  }

  resetFailedAttempts(userId: string, tx: Tx | typeof prisma = prisma): Promise<UserCredential> {
    return tx.userCredential.update({
      where: { userId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }
}

export const userCredentialRepository = new UserCredentialRepository();
