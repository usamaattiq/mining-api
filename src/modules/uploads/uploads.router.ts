import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { validate } from '../../common/validation/validate';
import { authenticateUser } from '../auth/middleware/authenticate-user';
import { uploadController } from './controllers/upload.controller';
import { presignUploadBodySchema } from './validation/upload.schema';

export const uploadsRouter = Router();

uploadsRouter.use(wrap((req, res, next) => authenticateUser(req, res, next)));

uploadsRouter.post(
  '/presign',
  validate(presignUploadBodySchema),
  wrap((req, res) => uploadController.createUploadUrl(req, res)),
);
