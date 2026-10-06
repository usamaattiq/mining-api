import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});
