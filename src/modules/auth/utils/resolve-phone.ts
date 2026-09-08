interface PhoneIdentityInput {
  phoneNumber?: string;
  countryCallingCode?: string;
  phoneDigits?: string;
}

export function resolvePhoneE164(input: PhoneIdentityInput): string {
  if (input.phoneNumber) {
    return input.phoneNumber.startsWith('+') ? input.phoneNumber : `+${input.phoneNumber}`;
  }

  const callingCode = (input.countryCallingCode ?? '').replace(/^\+/, '');
  return `+${callingCode}${input.phoneDigits ?? ''}`;
}
