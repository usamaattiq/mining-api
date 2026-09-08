import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export function sendSuccess<T>(res: Response, status: number, data: T): void {
  res.status(status).json({ success: true, data });
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    success: false,
    error: { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong' },
  });
}
