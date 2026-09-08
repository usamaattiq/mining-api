import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { s3Client } from '../../../integrations/s3/s3.client';
import { extensionFor, type AllowedContentType } from '../validation/upload.schema';

// Keys are namespaced by userId so a signed GET can be denied for objects
// that don't belong to the requesting user, without needing a DB lookup.
function userPrefix(userId: string): string {
  return `uploads/${userId}/`;
}

export const uploadService = {
  async createUploadUrl(userId: string, contentType: AllowedContentType) {
    const key = `${userPrefix(userId)}${randomUUID()}.${extensionFor(contentType)}`;

    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGN_EXPIRES_IN,
    });

    return { uploadUrl, key, expiresIn: env.S3_PRESIGN_EXPIRES_IN };
  },

  async createViewUrl(userId: string, key: string) {
    if (!key.startsWith(userPrefix(userId))) {
      throw new AppError('You do not have access to this file', 403, ErrorCode.FORBIDDEN);
    }

    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGN_GET_EXPIRES_IN,
    });

    return { url, expiresIn: env.S3_PRESIGN_GET_EXPIRES_IN };
  },
};
