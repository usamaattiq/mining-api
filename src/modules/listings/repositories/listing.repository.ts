import type { ListingCategory, MarketplaceRole, Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import type { ListingWithMedia } from '../types/listing.types';

type Tx = Prisma.TransactionClient;

const listingInclude = {
  media: { orderBy: { sortOrder: 'asc' as const } },
  owner: { select: { id: true, fullName: true, avatarUrl: true } },
};

class ListingRepository {
  create(
    data: Prisma.ListingCreateInput,
    tx: Tx | typeof prisma = prisma,
  ): Promise<ListingWithMedia> {
    return tx.listing.create({ data, include: listingInclude });
  }

  findById(id: string, tx: Tx | typeof prisma = prisma): Promise<ListingWithMedia | null> {
    return tx.listing.findUnique({ where: { id }, include: listingInclude });
  }

  findMine(input: {
    ownerId: string;
    postedAs?: MarketplaceRole;
    category?: ListingCategory;
  }): Promise<ListingWithMedia[]> {
    return prisma.listing.findMany({
      where: {
        ownerId: input.ownerId,
        status: 'ACTIVE',
        ...(input.postedAs ? { postedAs: input.postedAs } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 6 },
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findFeed(input: {
    postedAs: MarketplaceRole;
    excludeOwnerId?: string;
    category?: ListingCategory;
  }): Promise<ListingWithMedia[]> {
    return prisma.listing.findMany({
      where: {
        postedAs: input.postedAs,
        status: 'ACTIVE',
        ...(input.excludeOwnerId ? { ownerId: { not: input.excludeOwnerId } } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 6 },
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const listingRepository = new ListingRepository();
