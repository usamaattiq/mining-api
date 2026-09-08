import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { authRateLimiter } from '../../common/middleware/auth-rate-limit';
import { locationsController } from './controllers/locations.controller';

export const locationsRouter = Router();

locationsRouter.use(authRateLimiter);

locationsRouter.get(
  '/autocomplete',
  wrap((req, res) => locationsController.autocomplete(req, res)),
);

locationsRouter.get(
  '/details',
  wrap((req, res) => locationsController.placeDetails(req, res)),
);

locationsRouter.get(
  '/reverse-geocode',
  wrap((req, res) => locationsController.reverseGeocode(req, res)),
);
