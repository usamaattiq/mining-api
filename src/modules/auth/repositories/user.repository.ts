import type { AccountType, Prisma, User } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';

type Tx = Prisma.TransactionClient;

class UserRepository {
  findByPhoneE164(phoneE164: string, tx: Tx | typeof prisma = prisma): Promise<User | null> {
    return tx.user.findFirst({ where: { phoneE164, deletedAt: null } });
  }

  findByEmail(email: string, tx: Tx | typeof prisma = prisma): Promise<User | null> {
    return tx.user.findFirst({ where: { email, deletedAt: null } });
  }

  findById(id: string, tx: Tx | typeof prisma = prisma): Promise<User | null> {
    return tx.user.findFirst({ where: { id, deletedAt: null } });
  }

  findByRmsId(rmsId: string, tx: Tx | typeof prisma = prisma): Promise<User | null> {
    return tx.user.findFirst({ where: { rmsId, deletedAt: null } });
  }

  create(
    data: {
      fullName: string;
      phoneE164: string;
      countryCode: string;
      countryCallingCode: string;
      email: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      avatarUrl: string | null;
      accountType: AccountType;
      companyName: string | null;
      biometricEnabled: boolean;
      isVerified: boolean;
    },
    tx: Tx | typeof prisma = prisma,
  ): Promise<User> {
    return tx.user.create({ data });
  }

  updateProfile(
    id: string,
    data: Partial<{
      fullName: string;
      accountType: AccountType;
      companyName: string | null;
      email: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      avatarUrl: string | null;
      biometricEnabled: boolean;
      isVerified: boolean;
    }>,
    tx: Tx | typeof prisma = prisma,
  ): Promise<User> {
    return tx.user.update({ where: { id }, data });
  }

  touchLastLogin(id: string, tx: Tx | typeof prisma = prisma): Promise<User> {
    return tx.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }
}

export const userRepository = new UserRepository();
