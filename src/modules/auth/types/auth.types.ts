export interface UserProfileDto {
  id: string;
  fullName: string;
  phoneE164: string;
  countryCode: string;
  countryCallingCode: string;
  email: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  avatarUrl: string | null;
  accountType: 'individual' | 'company' | 'admin';
  companyName: string | null;
  biometricEnabled: boolean;
  isVerified: boolean;
  hasMpin: boolean;
}

export interface AuthLoginResultDto {
  accessToken: string;
  profile: UserProfileDto;
}

export interface AuthSignupResultDto {
  userId: string;
  accessToken: string;
  profile: UserProfileDto;
}
