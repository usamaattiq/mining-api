import type { Response } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { uploadService } from '../services/upload.service';
import { presignViewQuerySchema, type PresignUploadInput } from '../validation/upload.schema';

export const uploadController = {
  async createUploadUrl(req: AuthenticatedRequest, res: Response) {
    const { contentType } = req.validatedBody as PresignUploadInput;
    const result = await uploadService.createUploadUrl(req.user!.id, contentType);
    sendSuccess(res, 201, result);
  },

  async createViewUrl(req: AuthenticatedRequest, res: Response) {
    const parsed = presignViewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        'Validation failed',
        400,
        ErrorCode.VALIDATION_ERROR,
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await uploadService.createViewUrl(req.user!.id, parsed.data.key);
    sendSuccess(res, 200, result);
  },
};
