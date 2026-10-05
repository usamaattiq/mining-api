import { AccountType, ListingCategory } from '@prisma/client';
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

const CATALOG: { category: ListingCategory; name: string; parentName?: string }[] = [
  { category: ListingCategory.equipment, name: 'Excavator' },
  { category: ListingCategory.equipment, name: 'Loader' },
  { category: ListingCategory.equipment, name: 'Bulldozer', parentName: 'Excavator' },
  { category: ListingCategory.services, name: 'Drilling' },
  { category: ListingCategory.gold, name: '17K' },
  { category: ListingCategory.gold, name: '22K' },
  { category: ListingCategory.gold, name: '24K' },
];

async function seedCatalog(): Promise<void> {
  for (const item of CATALOG) {
    const parent = item.parentName
      ? await prisma.catalogLabel.findUnique({
          where: { category_name: { category: item.category, name: item.parentName } },
        })
      : null;
    await prisma.catalogLabel.upsert({
      where: { category_name: { category: item.category, name: item.name } },
      update: {},
      create: { category: item.category, name: item.name, parentId: parent?.id ?? null },
    });
  }
  console.info('[seed] Catalog labels ready');
}

seedReviewAccount()
  .then(() => seedCatalog())
  .catch((error: unknown) => {
    console.error('[seed] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
