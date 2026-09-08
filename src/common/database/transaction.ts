import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export function runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
