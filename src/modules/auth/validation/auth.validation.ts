import { z } from 'zod';

const mpinSchema = z.string().regex(/^\d{4}$/, 'MPIN must be exactly 4 digits');
const otpSchema = z.string().length(6, 'OTP must be exactly 6 digits');
const deviceIdSchema = z.string().min(8).max(64);
const phoneDigitsSchema = z.string().regex(/^\d{7,15}$/, 'Phone digits are invalid');

const phoneIdentityFields = {
  phoneNumber: z.string().min(8).optional(),
  countryCallingCode: z.string().min(1).max(8).optional(),
  phoneDigits: phoneDigitsSchema.optional(),
  countryCode: z.string().min(2).max(8).optional(),
};

function requirePhoneIdentity(
  value: {
    phoneNumber?: string | undefined;
    countryCallingCode?: string | undefined;
    phoneDigits?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasE164 = Boolean(value.phoneNumber);
  const hasParts = Boolean(value.countryCallingCode && value.phoneDigits);

  if (!hasE164 && !hasParts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide phoneNumber or countryCallingCode + phoneDigits',
    });
  }
}

export const signupOtpSendBodySchema = z.object({
  body: z.object(phoneIdentityFields).superRefine(requirePhoneIdentity),
});

export const signupOtpVerifyBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      otp: otpSchema,
    })
    .superRefine(requirePhoneIdentity),
});

export const signupSubmitBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      countryCode: z.string().min(2).max(8),
      countryCallingCode: z.string().min(1).max(8),
      phoneDigits: phoneDigitsSchema,
      fullName: z.string().trim().min(2).max(150),
      accountType: z.enum(['individual', 'company']).default('individual'),
      companyName: z.string().trim().min(1).max(150).optional(),
      email: z.union([z.string().trim().email(), z.literal('')]).optional(),
      address: z.union([z.string().trim().max(500), z.literal('')]).optional(),
      locationCoordinates: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .nullable()
        .optional(),
      avatarUrl: z.string().trim().min(1).nullable().optional(),
      mpin: mpinSchema,
      biometricEnabled: z.boolean().default(false),
      deviceId: deviceIdSchema.default('unknown-device'),
    })
    .superRefine(requirePhoneIdentity)
    .superRefine((value, ctx) => {
      if (value.accountType === 'company' && !value.companyName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['companyName'],
          message: 'companyName is required when accountType is company',
        });
      }
    }),
});

export const signupEmailCheckBodySchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
  }),
});

const loginOtpPurposeSchema = z.enum(['login', 'mpin_reset']).default('login');

export const loginOtpSendBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      purpose: loginOtpPurposeSchema,
    })
    .superRefine(requirePhoneIdentity),
});

export const loginOtpVerifyBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      otp: otpSchema,
      purpose: loginOtpPurposeSchema,
    })
    .superRefine(requirePhoneIdentity),
});

export const loginMpinBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      mpin: mpinSchema,
      deviceId: deviceIdSchema,
    })
    .superRefine(requirePhoneIdentity),
});

export const resetMpinBodySchema = z.object({
  body: z
    .object({
      ...phoneIdentityFields,
      newMpin: mpinSchema,
      deviceId: deviceIdSchema,
    })
    .superRefine(requirePhoneIdentity),
});

export const changeMpinBodySchema = z.object({
  body: z.object({
    currentMpin: mpinSchema,
    newMpin: mpinSchema,
  }),
});

export const updateProfileBodySchema = z.object({
  body: z
    .object({
      fullName: z.string().trim().min(2).max(150).optional(),
      accountType: z.enum(['individual', 'company']).optional(),
      companyName: z.union([z.string().trim().min(1).max(150), z.literal(''), z.null()]).optional(),
      email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
      address: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional(),
      locationCoordinates: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .nullable()
        .optional(),
      avatarUrl: z.string().trim().min(1).nullable().optional(),
      biometricEnabled: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one profile field is required',
    }),
});

export const logoutBodySchema = z.object({
  body: z
    .object({
      deviceId: deviceIdSchema.optional(),
    })
    .default({}),
});

export const refreshBodySchema = z.object({
  body: z.object({
    refreshToken: z.string().trim().min(1).max(200),
  }),
});

export type SignupOtpSendBody = z.infer<typeof signupOtpSendBodySchema>['body'];
export type SignupOtpVerifyBody = z.infer<typeof signupOtpVerifyBodySchema>['body'];
export type SignupSubmitBody = z.infer<typeof signupSubmitBodySchema>['body'];
export type SignupEmailCheckBody = z.infer<typeof signupEmailCheckBodySchema>['body'];
export type LoginOtpSendBody = z.infer<typeof loginOtpSendBodySchema>['body'];
export type LoginOtpVerifyBody = z.infer<typeof loginOtpVerifyBodySchema>['body'];
export type LoginMpinBody = z.infer<typeof loginMpinBodySchema>['body'];
export type ResetMpinBody = z.infer<typeof resetMpinBodySchema>['body'];
export type ChangeMpinBody = z.infer<typeof changeMpinBodySchema>['body'];
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>['body'];
export type RefreshBody = z.infer<typeof refreshBodySchema>['body'];
