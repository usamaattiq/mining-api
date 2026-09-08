import { OtpPurpose } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { verifyUserAccessToken } from '../../auth/security/user-jwt.service';
import { userSessionRepository } from '../../auth/repositories/user-session.repository';
import { resolvePhoneE164 } from '../../auth/utils/resolve-phone';
import { otpService } from '../../auth/services/otp.service';

// Locations is called both by logged-in users (trip creation, address edit) and
// by the signup flow before an account exists — mirrors the media presign auth
// pattern: live session JWT, or a phone that just completed SIGNUP OTP.
export async function assertCallerAllowed(
  req: AuthenticatedRequest,
  dialCode: string | undefined,
  phoneNumber: string | undefined,
): Promise<void> {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (token) {
    let payload;
    try {
      payload = verifyUserAccessToken(token);
    } catch {
      throw new AppError('Invalid or expired session', 401, ErrorCode.UNAUTHORIZED);
    }

    const isActive = await userSessionRepository.isActive(payload.jti);
    if (!isActive) {
      throw new AppError('Session has been revoked', 401, ErrorCode.UNAUTHORIZED);
    }
    return;
  }

  if (!dialCode || !phoneNumber) {
    throw new AppError('Missing bearer token or dialCode/phoneNumber', 401, ErrorCode.UNAUTHORIZED);
  }

  const phoneE164 = resolvePhoneE164({ countryCallingCode: dialCode, phoneDigits: phoneNumber });
  await otpService.assertPhoneVerified(phoneE164, OtpPurpose.SIGNUP);
}
