import { z } from 'zod';
import { MODULE_KEYS } from '@platform/shared-types';

/**
 * Per-client deployment config (`clients/<name>/client.config.json`). Contains NO secrets.
 * Read by tools/deploy; it can only act on the one client it describes.
 */
export const clientConfigSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase letters, digits and dashes'),
  displayName: z.string().min(1),
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'e.g. client.com'),
  apiDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
  release: z.string().min(1).describe('Git tag of the core backend this client runs, e.g. v0.1.0'),
  uiRepo: z.string().optional().describe('Pointer to the client UI repo (separate deployment)'),
  uiRelease: z.string().optional(),
  allowedOrigins: z.array(z.url()).default([]).describe('Becomes CORS_ORIGINS'),
  modules: z.array(z.enum(MODULE_KEYS)).default([...MODULE_KEYS]).describe('Modules enabled at install'),
  providers: z
    .object({
      storage: z.enum(['', 'local', 's3', 'cloudinary']).default(''),
      email: z.enum(['', 'console', 'smtp']).default(''),
      ai: z.string().default(''),
      payment: z.string().default(''),
    })
    .default({ storage: '', email: '', ai: '', payment: '' }),
  server: z.object({
    host: z.string().min(1),
    sshUser: z.string().min(1).default('deploy'),
    path: z.string().startsWith('/').default('/srv/platform'),
    service: z.string().default('platform-api'),
  }),
  backup: z.object({ target: z.string().default(''), keepDays: z.number().int().min(1).default(14) }).default({ target: '', keepDays: 14 }),
});
export type ClientConfig = z.infer<typeof clientConfigSchema>;
