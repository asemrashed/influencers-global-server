import { z } from 'zod';
import { plainText } from './common.js';

export const uploadFileResponseSchema = z.object({
  key: z.string(),
  url: z.string().nullable(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
}).meta({ id: 'UploadFileResponse' });
export type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;

export const uploadFileBodySchema = z.object({
  filename: plainText(1, 255),
  mimeType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  base64Data: z.string().min(1),
  folder: z.enum(['products', 'portfolio', 'media-kit', 'drafts', 'avatars']).default('products'),
});
export type UploadFileBody = z.infer<typeof uploadFileBodySchema>;

export const getFileUrlQuerySchema = z.object({
  expiresInSeconds: z.coerce.number().int().min(60).max(86400).optional(),
});
export type GetFileUrlQuery = z.infer<typeof getFileUrlQuerySchema>;

