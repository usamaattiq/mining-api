import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { deviceController } from './controllers/device.controller';
import { inboxController } from './controllers/inbox.controller';
import { registerDeviceBodySchema, unregisterDeviceBodySchema } from './validation/device.schema';
import { notificationIdParamsSchema } from './validation/inbox.schema';

export const notificationsRouter = Router();

notificationsRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));

notificationsRouter.get(
  '/',
  wrap((req, res) => inboxController.list(req, res)),
);

notificationsRouter.post(
  '/read-all',
  wrap((req, res) => inboxController.markAllRead(req, res)),
);

notificationsRouter.post(
  '/devices',
  validate(registerDeviceBodySchema),
  wrap((req, res) => deviceController.register(req, res)),
);

notificationsRouter.post(
  '/devices/unregister',
  validate(unregisterDeviceBodySchema),
  wrap((req, res) => deviceController.unregister(req, res)),
);

notificationsRouter.post(
  '/test',
  wrap((req, res) => deviceController.sendTest(req, res)),
);

notificationsRouter.post(
  '/:id/read',
  validate(notificationIdParamsSchema),
  wrap((req, res) => inboxController.markRead(req, res)),
);
