import type { ListingCategory, MarketplaceRole, Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import type { ListingWithMedia } from '../types/listing.types';

type Tx = Prisma.TransactionClient;

const mediaInclude = { media: { orderBy: { sortOrder: 'asc' as const } } };

class ListingRepository {
  create(
    data: Prisma.ListingCreateInput,
    tx: Tx | typeof prisma = prisma,
  ): Promise<ListingWithMedia> {
    return tx.listing.create({ data, include: mediaInclude });
  }

  findById(id: string, tx: Tx | typeof prisma = prisma): Promise<ListingWithMedia | null> {
    return tx.listing.findUnique({ where: { id }, include: mediaInclude });
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
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const listingRepository = new ListingRepository();
