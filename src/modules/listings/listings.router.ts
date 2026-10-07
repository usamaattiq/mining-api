import { Router } from 'express';
import { prisma } from '../../common/database/prisma';
import { wrap } from '../../common/http/wrap';
import { sendSuccess } from '../../common/http/api-response';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { listingController } from './controllers/listing.controller';
import {
  createListingBodySchema,
  equipmentStockReturnParamsSchema,
  listingIdParamsSchema,
  listingOfferActionParamsSchema,
  listFeedQuerySchema,
  listListingsQuerySchema,
  submitListingOfferBodySchema,
  updateEquipmentUnitsSchema,
  updateListingOfferSchema,
  updateListingSchema,
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

listingsRouter.get(
  '/my-offers',
  wrap((req, res) => listingController.listMyOffers(req, res)),
);

listingsRouter.get(
  '/rfq-health',
  wrap((req, res) => listingController.rfqHealth(req, res)),
);

listingsRouter.get(
  '/catalog',
  wrap(async (req, res) => {
    const category = req.query.category;
    if (category !== 'equipment' && category !== 'services' && category !== 'gold') {
      sendSuccess(res, 200, { names: [] as string[] });
      return;
    }
    const rows = await prisma.catalogLabel.findMany({
      where: { category },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nameAr: true, parentId: true },
    });
    sendSuccess(res, 200, {
      names: rows.map((row) => row.name),
      items: rows,
    });
  }),
);

listingsRouter.post(
  '/',
  validate(createListingBodySchema),
  wrap((req, res) => listingController.create(req, res)),
);

listingsRouter.post(
  '/:id/offers/:offerId/accept',
  validate(listingOfferActionParamsSchema),
  wrap((req, res) => listingController.acceptOffer(req, res)),
);

listingsRouter.post(
  '/:id/offers/:offerId/reject',
  validate(listingOfferActionParamsSchema),
  wrap((req, res) => listingController.rejectOffer(req, res)),
);

listingsRouter.post(
  '/:id/offers/:offerId/confirm',
  validate(listingOfferActionParamsSchema),
  wrap((req, res) => listingController.confirmOffer(req, res)),
);

listingsRouter.post(
  '/:id/offers/:offerId/decline',
  validate(listingOfferActionParamsSchema),
  wrap((req, res) => listingController.declineOffer(req, res)),
);

listingsRouter.patch(
  '/:id/offers/:offerId',
  validate(updateListingOfferSchema),
  wrap((req, res) => listingController.updateOffer(req, res)),
);

listingsRouter.post(
  '/:id/offers/:offerId/withdraw',
  validate(listingOfferActionParamsSchema),
  wrap((req, res) => listingController.withdrawOffer(req, res)),
);

listingsRouter.post(
  '/:id/offers',
  validate(listingIdParamsSchema.merge(submitListingOfferBodySchema)),
  wrap((req, res) => listingController.submitOffer(req, res)),
);

listingsRouter.get(
  '/:id/stock',
  validate(listingIdParamsSchema),
  wrap((req, res) => listingController.listEquipmentStock(req, res)),
);

listingsRouter.patch(
  '/:id/stock',
  validate(updateEquipmentUnitsSchema),
  wrap((req, res) => listingController.updateEquipmentUnits(req, res)),
);

listingsRouter.post(
  '/:id/stock/:holdId/return',
  validate(equipmentStockReturnParamsSchema),
  wrap((req, res) => listingController.returnRentedUnits(req, res)),
);

listingsRouter.patch(
  '/:id',
  validate(updateListingSchema),
  wrap((req, res) => listingController.update(req, res)),
);

listingsRouter.delete(
  '/:id',
  validate(listingIdParamsSchema),
  wrap((req, res) => listingController.remove(req, res)),
);

listingsRouter.get(
  '/:id',
  validate(listingIdParamsSchema),
  wrap((req, res) => listingController.getById(req, res)),
);
