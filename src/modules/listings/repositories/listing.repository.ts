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

  archive(id: string): Promise<ListingWithMedia> {
    return prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
      include: listingInclude,
    });
  }

  setUnits(id: string, units: number): Promise<ListingWithMedia> {
    return prisma.listing.update({
      where: { id },
      data: { units },
      include: listingInclude,
    });
  }

  updateContent(
    id: string,
    data: Prisma.ListingUpdateInput,
    media: Prisma.ListingMediaCreateWithoutListingInput[],
  ): Promise<ListingWithMedia> {
    return prisma.$transaction(async (tx) => {
      await tx.listingMedia.deleteMany({ where: { listingId: id } });
      return tx.listing.update({
        where: { id },
        data: {
          ...data,
          media: { create: media },
        },
        include: listingInclude,
      });
    });
  }

  setRfqId(id: string, rfqId: string, tx: Tx | typeof prisma = prisma): Promise<ListingWithMedia> {
    return tx.listing.update({
      where: { id },
      data: { rfqId },
      include: listingInclude,
    });
  }

  setAuctionSelection(
    id: string,
    selection: {
      participantId: string | null;
      selectedAt: Date | null;
      skipPromptedAt?: Date | null;
    },
  ): Promise<ListingWithMedia> {
    return prisma.listing.update({
      where: { id },
      data: {
        auctionSelectedParticipantId: selection.participantId,
        auctionOfferSelectedAt: selection.selectedAt,
        auctionSkipPromptedAt: selection.skipPromptedAt ?? null,
      },
      include: listingInclude,
    });
  }

  findStaleAuctionSelections(selectedBefore: Date): Promise<ListingWithMedia[]> {
    return prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        rfqId: { not: null },
        auctionOfferSelectedAt: { lte: selectedBefore },
        auctionSkipPromptedAt: null,
        OR: [{ category: 'gold' }, { requestMode: 'auction' }],
      },
      include: listingInclude,
    });
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
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOffered(input: { listingIds: string[]; rfqIds: string[] }): Promise<ListingWithMedia[]> {
    const filters: Prisma.ListingWhereInput[] = [];
    if (input.listingIds.length > 0) {
      filters.push({ id: { in: input.listingIds } });
    }
    if (input.rfqIds.length > 0) {
      filters.push({ rfqId: { in: input.rfqIds } });
    }
    if (filters.length === 0) return Promise.resolve([]);

    return prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        OR: filters,
      },
      include: listingInclude,
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const listingRepository = new ListingRepository();
