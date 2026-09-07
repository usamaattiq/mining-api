import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../http/authenticated-request';

// PLACEHOLDER until the real auth module lands (JWT verification etc).
// Reads a trusted-gateway-style `x-user-id` header so downstream code can
// already depend on `req.user.id` and won't need to change when the real
// middleware replaces this one.
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const userId = req.header('x-user-id');

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.user = { id: userId };
  next();
}
