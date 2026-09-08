import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

declare global {
  namespace Express {
    interface Request {
      validatedBody?: unknown;
    }
  }
}

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse({ body: req.body });

    if (!result.success) {
      throw new AppError(
        'Validation failed',
        400,
        ErrorCode.VALIDATION_ERROR,
        result.error.flatten().fieldErrors,
      );
    }

    req.validatedBody = (result.data as { body: unknown }).body;
    next();
  };
}
