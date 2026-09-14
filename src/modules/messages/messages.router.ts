import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { messageController } from './controllers/message.controller';
import {
  conversationIdParamsSchema,
  sendMessageBodySchema,
  startConversationBodySchema,
} from './validation/message.schema';

export const messagesRouter = Router();

messagesRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));

messagesRouter.get(
  '/conversations',
  wrap((req, res) => messageController.list(req, res)),
);

messagesRouter.post(
  '/conversations',
  validate(startConversationBodySchema),
  wrap((req, res) => messageController.start(req, res)),
);

messagesRouter.get(
  '/conversations/:id',
  validate(conversationIdParamsSchema),
  wrap((req, res) => messageController.getById(req, res)),
);

messagesRouter.post(
  '/conversations/:id/messages',
  validate(conversationIdParamsSchema.merge(sendMessageBodySchema)),
  wrap((req, res) => messageController.send(req, res)),
);

messagesRouter.post(
  '/conversations/:id/read',
  validate(conversationIdParamsSchema),
  wrap((req, res) => messageController.markRead(req, res)),
);
