import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apiEnvSchema, clientConfigSchema, type EnvValidationError, loadApiEnv } from '@platform/config';
import { createLogger } from '../src/lib/logger.js';
import { createProviders, requireProvider } from '../src/providers/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = Buffer.alloc(32, 1).toString('base64');
const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', APP_ENCRYPTION_KEY: KEY };
const issues = (src: Record<string, string>) => {
  try { loadApiEnv(src); return []; } catch (e) { return (e as EnvValidationError).issues; }
};

describe('env validation (fail fast)', () => {
  it('refuses to boot without required values or with a bad encryption key', () => {
    expect(issues({}).join('\n')).toMatch(/DATABASE_URL/);
    expect(issues({}).join('\n')).toMatch(/APP_ENCRYPTION_KEY/);
    expect(issues({ ...base, APP_ENCRYPTION_KEY: 'short' }).join('\n')).toMatch(/32 random bytes/);
    expect(issues({ ...base, DATABASE_URL: 'mysql://x' }).join('\n')).toMatch(/PostgreSQL/);
  });

  it('boots with defaults and every optional capability OFF', () => {
    const env = loadApiEnv(base);
    expect(env).toMatchObject({ PORT: 4000, JOBS_ENABLED: true, AUDIT_LOG_ENABLED: true, EMAIL_PROVIDER: '', STORAGE_PROVIDER: '', AI_PROVIDER: '', PAYMENT_PROVIDER: '', CORS_ORIGINS: [] });
    expect(env.COOKIE_SECURE_RESOLVED).toBe(false);
  });

  it('rejects unknown provider names and any AI/payment provider until one is chosen', () => {
    expect(issues({ ...base, EMAIL_PROVIDER: 'sendgrid', EMAIL_FROM: 'a@b.co' }).join('\n')).toMatch(/EMAIL_PROVIDER/);
    expect(issues({ ...base, STORAGE_PROVIDER: 'dropbox' }).join('\n')).toMatch(/STORAGE_PROVIDER/);
    expect(issues({ ...base, AI_PROVIDER: 'openai' }).join('\n')).toMatch(/AI_PROVIDER/);
    expect(issues({ ...base, PAYMENT_PROVIDER: 'sslcommerz' }).join('\n')).toMatch(/PAYMENT_PROVIDER/);
    expect(issues({ ...base, EMAIL_PROVIDER: 'console' }).join('\n')).toMatch(/EMAIL_FROM/); // credentials required once selected
  });

  it('enforces production safety', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(issues({ ...prod, COOKIE_SECURE: 'false' }).join('\n')).toMatch(/COOKIE_SECURE/);
    expect(issues({ ...prod, CORS_ORIGINS: 'http://app.example.com' }).join('\n')).toMatch(/https/);
    expect(issues({ ...prod, EMAIL_PROVIDER: 'console', EMAIL_FROM: 'a@b.co' }).join('\n')).toMatch(/console/);
    expect(loadApiEnv(prod)).toMatchObject({ COOKIE_SECURE_RESOLVED: true, API_DOCS_ENABLED: false });
  });

  it('validates origins and numbers strictly', () => {
    expect(issues({ ...base, CORS_ORIGINS: 'https://a.example.com/' }).join('\n')).toMatch(/no path/);
    expect(issues({ ...base, PORT: '99999' }).join('\n')).toMatch(/PORT/);
    expect(issues({ ...base, JOBS_ENABLED: 'maybe' }).join('\n')).toMatch(/JOBS_ENABLED/);
    expect(loadApiEnv({ ...base, CORS_ORIGINS: 'https://a.example.com, https://b.example.com' }).CORS_ORIGINS).toHaveLength(2);
  });

  it('keeps .env.example in sync with the schema (no missing, no stale keys)', () => {
    const text = readFileSync(path.join(here, '../.env.example'), 'utf8');
    const listed = new Set([...text.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const known = new Set(Object.keys(apiEnvSchema.shape));
    expect([...known].filter((k) => !listed.has(k))).toEqual([]);
    expect([...listed].filter((k) => !known.has(k!))).toEqual([]);
  });

  it('never accepts secrets under a client-exposed prefix', () => {
    const names = Object.keys(apiEnvSchema.shape);
    expect(names.filter((n) => /^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(n))).toEqual([]);
  });
});

const noDb = { APP_ENCRYPTION_KEY: KEY };
const NEON = 'postgresql://n:p@ep-x.neon.tech/neondb?sslmode=require';
const MYDB = 'postgresql://m:p@200.141.0.216:5432/mydb';
const LOCAL = 'postgresql://l:p@localhost:5432/loc';
const urls = { NEON_DATABASE_URL: NEON, MYDB_DATABASE_URL: MYDB, LOCAL_DATABASE_URL: LOCAL };

describe('DB_PROVIDER selects the database', () => {
  it('uses the URL that belongs to the chosen provider', () => {
    expect(loadApiEnv({ ...noDb, ...urls, DB_PROVIDER: 'neon' })).toMatchObject({ DATABASE_URL: NEON, DB_PROVIDER_RESOLVED: 'neon' });
    expect(loadApiEnv({ ...noDb, ...urls, DB_PROVIDER: 'mydb' })).toMatchObject({ DATABASE_URL: MYDB, DB_PROVIDER_RESOLVED: 'mydb' });
    expect(loadApiEnv({ ...noDb, ...urls, DB_PROVIDER: 'local' })).toMatchObject({ DATABASE_URL: LOCAL, DB_PROVIDER_RESOLVED: 'local' });
  });
  it('ignores the other providers URLs and the legacy DATABASE_URL once a provider is chosen', () => {
    expect(loadApiEnv({ ...noDb, ...urls, DATABASE_URL: 'postgresql://old/x', DB_PROVIDER: 'mydb' }).DATABASE_URL).toBe(MYDB);
  });
  it('falls back to plain DATABASE_URL when DB_PROVIDER is blank', () => {
    expect(loadApiEnv({ ...noDb, DATABASE_URL: LOCAL })).toMatchObject({ DATABASE_URL: LOCAL, DB_PROVIDER_RESOLVED: 'url' });
  });
  it('fails fast and names the missing variable, without echoing any URL', () => {
    const out = issues({ ...noDb, DB_PROVIDER: 'neon', MYDB_DATABASE_URL: MYDB }).join('\n');
    expect(out).toMatch(/NEON_DATABASE_URL is required when DB_PROVIDER=neon/);
    expect(out).not.toContain('200.141.0.216');
    expect(issues({ ...noDb, DB_PROVIDER: 'planetscale' }).join('\n')).toMatch(/DB_PROVIDER/);
    expect(issues({ ...noDb, DB_PROVIDER: 'mydb', MYDB_DATABASE_URL: 'mysql://x' }).join('\n')).toMatch(/PostgreSQL/);
  });
});

describe('STORAGE_PROVIDER and EMAIL_PROVIDER need their own credentials', () => {
  const cloud = { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };
  const s3 = { S3_BUCKET: 'b', S3_REGION: 'eu-west-1', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' };
  const smtp = { EMAIL_FROM: 'no-reply@example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' };

  it('cloudinary and s3 refuse to boot without credentials, and boot with them', () => {
    expect(issues({ ...base, STORAGE_PROVIDER: 'cloudinary' }).join('\n')).toMatch(/CLOUDINARY_API_SECRET/);
    expect(issues({ ...base, STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' }).join('\n')).toMatch(/S3_ACCESS_KEY_ID/);
    expect(issues({ ...base, STORAGE_PROVIDER: 'cloudinary', ...cloud })).toEqual([]);
    expect(issues({ ...base, STORAGE_PROVIDER: 's3', ...s3, S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_FORCE_PATH_STYLE: 'true' })).toEqual([]);
  });
  it('credentials of an unselected provider are ignored', () => {
    expect(issues({ ...base, STORAGE_PROVIDER: 's3', ...s3, ...cloud })).toEqual([]);
    expect(issues({ ...base, ...cloud })).toEqual([]);
  });
  it('smtp requires a host and a complete login', () => {
    expect(issues({ ...base, EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@b.co' }).join('\n')).toMatch(/SMTP_HOST/);
    expect(issues({ ...base, EMAIL_PROVIDER: 'smtp', ...smtp, SMTP_PASS: '' }).join('\n')).toMatch(/SMTP_USER and SMTP_PASS/);
    expect(issues({ ...base, EMAIL_PROVIDER: 'smtp', ...smtp, NODE_ENV: 'production' })).toEqual([]);
    expect(loadApiEnv({ ...base, EMAIL_PROVIDER: 'smtp', ...smtp })).toMatchObject({ SMTP_PORT: 587, SMTP_SECURE: false });
  });
  it('the factory builds the adapter that the env names (and nothing when blank)', () => {
    const logger = createLogger(loadApiEnv({ ...base, LOG_LEVEL: 'silent' }));
    const build = (src: Record<string, string>) => createProviders(loadApiEnv({ ...base, ...src }), logger);
    expect(build({}).storage).toBeNull();
    expect(build({}).email).toBeNull();
    expect(build({ STORAGE_PROVIDER: 'cloudinary', ...cloud }).storage?.name).toBe('cloudinary');
    expect(build({ STORAGE_PROVIDER: 's3', ...s3 }).storage?.name).toBe('s3');
    expect(build({ STORAGE_PROVIDER: 'local' }).storage?.name).toBe('local');
    expect(build({ EMAIL_PROVIDER: 'smtp', ...smtp }).email?.name).toBe('smtp');
    expect(build({ EMAIL_PROVIDER: 'console', EMAIL_FROM: 'a@b.co' }).email?.name).toBe('console');
  });
});

describe('capabilities that are off are rejected, never faked', () => {
  it('requireProvider throws CAPABILITY_DISABLED for a null provider', () => {
    try { requireProvider(null, 'AI'); expect.unreachable(); } catch (e) { expect(e).toMatchObject({ status: 503, code: 'CAPABILITY_DISABLED' }); }
    expect(requireProvider({ name: 'x' }, 'AI')).toEqual({ name: 'x' });
  });
});

describe('client config', () => {
  it('the example client file is valid and carries no secrets', () => {
    const raw = readFileSync(path.join(here, '../../../clients/example/client.config.json'), 'utf8');
    const cfg = clientConfigSchema.parse(JSON.parse(raw));
    expect(cfg.release).toBe('v0.1.0');
    expect(raw).not.toMatch(/password|secret|token|key/i);
    expect(() => clientConfigSchema.parse({ ...JSON.parse(raw), name: 'Bad Name' })).toThrow();
  });
});
