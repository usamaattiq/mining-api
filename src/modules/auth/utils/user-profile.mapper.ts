import type { User } from '@prisma/client';
import type { UserProfileDto } from '../types/auth.types';

export function toUserProfileDto(user: User, options: { hasMpin: boolean }): UserProfileDto {
  return {
    id: user.id,
    fullName: user.fullName,
    phoneE164: user.phoneE164,
    countryCode: user.countryCode,
    countryCallingCode: user.countryCallingCode,
    email: user.email,
    address: user.address,
    latitude: user.latitude,
    longitude: user.longitude,
    avatarUrl: user.avatarUrl,
    accountType:
      user.accountType === 'ADMIN'
        ? 'admin'
        : user.accountType === 'COMPANY'
          ? 'company'
          : 'individual',
    companyName: user.companyName,
    biometricEnabled: user.biometricEnabled,
    isVerified: user.isVerified,
    hasMpin: options.hasMpin,
  };
}
