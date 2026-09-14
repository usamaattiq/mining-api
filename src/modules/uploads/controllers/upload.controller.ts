import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { uploadService } from '../services/upload.service';
import type { PresignUploadInput } from '../validation/upload.schema';

export const uploadController = {
  async createUploadUrl(req: AuthenticatedRequest, res: Response) {
    const { contentType } = req.validatedBody as PresignUploadInput;
    const result = await uploadService.createUploadUrl(req.user!.id, contentType);
    sendSuccess(res, 201, result);
  },
};
