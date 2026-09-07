import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { deviceService } from '../services/device.service';
import { registerDeviceSchema } from '../validation/device.schema';

export const deviceController = {
  async register(req: AuthenticatedRequest, res: Response) {
    const parsed = registerDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const device = await deviceService.registerDevice(req.user!.id, parsed.data);
    res.status(201).json(device);
  },

  async unregister(req: AuthenticatedRequest, res: Response) {
    const expoPushToken = req.params.expoPushToken;
    if (!expoPushToken || Array.isArray(expoPushToken)) {
      res.status(400).json({ error: 'expoPushToken is required' });
      return;
    }

    await deviceService.unregisterDevice(req.user!.id, expoPushToken);
    res.status(204).send();
  },
};
