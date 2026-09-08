import type { OtpPurpose } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

class OtpChallengeRepository {
  countCreatedSince(phoneE164: string, purpose: OtpPurpose, since: Date): Promise<number> {
    return prisma.otpChallenge.count({
      where: { phoneE164, purpose, createdAt: { gte: since } },
    });
  }

  create(data: { phoneE164: string; purpose: OtpPurpose; codeHash: string; expiresAt: Date }) {
    return prisma.otpChallenge.create({ data });
  }

  findLatest(phoneE164: string, purpose: OtpPurpose) {
    return prisma.otpChallenge.findFirst({
      where: { phoneE164, purpose },
      orderBy: { createdAt: 'desc' },
    });
  }

  incrementAttempts(id: string) {
    return prisma.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  markVerified(id: string) {
    return prisma.otpChallenge.update({ where: { id }, data: { verifiedAt: new Date() } });
  }
}

export const otpChallengeRepository = new OtpChallengeRepository();
