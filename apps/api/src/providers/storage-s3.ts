import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiEnv } from '@platform/config';
import { errors } from '../lib/errors.js';
import { DEFAULT_URL_TTL_SECONDS, SAFE_KEY, type StorageProvider } from './types.js';

const status = (e: unknown): number | undefined => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

/**
 * S3 adapter. Works with AWS S3 and any S3-compatible service (Cloudflare R2, Wasabi, MinIO, Hostinger
 * object storage...) by setting S3_ENDPOINT (and S3_FORCE_PATH_STYLE=true where the service needs it).
 * The bucket must stay PRIVATE; files are handed out through short-lived presigned URLs.
 */
export function createS3Storage(env: ApiEnv): StorageProvider {
  const bucket = env.S3_BUCKET!;
  const client = new S3Client({
    region: env.S3_REGION!,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  const keyOf = (key: string): string => {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw errors.validation([{ path: 'key', message: 'Invalid storage key' }]);
    return key;
  };

  return {
    name: 's3',
    async put(key, data) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: keyOf(key), Body: data }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyOf(key) }));
        return Buffer.from(await res.Body!.transformToByteArray());
      } catch (e) {
        if (status(e) === 404 || (e as { name?: string }).name === 'NoSuchKey') throw errors.notFound('File');
        throw e;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyOf(key) })); // S3 delete is idempotent
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keyOf(key) }));
        return true;
      } catch (e) {
        if (status(e) === 404 || (e as { name?: string }).name === 'NotFound') return false;
        throw e;
      }
    },
    getUrl: (key, expiresInSeconds = DEFAULT_URL_TTL_SECONDS) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: keyOf(key) }), { expiresIn: expiresInSeconds }),
  };
}
