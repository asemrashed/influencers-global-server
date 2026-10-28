import { v2 as cloudinary } from 'cloudinary';
import type { ApiEnv } from '@platform/config';
import { errors } from '../lib/errors.js';
import { DEFAULT_URL_TTL_SECONDS, SAFE_KEY, type StorageProvider } from './types.js';

/**
 * Cloudinary adapter. Every file is stored as `raw` + `authenticated`: bytes are kept exactly as uploaded
 * and nothing is reachable by guessing a URL; reads use signed URLs. Media transformations (resize, etc.)
 * are not used here, so the same keys work unchanged if you later switch to S3.
 */
export function createCloudinaryStorage(env: ApiEnv): StorageProvider {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  const folder = (env.CLOUDINARY_FOLDER ?? '').replace(/^\/+|\/+$/g, '');
  const asset = { resource_type: 'raw', type: 'authenticated' } as const;
  const idOf = (key: string): string => {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw errors.validation([{ path: 'key', message: 'Invalid storage key' }]);
    return folder ? `${folder}/${key}` : key;
  };
  const isMissing = (e: unknown): boolean => {
    const err = (e as { error?: { http_code?: number }; http_code?: number }) ?? {};
    return (err.error?.http_code ?? err.http_code) === 404;
  };

  return {
    name: 'cloudinary',
    async put(key, data) {
      const publicId = idOf(key);
      await new Promise<void>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ ...asset, public_id: publicId, overwrite: true, invalidate: true, use_filename: false, unique_filename: false }, (err, res) => {
          if (err || !res) reject(new Error(`Cloudinary upload failed: ${err?.message ?? 'no response'}`));
          else resolve();
        });
        stream.end(data);
      });
    },
    async get(key) {
      const url = cloudinary.url(idOf(key), { ...asset, sign_url: true, secure: true });
      const res = await fetch(url);
      if (res.status === 404) throw errors.notFound('File');
      if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      try {
        await cloudinary.uploader.destroy(idOf(key), { ...asset, invalidate: true }); // "not found" is fine: already gone
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    },
    async exists(key) {
      try {
        await cloudinary.api.resource(idOf(key), asset);
        return true;
      } catch (e) {
        if (isMissing(e)) return false;
        throw e;
      }
    },
    async getUrl(key, expiresInSeconds = DEFAULT_URL_TTL_SECONDS) {
      const expires_at = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return cloudinary.utils.private_download_url(idOf(key), '', { ...asset, expires_at });
    },
  };
}
