import type { InAppNotification } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { inboxRepository } from '../repositories/inbox.repository';
import type { InAppNotificationDto } from '../types/inbox.types';

function toDto(row: InAppNotification): InAppNotificationDto {
  return {
    id: row.id,
    titleKey: row.titleKey,
    bodyKey: row.bodyKey,
    sentAt: row.sentAt.getTime(),
    read: row.read,
    icon: row.icon,
    target: row.target,
    listingId: row.listingId,
    conversationId: row.conversationId,
  };
}

class InboxService {
  async list(userId: string): Promise<InAppNotificationDto[]> {
    const rows = await inboxRepository.listForUser(userId);
    return rows.map(toDto);
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
