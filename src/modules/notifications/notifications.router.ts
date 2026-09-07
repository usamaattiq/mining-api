import { Router } from 'express';
import { requireAuth } from '../../common/middleware/require-auth';
import { deviceController } from './controllers/device.controller';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);
notificationsRouter.post('/devices', deviceController.register);
notificationsRouter.delete('/devices/:expoPushToken', deviceController.unregister);
