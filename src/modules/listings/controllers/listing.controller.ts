import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { listingService } from '../services/listing.service';
import type {
  CreateListingBody,
  ListingIdParams,
  ListFeedQuery,
  ListListingsQuery,
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

  async getById(req: AuthenticatedRequest, res: Response) {
    const params = req.validatedParams as ListingIdParams;
    const listing = await listingService.getById(params.id);
    sendSuccess(res, 200, listing);
  },
};
