import { Router } from 'express';
import {
  AccountType,
  ListingCategory,
  ListingStatus,
  MarketplaceRole,
  UserStatus,
} from '@prisma/client';
import { prisma } from '../../common/database/prisma';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { sendSuccess } from '../../common/http/api-response';
import type { AuthenticatedRequest } from '../../common/http/authenticated-request';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { userSessionRepository } from '../auth/repositories/user-session.repository';
import { toListingDto } from '../listings/utils/listing.mapper';
import { attachRfqStatuses } from '../listings/utils/listing-rfq';
import { requireAdmin } from './require-admin';
import {
  buyerEquipmentRequestModes,
  messageOnSendEnabled,
  setBuyerEquipmentRequestMode,
  setMessageOnSend,
} from './app-settings';
import {
  createCategoryBodySchema,
  listingStatusBodySchema,
  updateCategoryBodySchema,
  unitBodySchema,
  updateUserBodySchema,
  userStatusBodySchema,
  type CreateCategoryBody,
  type ListingStatusBody,
  type UpdateCategoryBody,
  type UnitBody,
  type UpdateUserBody,
  type UserStatusBody,
} from './validation/admin.schema';

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
  '/settings',
  wrap(async (_req, res) => {
    const modes = await buyerEquipmentRequestModes();
    sendSuccess(res, 200, {
      messageOnSend: await messageOnSendEnabled(),
      buyerEquipmentRfq: modes.rfq,
      buyerEquipmentAuction: modes.auction,
    });
  }),
);

adminRouter.patch(
  '/settings',
  wrap(async (req, res) => {
    const body = req.body as {
      messageOnSend?: unknown;
      buyerEquipmentRfq?: unknown;
      buyerEquipmentAuction?: unknown;
    };
    if (typeof body.messageOnSend === 'boolean') {
      await setMessageOnSend(body.messageOnSend);
    }
    if (typeof body.buyerEquipmentRfq === 'boolean') {
      await setBuyerEquipmentRequestMode('rfq', body.buyerEquipmentRfq);
    }
    if (typeof body.buyerEquipmentAuction === 'boolean') {
      await setBuyerEquipmentRequestMode('auction', body.buyerEquipmentAuction);
    }
    if (
      typeof body.messageOnSend !== 'boolean' &&
      typeof body.buyerEquipmentRfq !== 'boolean' &&
      typeof body.buyerEquipmentAuction !== 'boolean'
    ) {
      throw new AppError('A setting value is required', 400, ErrorCode.VALIDATION_ERROR);
    }
    const modes = await buyerEquipmentRequestModes();
    sendSuccess(res, 200, {
      messageOnSend: await messageOnSendEnabled(),
      buyerEquipmentRfq: modes.rfq,
      buyerEquipmentAuction: modes.auction,
    });
  }),
);

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
      accountType: accountType ?? { not: AccountType.ADMIN },
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
        accountType: { not: AccountType.ADMIN },
      },
    });
    if (!user) throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    const listings = await prisma.listing.findMany({
      where: { ownerId: user.id, status: ListingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });
    const listingDtos = await attachRfqStatuses(listings.map(toListingDto), listings, user.id);
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
      listings: listingDtos,
    });
  }),
);

adminRouter.patch(
  '/users/:id',
  validate(updateUserBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as UpdateUserBody;
    const user = await prisma.user.findFirst({
      where: {
        id: routeId(req.params.id),
        deletedAt: null,
        accountType: { not: AccountType.ADMIN },
      },
    });
    if (!user) throw new AppError('User not found', 404, ErrorCode.USER_NOT_FOUND);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: body.fullName,
        email: body.email || null,
        address: body.address || null,
        companyName:
          user.accountType === AccountType.COMPANY ? body.companyName || null : user.companyName,
        latitude: body.latitude ?? user.latitude,
        longitude: body.longitude ?? user.longitude,
      },
    });
    sendSuccess(res, 200, { id: updated.id });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  validate(userStatusBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as UserStatusBody;
    const status = body.status === 'suspended' ? UserStatus.SUSPENDED : UserStatus.ACTIVE;
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
    if (status === UserStatus.SUSPENDED) {
      await userSessionRepository.revokeAllForUser(user.id);
    }
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
    const postedAs =
      req.query.postedAs === 'buyer' || req.query.postedAs === 'supplier'
        ? (req.query.postedAs as MarketplaceRole)
        : undefined;
    const where = {
      status: ListingStatus.ACTIVE,
      ...(category ? { category } : {}),
      ...(postedAs ? { postedAs } : {}),
      AND: [
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
    const pageSize = 7;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const skip = (page - 1) * pageSize;
    const [total, rows] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          media: { orderBy: { sortOrder: 'asc' } },
          owner: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      }),
    ]);
    const dtos = rows.map(toListingDto);
    const byOwner = new Map<string, { dtos: typeof dtos; rows: typeof rows }>();
    rows.forEach((row, index) => {
      const bucket = byOwner.get(row.ownerId) ?? { dtos: [], rows: [] };
      bucket.dtos.push(dtos[index]!);
      bucket.rows.push(row);
      byOwner.set(row.ownerId, bucket);
    });
    const withStatus = new Map<string, (typeof dtos)[number]>();
    await Promise.all(
      [...byOwner.entries()].map(async ([ownerId, bucket]) => {
        const attached = await attachRfqStatuses(bucket.dtos, bucket.rows, ownerId);
        for (const item of attached) withStatus.set(item.id, item);
      }),
    );
    sendSuccess(res, 200, {
      items: dtos.map((item) => withStatus.get(item.id) ?? item),
      page,
      pageSize,
      total,
      hasMore: skip + rows.length < total,
    });
  }),
);

adminRouter.patch(
  '/listings/:id/status',
  validate(listingStatusBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as ListingStatusBody;
    const status = body.status === 'archived' ? ListingStatus.ARCHIVED : ListingStatus.ACTIVE;
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
            nameAr: label.nameAr,
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
  validate(createCategoryBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as CreateCategoryBody;
    const category = body.category as ListingCategory;
    const name = body.name;
    const nameAr = body.nameAr;
    const parentId = body.parentId ?? null;
    if (parentId) {
      const parent = await prisma.catalogLabel.findUnique({ where: { id: parentId } });
      if (!parent || parent.category !== category) {
        throw new AppError('Parent category not found', 404, ErrorCode.NOT_FOUND);
      }
    }
    const created = await prisma.catalogLabel.upsert({
      where: { category_name: { category, name } },
      update: { nameAr },
      create: { category, name, nameAr, parentId },
    });
    sendSuccess(res, 201, { id: created.id, name: created.name, nameAr: created.nameAr });
  }),
);

adminRouter.patch(
  '/categories/:id',
  validate(updateCategoryBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as UpdateCategoryBody;
    const name = body.name;
    const nameAr = body.nameAr;
    const label = await prisma.catalogLabel.findUnique({ where: { id: routeId(req.params.id) } });
    if (!label) throw new AppError('Category not found', 404, ErrorCode.NOT_FOUND);
    const updated = await prisma.catalogLabel.update({
      where: { id: label.id },
      data: { name, nameAr },
    });
    sendSuccess(res, 200, { id: updated.id, name: updated.name, nameAr: updated.nameAr });
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

adminRouter.get(
  '/units',
  wrap(async (_req, res) => {
    const rows = await prisma.unitLabel.findMany({ orderBy: { name: 'asc' } });
    sendSuccess(res, 200, {
      items: rows.map((row) => ({ id: row.id, name: row.name, nameAr: row.nameAr })),
    });
  }),
);

adminRouter.post(
  '/units',
  validate(unitBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as UnitBody;
    const created = await prisma.unitLabel.create({
      data: { name: body.name, nameAr: body.nameAr },
    });
    sendSuccess(res, 201, { id: created.id, name: created.name, nameAr: created.nameAr });
  }),
);

adminRouter.patch(
  '/units/:id',
  validate(unitBodySchema),
  wrap(async (req, res) => {
    const body = req.validatedBody as UnitBody;
    const existing = await prisma.unitLabel.findUnique({ where: { id: routeId(req.params.id) } });
    if (!existing) throw new AppError('Unit not found', 404, ErrorCode.NOT_FOUND);
    const updated = await prisma.unitLabel.update({
      where: { id: existing.id },
      data: { name: body.name, nameAr: body.nameAr },
    });
    sendSuccess(res, 200, { id: updated.id, name: updated.name, nameAr: updated.nameAr });
  }),
);

adminRouter.delete(
  '/units/:id',
  wrap(async (req, res) => {
    const existing = await prisma.unitLabel.findUnique({ where: { id: routeId(req.params.id) } });
    if (!existing) throw new AppError('Unit not found', 404, ErrorCode.NOT_FOUND);
    await prisma.unitLabel.delete({ where: { id: existing.id } });
    sendSuccess(res, 200, { id: existing.id });
  }),
);
