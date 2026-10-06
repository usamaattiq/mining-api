import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export function runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/**
 * Serializable transaction with retry-on-conflict, for check-then-write
 * flows (e.g. "is there a unit still available?" then "reserve it") where
 * two concurrent callers must not both pass the same check. Postgres aborts
 * the loser with error code 40001 under SERIALIZABLE isolation instead of
 * silently letting both writes through — retry a few times before giving up.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!isConflict || attempt === attempts) throw error;
    }
  }
  /* unreachable: loop always returns or throws */
  throw new Error('runSerializable: exhausted retries');
}
