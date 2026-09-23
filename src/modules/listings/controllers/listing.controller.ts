import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import { rfqClient } from '../../../integrations/rfq/rfq.client';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { listingService } from '../services/listing.service';
import type {
  CreateListingBody,
  ListingIdParams,
  ListingOfferActionParams,
  ListFeedQuery,
  ListListingsQuery,
  SubmitListingOfferBody,
} from '../validation/listing.schema';

export const listingController = {
  async create(req: AuthenticatedRequest, res: Response) {
    const body = req.validatedBody as CreateListingBody;
    const listing = await listingService.create(req.user!.id, body);
    sendSuccess(res, 201, listing);
  },

  async listMine(req: AuthenticatedRequest, res: Response) {
    const query = (req.validatedQuery as ListListingsQuery | undefined) ?? {};
    const listings = await listingService.listMine(req.user!.id, query);
    sendSuccess(res, 200, listings);
  },

  async listFeed(req: AuthenticatedRequest, res: Response) {
    const query = req.validatedQuery as ListFeedQuery;
    const listings = await listingService.listFeed(req.user!.id, query);
    sendSuccess(res, 200, listings);
  },

  async rfqHealth(_req: AuthenticatedRequest, res: Response) {
    const up = await rfqClient.isReachable();
    sendSuccess(res, 200, { up });
  },

  async listMyOffers(req: AuthenticatedRequest, res: Response) {
    const listings = await listingService.listMyOffers(req.user!.id);
    sendSuccess(res, 200, listings);
  },

  async getById(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingIdParams;
    const listing = await listingService.getById(params.id, req.user!.id);
    sendSuccess(res, 200, listing);
  },

  async submitOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingIdParams;
    const body = req.validatedBody as SubmitListingOfferBody;
    const listing = await listingService.submitOffer(params.id, req.user!.id, body);
    sendSuccess(res, 201, listing);
  },

  async acceptOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingOfferActionParams;
    const listing = await listingService.decideOffer(
      params.id,
      req.user!.id,
      params.offerId,
      'select',
    );
    sendSuccess(res, 200, listing);
  },

  async rejectOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingOfferActionParams;
    const listing = await listingService.decideOffer(
      params.id,
      req.user!.id,
      params.offerId,
      'reject',
    );
    sendSuccess(res, 200, listing);
  },

  async confirmOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingOfferActionParams;
    const listing = await listingService.decideOffer(
      params.id,
      req.user!.id,
      params.offerId,
      'confirm',
    );
    sendSuccess(res, 200, listing);
  },

  async declineOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingOfferActionParams;
    const listing = await listingService.decideOffer(
      params.id,
      req.user!.id,
      params.offerId,
      'decline',
    );
    sendSuccess(res, 200, listing);
  },

  async withdrawOffer(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingOfferActionParams;
    const listing = await listingService.decideOffer(
      params.id,
      req.user!.id,
      params.offerId,
      'withdraw',
    );
    sendSuccess(res, 200, listing);
  },
};
