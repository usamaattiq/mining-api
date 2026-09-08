import type { NextFunction, Request, Response } from 'express';
import { sendError } from './api-response';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export function wrap(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } catch (error) {
      sendError(res, error);
    }
  };
}
