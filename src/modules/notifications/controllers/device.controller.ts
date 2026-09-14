import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { deviceService } from '../services/device.service';
import { notifyService } from '../services/notify.service';
import type { RegisterDeviceInput, UnregisterDeviceInput } from '../validation/device.schema';

export const deviceController = {
  async register(req: AuthenticatedRequest, res: Response) {
    const body = req.validatedBody as RegisterDeviceInput;
    const device = await deviceService.registerDevice(req.user!.id, body);
    sendSuccess(res, 201, device);
  },

  async unregister(req: AuthenticatedRequest, res: Response) {
    const body = req.validatedBody as UnregisterDeviceInput;
    await deviceService.unregisterDevice(req.user!.id, body.expoPushToken);
    sendSuccess(res, 200, { ok: true });
  },

  /** Smoke path — sends a test push to the authenticated user. */
  async sendTest(req: AuthenticatedRequest, res: Response) {
    const result = await notifyService.notifyUser({
      userId: req.user!.id,
      title: 'Dahabi test',
      body: 'Push notifications are working.',
      deepLink: 'miningmobile://home',
      data: { source: 'test' },
      idempotencyKey: `test-${req.user!.id}-${Date.now()}`,
    });
    sendSuccess(res, 200, result);
  },
};
