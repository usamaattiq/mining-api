import { Router } from 'express';
import { AccountType, ListingCategory, ListingStatus, UserStatus } from '@prisma/client';
import { prisma } from '../../common/database/prisma';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { sendSuccess } from '../../common/http/api-response';
import type { AuthenticatedRequest } from '../../common/http/authenticated-request';
import { wrap } from '../../common/http/wrap';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { toListingDto } from '../listings/utils/listing.mapper';
import { requireAdmin } from './require-admin';

export const adminRouter = Router();

adminRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));
adminRouter.use(wrap((req, res, next) => requireAdmin(req, res, next)));

const PAGE_SIZE = 30;

function routeId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  return id ?? '';
}

function pageOf(value: unknown): number {
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

adminRouter.get(
  '/users',
  wrap(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const accountType =
      req.query.accountType === 'individual' || req.query.accountType === 'company'
        ? req.query.accountType === 'company'
          ? AccountType.COMPANY
          : AccountType.INDIVIDUAL
        : undefined;
    const status =
      req.query.status === 'suspended'
        ? UserStatus.SUSPENDED
        : req.query.status === 'active'
          ? UserStatus.ACTIVE
          : undefined;
    const page = pageOf(req.query.page);
    const where = {
      deletedAt: null,
      ...(accountType ? { accountType } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { phoneE164: { contains: search } },
              { companyName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          fullName: true,
          phoneE164: true,
          avatarUrl: true,
          accountType: true,
          companyName: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);
    sendSuccess(res, 200, {
      total,
      page,
      items: rows.map((row) => ({
        ...row,
        accountType:
          row.accountType === AccountType.COMPANY
            ? 'company'
            : row.accountType === AccountType.ADMIN
              ? 'admin'
              : 'individual',
        status: row.status === UserStatus.SUSPENDED ? 'suspended' : 'active',
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }),
);

adminRouter.get(
  '/users/:id',
  wrap(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: routeId(req.params.id),
        deletedAt: null,
      },
    });
    if (!user) throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    const listings = await prisma.listing.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, reference: true, category: true, status: true },
    });
    sendSuccess(res, 200, {
      id: user.id,
      fullName: user.fullName,
      phoneE164: user.phoneE164,
      email: user.email,
      address: user.address,
      latitude: user.latitude,
      longitude: user.longitude,
      avatarUrl: user.avatarUrl,
      accountType:
        user.accountType === AccountType.COMPANY
          ? 'company'
          : user.accountType === AccountType.ADMIN
            ? 'admin'
            : 'individual',
      companyName: user.companyName,
      status: user.status === UserStatus.SUSPENDED ? 'suspended' : 'active',
      listings: listings.map((listing) => ({
        ...listing,
        status: listing.status === ListingStatus.ARCHIVED ? 'archived' : 'active',
      })),
    });
  }),
);

adminRouter.patch(
  '/users/:id',
  wrap(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: routeId(req.params.id),
        deletedAt: null,
        accountType: { not: AccountType.ADMIN },
      },
    });
    if (!user) throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    if (!fullName) throw new AppError('Name is required', 400, ErrorCode.VALIDATION_ERROR);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName,
        email: email || null,
        address: typeof req.body?.address === 'string' ? req.body.address.trim() || null : null,
        companyName:
          user.accountType === AccountType.COMPANY && typeof req.body?.companyName === 'string'
            ? req.body.companyName.trim() || null
            : user.companyName,
        latitude: typeof req.body?.latitude === 'number' ? req.body.latitude : user.latitude,
        longitude: typeof req.body?.longitude === 'number' ? req.body.longitude : user.longitude,
      },
    });
    sendSuccess(res, 200, { id: updated.id });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  wrap(async (req, res) => {
    const status = req.body?.status === 'suspended' ? UserStatus.SUSPENDED : UserStatus.ACTIVE;
    if (req.body?.status !== 'suspended' && req.body?.status !== 'active') {
      throw new AppError('status must be active or suspended', 400, ErrorCode.VALIDATION_ERROR);
    }
    const actorId = (req as AuthenticatedRequest).user?.id;
    if (routeId(req.params.id) === actorId) {
      throw new AppError('You cannot change your own status', 400, ErrorCode.VALIDATION_ERROR);
    }
    const user = await prisma.user.findFirst({
      where: {
        id: routeId(req.params.id),
        deletedAt: null,
        accountType: { not: AccountType.ADMIN },
      },
    });
    if (!user) {
      throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    }
    await prisma.user.update({ where: { id: user.id }, data: { status } });
    sendSuccess(res, 200, {
      id: user.id,
      status: status === UserStatus.SUSPENDED ? 'suspended' : 'active',
    });
  }),
);

adminRouter.get(
  '/listings',
  wrap(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category =
      req.query.category === 'equipment' ||
      req.query.category === 'services' ||
      req.query.category === 'gold'
        ? (req.query.category as ListingCategory)
        : undefined;
    const now = new Date();
    const statusWhere =
      req.query.status === 'live'
        ? { status: ListingStatus.ACTIVE, expiresAt: { gt: now } }
        : req.query.status === 'past'
          ? { OR: [{ status: ListingStatus.ARCHIVED }, { expiresAt: { lte: now } }] }
          : req.query.status === 'archived'
            ? { status: ListingStatus.ARCHIVED }
            : req.query.status === 'active'
              ? { status: ListingStatus.ACTIVE }
              : {};
    const where = {
      ...(category ? { category } : {}),
      AND: [
        statusWhere,
        ...(search
          ? [
              {
                OR: [
                  { title: { contains: search, mode: 'insensitive' as const } },
                  { reference: { contains: search, mode: 'insensitive' as const } },
                  { location: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });
    sendSuccess(res, 200, { items: rows.map(toListingDto) });
  }),
);

adminRouter.patch(
  '/listings/:id/status',
  wrap(async (req, res) => {
    if (req.body?.status !== 'archived' && req.body?.status !== 'active') {
      throw new AppError('status must be active or archived', 400, ErrorCode.VALIDATION_ERROR);
    }
    const status = req.body.status === 'archived' ? ListingStatus.ARCHIVED : ListingStatus.ACTIVE;
    const listing = await prisma.listing.findUnique({ where: { id: routeId(req.params.id) } });
    if (!listing) {
      throw new AppError('Listing not found', 404, ErrorCode.NOT_FOUND);
    }
    await prisma.listing.update({ where: { id: listing.id }, data: { status } });
    sendSuccess(res, 200, {
      id: listing.id,
      status: status === ListingStatus.ARCHIVED ? 'archived' : 'active',
    });
  }),
);

function labelField(
  category: ListingCategory,
): 'equipmentTypeLabel' | 'serviceCategoryLabel' | 'purityLabel' {
  if (category === ListingCategory.equipment) return 'equipmentTypeLabel';
  if (category === ListingCategory.services) return 'serviceCategoryLabel';
  return 'purityLabel';
}

adminRouter.get(
  '/categories',
  wrap(async (_req, res) => {
    const categories: ListingCategory[] = [
      ListingCategory.equipment,
      ListingCategory.services,
      ListingCategory.gold,
    ];
    const items = await Promise.all(
      categories.map(async (category) => {
        const field = labelField(category);
        const listings = await prisma.listing.findMany({
          where: { category },
          select: { equipmentTypeLabel: true, serviceCategoryLabel: true, purityLabel: true },
        });
        const names = new Set<string>();
        const counts = new Map<string, number>();
        for (const listing of listings) {
          const name = listing[field]?.trim();
          if (!name) continue;
          names.add(name);
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const labels = await prisma.catalogLabel.findMany({
          where: { category },
          orderBy: { name: 'asc' },
        });
        return {
          key: category,
          count: listings.length,
          labels: labels.map((label) => ({
            id: label.id,
            name: label.name,
            parentId: label.parentId,
            count: counts.get(label.name) ?? 0,
          })),
        };
      }),
    );
    sendSuccess(res, 200, { items });
  }),
);

adminRouter.post(
  '/categories',
  wrap(async (req, res) => {
    const category = req.body?.category as ListingCategory;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    if (!['equipment', 'services', 'gold'].includes(category) || !name) {
      throw new AppError('Category and name are required', 400, ErrorCode.VALIDATION_ERROR);
    }
    if (parentId) {
      const parent = await prisma.catalogLabel.findUnique({ where: { id: parentId } });
      if (!parent || parent.category !== category) {
        throw new AppError('Parent category not found', 404, ErrorCode.NOT_FOUND);
      }
    }
    const created = await prisma.catalogLabel.upsert({
      where: { category_name: { category, name } },
      update: {},
      create: { category, name, parentId },
    });
    sendSuccess(res, 201, { id: created.id, name: created.name });
  }),
);

adminRouter.patch(
  '/categories/:id',
  wrap(async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new AppError('Name is required', 400, ErrorCode.VALIDATION_ERROR);
    const label = await prisma.catalogLabel.findUnique({ where: { id: routeId(req.params.id) } });
    if (!label) throw new AppError('Category not found', 404, ErrorCode.NOT_FOUND);
    const updated = await prisma.catalogLabel.update({
      where: { id: label.id },
      data: { name },
    });
    sendSuccess(res, 200, { id: updated.id, name: updated.name });
  }),
);

adminRouter.delete(
  '/categories/:id',
  wrap(async (req, res) => {
    const label = await prisma.catalogLabel.findUnique({ where: { id: routeId(req.params.id) } });
    if (!label) throw new AppError('Category not found', 404, ErrorCode.NOT_FOUND);
    const childCount = await prisma.catalogLabel.count({ where: { parentId: label.id } });
    if (childCount > 0) {
      throw new AppError('Delete subcategories first', 409, ErrorCode.CONFLICT);
    }
    await prisma.catalogLabel.delete({ where: { id: label.id } });
    sendSuccess(res, 200, { id: label.id });
  }),
);
