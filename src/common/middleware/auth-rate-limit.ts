import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 20;

// In-memory per-IP limiter for the public auth routes. Good enough for a
// single-instance deployment; swap for a shared store (Redis) if scaled out.
const hits = new Map<string, { count: number; resetAt: number }>();

export function authRateLimiter(req: Request, _res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  entry.count += 1;

  if (entry.count > MAX_REQUESTS) {
    throw new AppError('Too many requests. Please try again shortly.', 429, ErrorCode.RATE_LIMITED);
  }

  next();
}
