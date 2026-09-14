import { AccountType, OtpPurpose, UserStatus } from '@prisma/client';
import { env } from '../../../config/env';
import { runInTransaction } from '../../../common/database/transaction';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { hashSecret, verifySecret } from '../../../common/security/password.service';
import { signUserAccessToken } from '../security/user-jwt.service';
import { userCredentialRepository } from '../repositories/user-credential.repository';
import { userRepository } from '../repositories/user.repository';
import { userSessionRepository } from '../repositories/user-session.repository';
import type { AuthLoginResultDto, AuthSignupResultDto, UserProfileDto } from '../types/auth.types';
import type {
  ChangeMpinBody,
  LoginMpinBody,
  LoginOtpSendBody,
  LoginOtpVerifyBody,
  ResetMpinBody,
  SignupEmailCheckBody,
  SignupOtpSendBody,
  SignupOtpVerifyBody,
  SignupSubmitBody,
  UpdateProfileBody,
} from '../validation/auth.validation';
import { resolvePhoneE164 } from '../utils/resolve-phone';
import { toUserProfileDto } from '../utils/user-profile.mapper';
import { otpService } from './otp.service';

const MPIN_PATTERN = /^\d{4}$/;

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = emptyToNull(value);
  return email ? email.toLowerCase() : null;
}

function mapLoginOtpPurpose(purpose: 'login' | 'mpin_reset'): OtpPurpose {
  return purpose === 'mpin_reset' ? OtpPurpose.MPIN_RESET : OtpPurpose.LOGIN;
}

class AuthService {
  async sendSignupOtp(input: SignupOtpSendBody): Promise<void> {
    const phoneE164 = resolvePhoneE164(input);
    const existing = await userRepository.findByPhoneE164(phoneE164);

    if (existing) {
      throw new AppError('This phone number is already registered', 409, ErrorCode.CONFLICT);
    }

    await otpService.sendOtp(phoneE164, OtpPurpose.SIGNUP);
  }

  async verifySignupOtp(input: SignupOtpVerifyBody): Promise<void> {
    const phoneE164 = resolvePhoneE164(input);
    await otpService.verifyOtp(phoneE164, OtpPurpose.SIGNUP, input.otp);
  }

  async checkSignupEmailAvailable(input: SignupEmailCheckBody): Promise<{ available: boolean }> {
    const email = normalizeEmail(input.email);
    const emailOwner = email ? await userRepository.findByEmail(email) : null;
    return { available: !emailOwner };
  }

  async submitSignup(input: SignupSubmitBody): Promise<AuthSignupResultDto> {
    if (!MPIN_PATTERN.test(input.mpin)) {
      throw new AppError('MPIN must be 4 digits', 400, ErrorCode.VALIDATION_ERROR);
    }

    const phoneE164 = resolvePhoneE164(input);
    await otpService.assertPhoneVerified(phoneE164, OtpPurpose.SIGNUP);

    const existing = await userRepository.findByPhoneE164(phoneE164);
    if (existing) {
      throw new AppError('This phone number is already registered', 409, ErrorCode.CONFLICT);
    }

    const email = normalizeEmail(input.email);
    if (email) {
      const emailOwner = await userRepository.findByEmail(email);
      if (emailOwner) {
        throw new AppError('This email is already in use', 409, ErrorCode.CONFLICT);
      }
    }

    if (input.accountType === 'company' && !input.companyName?.trim()) {
      throw new AppError('Company name is required', 400, ErrorCode.VALIDATION_ERROR);
    }

    const mpinHash = await hashSecret(input.mpin);
    const coords = input.locationCoordinates ?? null;

    const user = await runInTransaction(async (tx) => {
      const created = await userRepository.create(
        {
          fullName: input.fullName.trim(),
          phoneE164,
          countryCode: input.countryCode.toUpperCase(),
          countryCallingCode: input.countryCallingCode.replace(/^\+/, ''),
          email,
          address: emptyToNull(input.address),
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          avatarUrl: input.avatarUrl ?? null,
          accountType:
            input.accountType === 'company' ? AccountType.COMPANY : AccountType.INDIVIDUAL,
          companyName: input.accountType === 'company' ? emptyToNull(input.companyName) : null,
          biometricEnabled: input.biometricEnabled,
          isVerified: false,
        },
        tx,
      );

      await userCredentialRepository.create({ userId: created.id, mpinHash }, tx);
      return created;
    });

    const loginResult = await this.issueLoginResult(user.id, { deviceId: input.deviceId });

    return {
      userId: user.id,
      accessToken: loginResult.accessToken,
      profile: loginResult.profile,
    };
  }

  async sendLoginOtp(input: LoginOtpSendBody): Promise<void> {
    const phoneE164 = resolvePhoneE164(input);
    const existing = await userRepository.findByPhoneE164(phoneE164);

    if (!existing) {
      throw new AppError('No account found for this phone number', 404, ErrorCode.USER_NOT_FOUND);
    }

    this.assertCanAuthenticate(existing.status);
    await otpService.sendOtp(phoneE164, mapLoginOtpPurpose(input.purpose));
  }

  async verifyLoginOtp(input: LoginOtpVerifyBody): Promise<void> {
    const phoneE164 = resolvePhoneE164(input);
    await otpService.verifyOtp(phoneE164, mapLoginOtpPurpose(input.purpose), input.otp);
  }

  async loginWithMpin(input: LoginMpinBody): Promise<AuthLoginResultDto> {
    if (!MPIN_PATTERN.test(input.mpin)) {
      throw new AppError('Invalid MPIN', 400, ErrorCode.VALIDATION_ERROR);
    }

    const phoneE164 = resolvePhoneE164(input);
    const user = await userRepository.findByPhoneE164(phoneE164);

    if (!user) {
      throw new AppError('Invalid phone number or MPIN', 401, ErrorCode.INVALID_CREDENTIALS);
    }

    this.assertCanAuthenticate(user.status);

    const isKnownDevice = await userSessionRepository.existsForUserAndDevice(
      user.id,
      input.deviceId,
    );
    if (!isKnownDevice) {
      await otpService.assertPhoneVerified(phoneE164, OtpPurpose.LOGIN);
    }

    await this.verifyMpinForUser(user.id, input.mpin);

    return this.issueLoginResult(user.id, { deviceId: input.deviceId });
  }

  async resetMpin(input: ResetMpinBody): Promise<AuthLoginResultDto> {
    const phoneE164 = resolvePhoneE164(input);
    const user = await userRepository.findByPhoneE164(phoneE164);

    if (!user) {
      throw new AppError('No account found for this phone number', 404, ErrorCode.USER_NOT_FOUND);
    }

    this.assertCanAuthenticate(user.status);
    await otpService.assertPhoneVerified(phoneE164, OtpPurpose.MPIN_RESET);

    const mpinHash = await hashSecret(input.newMpin);
    await userCredentialRepository.updateMpinHash(user.id, mpinHash);

    return this.issueLoginResult(user.id, { deviceId: input.deviceId });
  }

  async changeMpin(userId: string, input: ChangeMpinBody): Promise<void> {
    if (input.currentMpin === input.newMpin) {
      throw new AppError('New MPIN must be different', 400, ErrorCode.VALIDATION_ERROR);
    }

    const credential = await userCredentialRepository.findByUserId(userId);
    if (!credential) {
      throw new AppError('MPIN is not set for this account', 400, ErrorCode.VALIDATION_ERROR);
    }

    const valid = await verifySecret(input.currentMpin, credential.mpinHash);
    if (!valid) {
      throw new AppError('Current MPIN is incorrect', 401, ErrorCode.INVALID_CREDENTIALS);
    }

    const nextHash = await hashSecret(input.newMpin);
    await userCredentialRepository.updateMpinHash(userId, nextHash);
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    }

    const credential = await userCredentialRepository.findByUserId(userId);
    return toUserProfileDto(user, { hasMpin: Boolean(credential) });
  }

  async updateProfile(userId: string, input: UpdateProfileBody): Promise<UserProfileDto> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    }

    const nextEmail = input.email !== undefined ? normalizeEmail(input.email) : undefined;
    if (nextEmail) {
      const emailOwner = await userRepository.findByEmail(nextEmail);
      if (emailOwner && emailOwner.id !== userId) {
        throw new AppError('This email is already in use', 409, ErrorCode.CONFLICT);
      }
    }

    const coords = input.locationCoordinates;

    if (input.accountType === 'company' && input.companyName !== undefined && !input.companyName) {
      throw new AppError('Company name is required', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await userRepository.updateProfile(userId, {
      ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
      ...(input.accountType !== undefined
        ? {
            accountType:
              input.accountType === 'company' ? AccountType.COMPANY : AccountType.INDIVIDUAL,
            ...(input.accountType === 'individual' ? { companyName: null } : {}),
          }
        : {}),
      ...(input.companyName !== undefined ? { companyName: emptyToNull(input.companyName) } : {}),
      ...(nextEmail !== undefined ? { email: nextEmail } : {}),
      ...(input.address !== undefined ? { address: emptyToNull(input.address) } : {}),
      ...(coords !== undefined
        ? { latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null }
        : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.biometricEnabled !== undefined ? { biometricEnabled: input.biometricEnabled } : {}),
    });

    const credential = await userCredentialRepository.findByUserId(userId);
    return toUserProfileDto(updated, { hasMpin: Boolean(credential) });
  }

  async logout(sessionJti: string): Promise<void> {
    await userSessionRepository.revokeByJti(sessionJti);
  }

  private assertCanAuthenticate(status: UserStatus): void {
    if (status === UserStatus.SUSPENDED) {
      throw new AppError('Account is suspended', 403, ErrorCode.FORBIDDEN);
    }
    if (status === UserStatus.DEACTIVATED) {
      throw new AppError('Account is deactivated', 403, ErrorCode.FORBIDDEN);
    }
  }

  private async verifyMpinForUser(userId: string, mpin: string): Promise<void> {
    const credential = await userCredentialRepository.findByUserId(userId);

    if (!credential) {
      throw new AppError('MPIN is not set for this account', 400, ErrorCode.VALIDATION_ERROR);
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      throw new AppError('Account is temporarily locked', 423, ErrorCode.ACCOUNT_LOCKED);
    }

    const valid = await verifySecret(mpin, credential.mpinHash);

    if (!valid) {
      const nextAttempts = credential.failedAttempts + 1;
      const shouldLock = nextAttempts >= env.MPIN_LOCKOUT_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + env.MPIN_LOCKOUT_MINUTES * 60 * 1000)
        : null;

      await userCredentialRepository.recordFailedAttempt(userId, lockedUntil);
      throw new AppError('Invalid phone number or MPIN', 401, ErrorCode.INVALID_CREDENTIALS);
    }

    await userCredentialRepository.resetFailedAttempts(userId);
  }

  private async issueLoginResult(
    userId: string,
    options: { deviceId: string },
  ): Promise<AuthLoginResultDto> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    }

    this.assertCanAuthenticate(user.status);

    const signed = await signUserAccessToken({ sub: user.id });

    await runInTransaction(async (tx) => {
      await userSessionRepository.revokeAllForUser(user.id, tx);
      await userSessionRepository.create(
        { userId: user.id, deviceId: options.deviceId, jti: signed.jti },
        tx,
      );
      await userRepository.touchLastLogin(user.id, tx);
    });

    const credential = await userCredentialRepository.findByUserId(user.id);

    return {
      accessToken: signed.token,
      profile: toUserProfileDto(user, { hasMpin: Boolean(credential) }),
    };
  }
}

export const authService = new AuthService();
