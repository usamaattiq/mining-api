import type { NextFunction, Response } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { verifyUserAccessToken } from '../security/user-jwt.service';
import { userSessionRepository } from '../repositories/user-session.repository';

export async function authenticateUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    throw new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED);
  }

  let payload;
  try {
    payload = verifyUserAccessToken(token);
  } catch {
    throw new AppError('Invalid or expired session', 401, ErrorCode.UNAUTHORIZED);
  }

  const isActive = await userSessionRepository.isActive(payload.jti);
  if (!isActive) {
    throw new AppError('Session has been revoked', 401, ErrorCode.UNAUTHORIZED);
  }

  req.user = { id: payload.sub };
  req.sessionJti = payload.jti;
  next();
}
