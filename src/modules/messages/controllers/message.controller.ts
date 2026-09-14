import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { messageService } from '../services/message.service';
import type {
  ConversationIdParams,
  SendMessageBody,
  StartConversationBody,
} from '../validation/message.schema';

export const messageController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const conversations = await messageService.listConversations(req.user!.id);
    sendSuccess(res, 200, conversations);
  },

  async start(req: AuthenticatedRequest, res: Response) {
    const body = req.validatedBody as StartConversationBody;
    const conversation = await messageService.startConversation(req.user!.id, body.listingId);
    sendSuccess(res, 200, conversation);
  },

  async getById(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ConversationIdParams;
    const conversation = await messageService.getConversation(req.user!.id, params.id);
    sendSuccess(res, 200, conversation);
  },

  async send(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ConversationIdParams;
    const body = req.validatedBody as SendMessageBody;
    const conversation = await messageService.sendMessage(req.user!.id, params.id, body.text);
    sendSuccess(res, 201, conversation);
  },

  async markRead(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ConversationIdParams;
    const conversation = await messageService.markRead(req.user!.id, params.id);
    sendSuccess(res, 200, conversation);
  },
};
