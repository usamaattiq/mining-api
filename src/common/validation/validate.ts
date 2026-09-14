import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

declare global {
  namespace Express {
    interface Request {
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      throw new AppError(
        'Validation failed',
        400,
        ErrorCode.VALIDATION_ERROR,
        result.error.flatten().fieldErrors,
      );
    }

    const data = result.data as {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
    req.validatedBody = data.body;
    req.validatedQuery = data.query;
    req.validatedParams = data.params;
    next();
  };
}
