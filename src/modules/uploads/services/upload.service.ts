import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../config/env';
import { s3Client } from '../../../integrations/s3/s3.client';
import { extensionFor, type AllowedContentType } from '../validation/upload.schema';

function publicUrlFor(key: string): string {
  return `${env.AWS_S3_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
}

export const uploadService = {
  async createUploadUrl(userId: string, contentType: AllowedContentType, contentLength: number) {
    const key = `uploads/${userId}/${randomUUID()}.${extensionFor(contentType)}`;

    // ContentLength is included in the SigV4 signature so S3 rejects PUTs whose
    // actual body size does not match the declared size (cost / DoS guard).
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: env.S3_PRESIGN_EXPIRES_IN,
    });

    return { uploadUrl, key, publicUrl: publicUrlFor(key), expiresIn: env.S3_PRESIGN_EXPIRES_IN };
  },
};
