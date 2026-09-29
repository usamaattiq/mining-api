import type { InAppNotification, ListingCategory } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { prisma } from '../../../common/database/prisma';
import { inboxRepository } from '../repositories/inbox.repository';
import type { InAppNotificationDto } from '../types/inbox.types';

function toDto(
  row: InAppNotification,
  listingCategory: ListingCategory | null,
): InAppNotificationDto {
  return {
    id: row.id,
    titleKey: row.titleKey,
    bodyKey: row.bodyKey,
    sentAt: row.sentAt.getTime(),
    read: row.read,
    icon: row.icon,
    target: row.target,
    listingId: row.listingId,
    listingCategory,
    conversationId: row.conversationId,
  };
}

class InboxService {
  async list(userId: string): Promise<InAppNotificationDto[]> {
    const rows = await inboxRepository.listForUser(userId);
    const listingIds = rows.map((row) => row.listingId).filter((id): id is string => Boolean(id));
    const listings =
      listingIds.length === 0
        ? []
        : await prisma.listing.findMany({
            where: { id: { in: listingIds } },
            select: { id: true, category: true },
          });
    const categoryById = new Map(listings.map((listing) => [listing.id, listing.category]));
    return rows.map((row) =>
      toDto(row, row.listingId ? (categoryById.get(row.listingId) ?? null) : null),
    );
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await inboxRepository.markRead(userId, id);
    if (result.count === 0) {
      throw new AppError('Notification not found', 404, ErrorCode.NOT_FOUND);
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await inboxRepository.markAllRead(userId);
  }
}

export const inboxService = new InboxService();
