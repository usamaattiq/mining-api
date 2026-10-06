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

function parsePhoneList(value: string): string[] {
  return value
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function isReviewOtpPhone(phoneE164: string): boolean {
  return parsePhoneList(env.REVIEW_OTP_PHONES).includes(phoneE164);
}

function generateOtpCode(phoneE164: string): string {
  if (isReviewOtpPhone(phoneE164)) {
    return env.REVIEW_OTP_CODE;
  }

  if (!env.OTP_REAL_ENABLED) {
    return DEV_OTP_CODE;
  }

  return String(randomInt(100000, 1000000));
}

function isRateLimitExemptPhone(phoneE164: string): boolean {
  return (
    isReviewOtpPhone(phoneE164) ||
    parsePhoneList(env.OTP_RATE_LIMIT_EXEMPT_PHONES).includes(phoneE164)
  );
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

    const code = generateOtpCode(phoneE164);
    const codeHash = await hashSecret(code);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);

    await otpChallengeRepository.create({ phoneE164, purpose, codeHash, expiresAt });

    if (isReviewOtpPhone(phoneE164) || !env.OTP_REAL_ENABLED) {
      // Review / local: do not send WhatsApp. Reviewers use the fixed code.
      // env.ts refuses to boot in production unless OTP_REAL_ENABLED=true,
      // so the !OTP_REAL_ENABLED branch only reaches here in dev/test —
      // this check is defense in depth, not the primary guard.
      if (env.NODE_ENV !== 'production') {
        console.info(`[otp] ${purpose} code for ${phoneE164}: ${code}`);
      }
      return;
    }

    if (whatsappService.isConfigured()) {
      await whatsappService.sendAuthenticationOtp(phoneE164, code);
      return;
    }

    throw new AppError('OTP delivery is not configured', 503, ErrorCode.INTERNAL_ERROR);
  }

  async verifyOtp(phoneE164: string, purpose: OtpPurpose, otp: string): Promise<void> {
    if (isReviewOtpPhone(phoneE164) && otp === env.REVIEW_OTP_CODE) {
      const existing = await otpChallengeRepository.findLatest(phoneE164, purpose);
      if (existing && !existing.verifiedAt) {
        await otpChallengeRepository.markVerified(existing.id);
        return;
      }

      const codeHash = await hashSecret(otp);
      const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000);
      const created = await otpChallengeRepository.create({
        phoneE164,
        purpose,
        codeHash,
        expiresAt,
      });
      await otpChallengeRepository.markVerified(created.id);
      return;
    }

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
