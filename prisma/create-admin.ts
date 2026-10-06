// Manual, out-of-band admin provisioning. Deliberately NOT wired into
// `npx prisma db seed` / deploy.yml — admin accounts must never be created
// by a script that re-runs on every deploy with a fixed phone/MPIN.
//
// Usage: npm run admin:create -- +15551234567 "Jane Doe"
// (prompts for a 4-digit MPIN; nothing sensitive is passed as an argv/env value)
import { createInterface } from 'node:readline/promises';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/common/database/prisma';
import { hashSecret } from '../src/common/security/password.service';

async function promptMpin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const mpin = await rl.question('Set a 4-digit MPIN for this admin: ');
    if (!/^\d{4}$/.test(mpin)) {
      throw new Error('MPIN must be exactly 4 digits');
    }
    return mpin;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [phoneE164, fullName] = process.argv.slice(2);
  if (!phoneE164 || !fullName) {
    throw new Error('Usage: npm run admin:create -- <phoneE164> "<Full Name>"');
  }
  if (!/^\+\d{8,15}$/.test(phoneE164)) {
    throw new Error(`"${phoneE164}" doesn't look like an E.164 phone number`);
  }

  const existing = await prisma.user.findFirst({ where: { phoneE164 } });
  if (existing) {
    throw new Error(`A user with ${phoneE164} already exists (id: ${existing.id})`);
  }

  const mpin = await promptMpin();
  const mpinHash = await hashSecret(mpin);

  const admin = await prisma.user.create({
    data: {
      fullName,
      phoneE164,
      countryCode: 'PK',
      countryCallingCode: '92',
      accountType: AccountType.ADMIN,
      biometricEnabled: false,
      isVerified: true,
      credential: { create: { mpinHash } },
    },
  });

  console.info(`[admin:create] Created admin ${admin.id} (${phoneE164})`);
}

main()
  .catch((error: unknown) => {
    console.error('[admin:create] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
