import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { deviceController } from './controllers/device.controller';
import { registerDeviceBodySchema, unregisterDeviceBodySchema } from './validation/device.schema';

export const notificationsRouter = Router();

notificationsRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));

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
