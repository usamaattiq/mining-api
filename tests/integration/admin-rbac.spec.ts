import { randomUUID } from 'node:crypto';
import { AccountType } from '@prisma/client';
import { prisma } from '../../src/common/database/prisma';
import { requireAdmin } from '../../src/modules/admin/require-admin';
import type { AuthenticatedRequest } from '../../src/common/http/authenticated-request';
import { ErrorCode } from '../../src/common/errors/error-codes';

function fakeRequest(userId: string): AuthenticatedRequest {
  return { user: { id: userId } } as AuthenticatedRequest;
}

describe('admin RBAC', () => {
  let regularUserId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const [regular, admin] = await Promise.all([
      prisma.user.create({
        data: {
          fullName: 'Regular',
          phoneE164: `+1200${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
      prisma.user.create({
        data: {
          fullName: 'Admin',
          phoneE164: `+1201${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
          accountType: AccountType.ADMIN,
        },
      }),
    ]);
    regularUserId = regular.id;
    adminUserId = admin.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [regularUserId, adminUserId] } } });
    await prisma.$disconnect();
  });

  it('rejects a non-admin user with 403', async () => {
    const next = jest.fn();
    await expect(requireAdmin(fakeRequest(regularUserId), {} as never, next)).rejects.toMatchObject(
      { status: 403, code: ErrorCode.FORBIDDEN },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const next = jest.fn();
    await expect(
      requireAdmin({ user: undefined } as AuthenticatedRequest, {} as never, next),
    ).rejects.toMatchObject({ status: 401, code: ErrorCode.UNAUTHORIZED });
    expect(next).not.toHaveBeenCalled();
  });

  it('lets an admin user through', async () => {
    const next = jest.fn();
    await requireAdmin(fakeRequest(adminUserId), {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
