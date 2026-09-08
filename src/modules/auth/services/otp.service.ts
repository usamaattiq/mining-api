import { randomInt } from 'crypto';
import type { OtpPurpose } from '@prisma/client';
import { env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { hashSecret, verifySecret } from '../../../common/security/password.service';
import { whatsappService } from '../../../integrations/whatsapp/whatsapp.service';
import { otpChallengeRepository } from '../repositories/otp-challenge.repository';

const MAX_OTP_ATTEMPTS = 5;
/** Max OTP send requests (including resends) per phone + purpose. */
const MAX_OTP_SENDS = 3;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
const VERIFIED_OTP_MAX_AGE_MS = 30 * 60 * 1000;
const DEV_OTP_CODE = '000000';

function generateOtpCode(): string {
  if (!env.OTP_REAL_ENABLED) {
    return DEV_OTP_CODE;
  }

  return String(randomInt(100000, 1000000));
}

function isRateLimitExemptPhone(phoneE164: string): boolean {
  return env.OTP_RATE_LIMIT_EXEMPT_PHONES.split(',')
    .map((phone) => phone.trim())
    .filter(Boolean)
    .includes(phoneE164);
}

class OtpService {
  async sendOtp(phoneE164: string, purpose: OtpPurpose): Promise<void> {
    const windowStart = new Date(Date.now() - OTP_SEND_WINDOW_MS);
    const recentSends = await otpChallengeRepository.countCreatedSince(
      phoneE164,
      purpose,
      windowStart,
    );

    if (recentSends >= MAX_OTP_SENDS && !isRateLimitExemptPhone(phoneE164)) {
      throw new AppError(
        'You have reached your OTP request limit. Please wait 10 minutes and try again.',
        429,
        ErrorCode.RATE_LIMITED,
      );
    }

    const code = generateOtpCode();
    const codeHash = await hashSecret(code);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);

    await otpChallengeRepository.create({ phoneE164, purpose, codeHash, expiresAt });

    if (!env.OTP_REAL_ENABLED) {
      // No SMS/WhatsApp provider wired up yet — log so dev/test can read the code.
      console.info(`[otp] ${purpose} code for ${phoneE164}: ${code}`);
      return;
    }

    if (whatsappService.isConfigured()) {
      await whatsappService.sendAuthenticationOtp(phoneE164, code);
      return;
    }

    throw new AppError('OTP delivery is not configured', 503, ErrorCode.INTERNAL_ERROR);
  }

  async verifyOtp(phoneE164: string, purpose: OtpPurpose, otp: string): Promise<void> {
    const challenge = await otpChallengeRepository.findLatest(phoneE164, purpose);

    if (!challenge || challenge.verifiedAt) {
      throw new AppError('Invalid or expired OTP', 400, ErrorCode.OTP_INVALID);
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppError('OTP has expired', 400, ErrorCode.OTP_EXPIRED);
    }

    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError('Too many OTP attempts', 429, ErrorCode.RATE_LIMITED);
    }

    const valid = await verifySecret(otp, challenge.codeHash);

    if (!valid) {
      await otpChallengeRepository.incrementAttempts(challenge.id);
      throw new AppError('Invalid or expired OTP', 400, ErrorCode.OTP_INVALID);
    }

    await otpChallengeRepository.markVerified(challenge.id);
  }

  async assertPhoneVerified(phoneE164: string, purpose: OtpPurpose): Promise<void> {
    const challenge = await otpChallengeRepository.findLatest(phoneE164, purpose);

    if (!challenge?.verifiedAt) {
      throw new AppError('Phone number is not verified', 400, ErrorCode.VALIDATION_ERROR);
    }

    if (Date.now() - challenge.verifiedAt.getTime() > VERIFIED_OTP_MAX_AGE_MS) {
      throw new AppError(
        'Phone verification expired. Request a new OTP.',
        400,
        ErrorCode.OTP_EXPIRED,
      );
    }
  }
}

export const otpService = new OtpService();
