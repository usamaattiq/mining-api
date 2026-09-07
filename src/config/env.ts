import 'dotenv/config';
import { z } from 'zod';

// Only the vars needed so far (server + Ping integration). Extend as other
// integrations (RFQ, Auction, SmartBackload, WhatsApp, S3) get wired up.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Ping (centralized push notification service)
  PING_BASE_URL: z.string().url('PING_BASE_URL must be a valid URL'),
  PING_API_KEY: z.string().min(1, 'PING_API_KEY is required'),
  PING_API_TIMEOUT: z.coerce.number().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
