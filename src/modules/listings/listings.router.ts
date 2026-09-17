import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { listingController } from './controllers/listing.controller';
import {
  createListingBodySchema,
  listingIdParamsSchema,
  listFeedQuerySchema,
  listListingsQuerySchema,
  submitListingOfferBodySchema,
} from './validation/listing.schema';

export const listingsRouter = Router();

listingsRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));

listingsRouter.get(
  '/',
  validate(listListingsQuerySchema),
  wrap((req, res) => listingController.listMine(req, res)),
);

listingsRouter.get(
  '/feed',
  validate(listFeedQuerySchema),
  wrap((req, res) => listingController.listFeed(req, res)),
);

listingsRouter.post(
  '/',
  validate(createListingBodySchema),
  wrap((req, res) => listingController.create(req, res)),
);

listingsRouter.post(
  '/:id/offers',
  validate(listingIdParamsSchema.merge(submitListingOfferBodySchema)),
  wrap((req, res) => listingController.submitOffer(req, res)),
);

listingsRouter.get(
  '/:id',
  validate(listingIdParamsSchema),
  wrap((req, res) => listingController.getById(req, res)),
);
