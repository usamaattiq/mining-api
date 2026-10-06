// Interactive account provisioning. Creates a User + UserCredential (MPIN)
// + a pre-verified OtpChallenge(LOGIN) directly in the DB, bypassing the
// real signup/OTP-delivery flow entirely. Deliberately NOT wired into
// `npx prisma db seed` / deploy.yml — every account (admin, test, App
// Store/Play review, whatever) is created here, one at a time, by hand.
//
// Usage: npm run account:create
//
// Run via plain ts-node (not `prisma db seed`, which auto-loads .env) —
// load it ourselves so DATABASE_URL etc. are set before Prisma needs them.
import 'dotenv/config';
import * as readline from 'node:readline';
import { AccountType, OtpPurpose } from '@prisma/client';
import { prisma } from '../src/common/database/prisma';
import { hashSecret } from '../src/common/security/password.service';
import { otpChallengeRepository } from '../src/modules/auth/repositories/otp-challenge.repository';

const CALLING_CODE_TO_ISO: Record<string, string> = {
  '92': 'PK',
  '1': 'US',
  '44': 'GB',
  '971': 'AE',
};

// A pre-verified OtpChallenge stays valid for 30 minutes (VERIFIED_OTP_MAX_AGE_MS
// in otp.service.ts) — long enough to hand off credentials and have the first
// login (always from an "unknown device") succeed without a real OTP
// round-trip. After that window, login falls back to the normal send/verify flow.
const OTP_CHALLENGE_LIFETIME_MS = 30 * 60 * 1000;

// One shared interface for the whole flow, and the classic
// callback-based question() (not node:readline/promises — its question()
// only ever resolves the first call reliably; a second question on the
// same interface hangs).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function askMatching(label: string, pattern: RegExp, hint: string): Promise<string> {
  const value = await ask(`${label}: `);
  if (!pattern.test(value)) {
    throw new Error(`${label} ${hint}`);
  }
  const confirmation = await ask(`Confirm ${label.toLowerCase()}: `);
  if (confirmation !== value) {
    throw new Error(`${label} and confirmation don't match`);
  }
  return value;
}

async function main(): Promise<void> {
  const typeInput = await ask('Press 0 for Admin, 1 for User: ');
  if (typeInput !== '0' && typeInput !== '1') {
    throw new Error('Enter 0 (Admin) or 1 (User)');
  }
  const accountType = typeInput === '0' ? AccountType.ADMIN : AccountType.INDIVIDUAL;

  const fullName = await ask('Full name: ');
  if (!fullName) throw new Error('Full name is required');

  const callingCode = (await ask('Country calling code (e.g. 92): ')).replace(/\D/g, '');
  if (!callingCode) throw new Error('Country calling code is required');

  const localNumber = (await ask('Phone number (without calling code): ')).replace(/\D/g, '');
  if (!localNumber) throw new Error('Phone number is required');

  const phoneE164 = `+${callingCode}${localNumber}`;
  const countryCode = CALLING_CODE_TO_ISO[callingCode] ?? callingCode;

  const existing = await prisma.user.findFirst({ where: { phoneE164 } });
  if (existing) {
    throw new Error(`A user with ${phoneE164} already exists (id: ${existing.id})`);
  }

  const mpin = await askMatching('MPIN', /^\d{4}$/, 'must be exactly 4 digits');
  const otp = await askMatching('OTP', /^\d{6}$/, 'must be exactly 6 digits');

  const mpinHash = await hashSecret(mpin);

  const user = await prisma.user.create({
    data: {
      fullName,
      phoneE164,
      countryCode,
      countryCallingCode: callingCode,
      accountType,
      biometricEnabled: false,
      isVerified: true,
      credential: { create: { mpinHash } },
    },
  });

  const otpHash = await hashSecret(otp);
  const challenge = await otpChallengeRepository.create({
    phoneE164,
    purpose: OtpPurpose.LOGIN,
    codeHash: otpHash,
    expiresAt: new Date(Date.now() + OTP_CHALLENGE_LIFETIME_MS),
  });
  await otpChallengeRepository.markVerified(challenge.id);

  console.info(
    `[account:create] Created ${accountType} ${user.id} (${phoneE164}) — ` +
      'login works for the next 30 minutes without a real OTP.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('[account:create] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
