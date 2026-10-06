import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/common/database/prisma';
import { authService } from '../../src/modules/auth/services/auth.service';
import { verifyUserAccessToken } from '../../src/modules/auth/security/user-jwt.service';
import { userSessionRepository } from '../../src/modules/auth/repositories/user-session.repository';
import { AppError } from '../../src/common/errors/app-error';
import { ErrorCode } from '../../src/common/errors/error-codes';

const DEV_OTP_CODE = '000000';

function uniquePhone(suffix: string): { countryCallingCode: string; phoneDigits: string } {
  // Random 10-digit local number per test run so re-runs never collide on
  // the unique phoneE164 constraint.
  const digits = `555${suffix}`.padEnd(10, '0').slice(0, 10);
  return { countryCallingCode: '1', phoneDigits: digits };
}

async function signUp(
  phone: { countryCallingCode: string; phoneDigits: string },
  deviceId: string,
) {
  await authService.sendSignupOtp(phone);
  await authService.verifySignupOtp({ ...phone, otp: DEV_OTP_CODE });
  return authService.submitSignup({
    ...phone,
    countryCode: 'US',
    fullName: 'Auth Flow Test',
    accountType: 'individual',
    mpin: '1234',
    biometricEnabled: false,
    deviceId,
  });
}

describe('auth flow', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('signup issues an access token, a refresh token, and a session', async () => {
    const phone = uniquePhone(randomUUID().replace(/\D/g, '').slice(0, 7));
    const result = await signUp(phone, 'device-AAAAAAAA');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toContain('.');

    const payload = verifyUserAccessToken(result.accessToken);
    expect(await userSessionRepository.isActive(payload.jti)).toBe(true);
  });

  it('login from a known device skips OTP; from an unknown device requires it', async () => {
    const phone = uniquePhone(randomUUID().replace(/\D/g, '').slice(0, 7));
    const knownDevice = 'device-KNOWN111';
    await signUp(phone, knownDevice);

    // Known device: no OTP needed.
    const knownLogin = await authService.loginWithMpin({
      ...phone,
      mpin: '1234',
      deviceId: knownDevice,
    });
    expect(knownLogin.accessToken).toBeTruthy();

    // Unknown device: rejected until the phone is verified for LOGIN.
    const unknownDevice = 'device-UNKNOWN2';
    await expect(
      authService.loginWithMpin({ ...phone, mpin: '1234', deviceId: unknownDevice }),
    ).rejects.toMatchObject({ status: 400 });

    await authService.sendLoginOtp({ ...phone, purpose: 'login' });
    await authService.verifyLoginOtp({ ...phone, otp: DEV_OTP_CODE, purpose: 'login' });

    const unknownLogin = await authService.loginWithMpin({
      ...phone,
      mpin: '1234',
      deviceId: unknownDevice,
    });
    expect(unknownLogin.accessToken).toBeTruthy();
  });

  it('locks the account after too many wrong MPIN attempts, even with the right MPIN after that', async () => {
    const phone = uniquePhone(randomUUID().replace(/\D/g, '').slice(0, 7));
    const deviceId = 'device-LOCKOUT1';
    await signUp(phone, deviceId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        authService.loginWithMpin({ ...phone, mpin: '0000', deviceId }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    }

    await expect(
      authService.loginWithMpin({ ...phone, mpin: '1234', deviceId }),
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED });
  });

  it('logout revokes the session', async () => {
    const phone = uniquePhone(randomUUID().replace(/\D/g, '').slice(0, 7));
    const result = await signUp(phone, 'device-LOGOUT11');
    const payload = verifyUserAccessToken(result.accessToken);

    await authService.logout(payload.jti);

    expect(await userSessionRepository.isActive(payload.jti)).toBe(false);
  });

  it('refresh rotates the token pair and rejects the old refresh token afterward', async () => {
    const phone = uniquePhone(randomUUID().replace(/\D/g, '').slice(0, 7));
    const result = await signUp(phone, 'device-REFRESH1');

    const rotated = await authService.refreshSession(result.refreshToken);
    expect(rotated.accessToken).not.toBe(result.accessToken);
    expect(rotated.refreshToken).not.toBe(result.refreshToken);

    // New access token authenticates.
    const newPayload = verifyUserAccessToken(rotated.accessToken);
    expect(await userSessionRepository.isActive(newPayload.jti)).toBe(true);

    // Replaying the old (already-rotated-out) refresh token is rejected —
    // and treated as a theft signal, so the whole session gets revoked.
    await expect(authService.refreshSession(result.refreshToken)).rejects.toBeInstanceOf(AppError);
    expect(await userSessionRepository.isActive(newPayload.jti)).toBe(false);
  });
});
