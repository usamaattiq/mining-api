import { AccountType } from '@prisma/client';
import { prisma } from '../src/common/database/prisma';
import { hashSecret } from '../src/common/security/password.service';

const REVIEW_PHONE = '+923001122334';
const REVIEW_MPIN = '0000';

async function seedReviewAccount(): Promise<void> {
  const mpinHash = await hashSecret(REVIEW_MPIN);

  const existing = await prisma.user.findFirst({
    where: { phoneE164: REVIEW_PHONE },
    include: { credential: true },
  });

  if (existing) {
    if (existing.deletedAt || existing.status !== 'ACTIVE') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { deletedAt: null, status: 'ACTIVE' },
      });
    }

    if (existing.credential) {
      await prisma.userCredential.update({
        where: { userId: existing.id },
        data: { mpinHash, failedAttempts: 0, lockedUntil: null },
      });
    } else {
      await prisma.userCredential.create({ data: { userId: existing.id, mpinHash } });
    }

    console.info(`[seed] Updated review account ${REVIEW_PHONE}`);
    return;
  }

  await prisma.user.create({
    data: {
      fullName: 'App Review',
      phoneE164: REVIEW_PHONE,
      countryCode: 'PK',
      countryCallingCode: '92',
      accountType: AccountType.INDIVIDUAL,
      biometricEnabled: false,
      isVerified: true,
      credential: { create: { mpinHash } },
    },
  });

  console.info(`[seed] Created review account ${REVIEW_PHONE}`);
}

seedReviewAccount()
  .catch((error: unknown) => {
    console.error('[seed] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
