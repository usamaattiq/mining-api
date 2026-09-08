import type { Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { locationsService } from '../services/locations.service';
import { assertCallerAllowed } from '../utils/assert-caller-allowed';
import {
  autocompleteQuerySchema,
  placeDetailsQuerySchema,
  reverseGeocodeQuerySchema,
} from '../validation/locations.schema';

function parseQuery<TSchema extends ZodTypeAny>(schema: TSchema, query: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new AppError(
      'Validation failed',
      400,
      ErrorCode.VALIDATION_ERROR,
      parsed.error.flatten().fieldErrors,
    );
  }
  return parsed.data;
}

export const locationsController = {
  async autocomplete(req: AuthenticatedRequest, res: Response) {
    const query = parseQuery(autocompleteQuerySchema, req.query);
    await assertCallerAllowed(req, query.dialCode, query.phoneNumber);

    const predictions = await locationsService.autocomplete(query.input, query.sessiontoken);
    sendSuccess(res, 200, predictions);
  },

  async placeDetails(req: AuthenticatedRequest, res: Response) {
    const query = parseQuery(placeDetailsQuerySchema, req.query);
    await assertCallerAllowed(req, query.dialCode, query.phoneNumber);

    const result = await locationsService.placeDetails(query.placeId, query.sessiontoken);
    sendSuccess(res, 200, result);
  },

  async reverseGeocode(req: AuthenticatedRequest, res: Response) {
    const query = parseQuery(reverseGeocodeQuerySchema, req.query);
    await assertCallerAllowed(req, query.dialCode, query.phoneNumber);

    const result = await locationsService.reverseGeocode(query.lat, query.lng);
    sendSuccess(res, 200, result);
  },
};
