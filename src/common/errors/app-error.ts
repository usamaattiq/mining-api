import type { ErrorCode } from './error-codes';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
