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

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  OTP_EXPIRES_MINUTES: z.coerce.number().default(5),
  OTP_REAL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MPIN_LOCKOUT_ATTEMPTS: z.coerce.number().default(5),
  MPIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  /** Comma-separated E.164 phone numbers exempt from the OTP send-rate-limit (testing/QA). */
  OTP_RATE_LIMIT_EXEMPT_PHONES: z.string().default(''),

  // WhatsApp (OTP delivery)
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_BASE_URL: z.string().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z.string().default('v22.0'),
  WHATSAPP_API_TIMEOUT: z.coerce.number().default(30000),
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().default('otp'),
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: z.string().default('en_US'),
  PLATFORM_DISPLAY_NAME: z.string().default('Dahabi'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
