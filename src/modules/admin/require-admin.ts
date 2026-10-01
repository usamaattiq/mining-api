import type { NextFunction, Response } from 'express';
import { AccountType, UserStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthenticatedRequest } from '../../common/http/authenticated-request';
import { prisma } from '../../common/database/prisma';

export async function requireAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountType: true, status: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
    throw new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED);
  }

  if (user.accountType !== AccountType.ADMIN) {
    throw new AppError('Admin access required', 403, ErrorCode.FORBIDDEN);
  }

  next();
}
