import { AccountType } from '@prisma/client';
import { prisma } from '../src/common/database/prisma';
import { hashSecret } from '../src/common/security/password.service';

const REVIEW_PHONE = '+923001122334';
const ADMIN_PHONE = '+923211122334';
const REVIEW_MPIN = '0000';

async function upsertAccount(input: {
  phoneE164: string;
  fullName: string;
  accountType: AccountType;
}): Promise<void> {
  const mpinHash = await hashSecret(REVIEW_MPIN);

  const existing = await prisma.user.findFirst({
    where: { phoneE164: input.phoneE164 },
    include: { credential: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        deletedAt: null,
        status: 'ACTIVE',
        accountType: input.accountType,
        fullName: input.fullName,
      },
    });

    if (existing.credential) {
      await prisma.userCredential.update({
        where: { userId: existing.id },
        data: { mpinHash, failedAttempts: 0, lockedUntil: null },
      });
    } else {
      await prisma.userCredential.create({ data: { userId: existing.id, mpinHash } });
    }

    console.info(`[seed] Updated account ${input.phoneE164}`);
    return;
  }

  await prisma.user.create({
    data: {
      fullName: input.fullName,
      phoneE164: input.phoneE164,
      countryCode: 'PK',
      countryCallingCode: '92',
      accountType: input.accountType,
      biometricEnabled: false,
      isVerified: true,
      credential: { create: { mpinHash } },
    },
  });

  console.info(`[seed] Created account ${input.phoneE164}`);
}

async function seedReviewAccount(): Promise<void> {
  await upsertAccount({
    phoneE164: REVIEW_PHONE,
    fullName: 'App Review',
    accountType: AccountType.INDIVIDUAL,
  });
  await upsertAccount({
    phoneE164: ADMIN_PHONE,
    fullName: 'Admin',
    accountType: AccountType.ADMIN,
  });
}

seedReviewAccount()
  .catch((error: unknown) => {
    console.error('[seed] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
