import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { inboxService } from '../services/inbox.service';
import type { NotificationIdParams } from '../validation/inbox.schema';

export const inboxController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const items = await inboxService.list(req.user!.id);
    sendSuccess(res, 200, items);
  },

  async markRead(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as NotificationIdParams;
    await inboxService.markRead(req.user!.id, params.id);
    sendSuccess(res, 200, { read: true });
  },

  async markAllRead(req: AuthenticatedRequest, res: Response) {
    await inboxService.markAllRead(req.user!.id);
    sendSuccess(res, 200, { read: true });
  },
};
