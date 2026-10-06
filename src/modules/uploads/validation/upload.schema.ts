import { z } from 'zod';
import { env } from '../../../config/env';

const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
} as const;

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;

export function extensionFor(contentType: AllowedContentType): string {
  return ALLOWED_CONTENT_TYPES[contentType];
}

export const presignUploadBodySchema = z.object({
  body: z.object({
    contentType: z.enum(
      Object.keys(ALLOWED_CONTENT_TYPES) as [AllowedContentType, ...AllowedContentType[]],
    ),
    contentLength: z
      .number()
      .int()
      .positive()
      .max(env.S3_MAX_UPLOAD_BYTES, `File exceeds max size of ${env.S3_MAX_UPLOAD_BYTES} bytes`),
  }),
});

export type PresignUploadInput = z.infer<typeof presignUploadBodySchema>['body'];
