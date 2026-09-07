import { PrismaClient } from '@prisma/client';

// Single shared Prisma instance for the whole process.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
});
