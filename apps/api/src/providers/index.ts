import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiEnv } from '@platform/config';
import { errors } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { createSmtpEmail } from './email-smtp.js';
import { createCloudinaryStorage } from './storage-cloudinary.js';
import { createS3Storage } from './storage-s3.js';
import { SAFE_KEY, type AiProvider, type EmailProvider, type StorageProvider } from './types.js';

export * from './types.js';

/**
 * Capabilities are OFF when their provider var is blank (value `null`). Call sites use `requireProvider`
 * so a disabled capability is rejected, never faked as success.
 * AI and payment have no adapters yet: their env vars only accept blank until a provider is chosen.
 */
export interface Providers {
  email: EmailProvider | null;
  storage: StorageProvider | null;
  ai: AiProvider | null;
  payment: null;
}

export function requireProvider<T>(provider: T | null, capability: string): T {
  if (provider === null) throw errors.capabilityDisabled(capability);
  return provider;
}

function createConsoleEmail(logger: Logger): EmailProvider {
  return {
    name: 'console',
    async send(message) {
      // Development only (blocked in production by env validation): prints the message, links included.
      logger.info({ to: message.to, subject: message.subject, body: message.text }, 'email (console provider)');
    },
  };
}

function createLocalStorage(dir: string): StorageProvider {
  const root = path.resolve(dir);
  const resolve = (key: string): string => {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw errors.validation([{ path: 'key', message: 'Invalid storage key' }]);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw errors.validation([{ path: 'key', message: 'Invalid storage key' }]);
    return full;
  };
  return {
    name: 'local',
    async put(key, data) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    },
    get: (key) => readFile(resolve(key)),
    delete: (key) => rm(resolve(key), { force: true }),
    exists: async (key) => stat(resolve(key)).then(() => true, () => false),
    getUrl: async () => null, // not publicly reachable: stream through an authorized API route
  };
}

function createEmail(env: ApiEnv, logger: Logger): EmailProvider | null {
  switch (env.EMAIL_PROVIDER) {
    case 'console': return createConsoleEmail(logger);
    case 'smtp': return createSmtpEmail(env);
    default: return null;
  }
}

function createStorage(env: ApiEnv): StorageProvider | null {
  switch (env.STORAGE_PROVIDER) {
    case 'cloudinary': return createCloudinaryStorage(env);
    case 's3': return createS3Storage(env);
    case 'local': return createLocalStorage(env.STORAGE_LOCAL_DIR);
    default: return null;
  }
}

/** Adding a provider = one new adapter file + one `case` above + its env vars. Nothing else changes. */
export function createProviders(env: ApiEnv, logger: Logger): Providers {
  return { email: createEmail(env, logger), storage: createStorage(env), ai: null, payment: null };
}
