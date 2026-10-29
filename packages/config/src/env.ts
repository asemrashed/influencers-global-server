import { z } from 'zod';

/** "true"/"1"/"yes" → true, "false"/"0"/"no"/"" → false. Anything else is rejected. */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(s)) return true;
      if (['false', '0', 'no'].includes(s)) return false;
      ctx.addIssue({ code: 'custom', message: 'Expected true or false' });
      return z.NEVER;
    });

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `Expected an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

/** Blank means the capability is OFF. Unknown provider names are rejected, never silently ignored. */
const provider = <T extends readonly [string, ...string[]]>(names: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim())
    .pipe(z.enum(['', ...names]));

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v), z.string().optional());

/** AES-256 key, base64 (32 bytes). Generate: `openssl rand -base64 32`. */
const encryptionKey = z.string().refine((v) => {
  try {
    return Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'Must be 32 random bytes, base64-encoded (openssl rand -base64 32)');

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'Must be a PostgreSQL URL (postgresql://user:pass@host:5432/db)');

/** Database providers. Each one has its own URL variable; DB_PROVIDER picks which is used. */
export const DB_PROVIDER_URL_VARS = {
  neon: 'NEON_DATABASE_URL',
  mydb: 'MYDB_DATABASE_URL',
  local: 'LOCAL_DATABASE_URL',
} as const;
export type DbProvider = keyof typeof DB_PROVIDER_URL_VARS;

/**
 * The single place that decides which database URL is in force. Used by the API at boot, by the Prisma CLI
 * (migrations) and by the seed scripts, so they can never disagree.
 * - DB_PROVIDER set  -> its own URL variable (NEON_/MYDB_/LOCAL_DATABASE_URL) is required and used.
 * - DB_PROVIDER blank -> plain DATABASE_URL (the original behaviour).
 * Returns `{ error }` instead of throwing so callers can report it their own way. Never echoes secret values.
 */
export function resolveDatabaseUrl(source: Record<string, string | undefined>): { url: string; provider: string } | { error: string } {
  const name = (source.DB_PROVIDER ?? '').trim();
  if (name === '') {
    const url = (source.DATABASE_URL ?? '').trim();
    return url ? { url, provider: 'url' } : { error: 'Set DB_PROVIDER (neon | mydb | local) with its URL variable, or set DATABASE_URL' };
  }
  if (!(name in DB_PROVIDER_URL_VARS)) return { error: `Unknown DB_PROVIDER "${name}". Use neon, mydb or local` };
  const varName = DB_PROVIDER_URL_VARS[name as DbProvider];
  const url = (source[varName] ?? '').trim();
  return url ? { url, provider: name } : { error: `${varName} is required when DB_PROVIDER=${name}` };
}

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, 1, 65535),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    APP_NAME: z.string().min(1).default('Influencer Platform'),
    APP_VERSION: z.string().default('0.1.0'),

    // Database: DB_PROVIDER picks one of the URLs below (see resolveDatabaseUrl). Blank = use DATABASE_URL.
    DB_PROVIDER: provider(['neon', 'mydb', 'local']),
    DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    NEON_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    MYDB_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    LOCAL_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    APP_ENCRYPTION_KEY: encryptionKey,

    // HTTP / browser clients
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z.string().refine((o) => {
            try {
              const u = new URL(o);
              return u.origin === o; // origin only: no path, no trailing slash
            } catch {
              return false;
            }
          }, 'Each origin must look like https://app.example.com (no path or trailing slash)'),
        ),
      ),
    UI_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    TRUST_PROXY_HOPS: int(0, 0, 10),
    API_DOCS_ENABLED: bool(false),

    // Sessions
    SESSION_COOKIE_NAME: z.string().min(1).default('sid'),
    SESSION_IDLE_MINUTES: int(720, 5),
    SESSION_ABSOLUTE_HOURS: int(336, 1),
    COOKIE_SECURE: z.string().optional(), // derived from NODE_ENV when unset
    LOGIN_MAX_FAILURES: int(5, 1, 100),
    LOGIN_LOCK_MINUTES: int(15, 1, 1440),

    // Rate limiting (in-memory store: one API process per client)
    RATE_LIMIT_ENABLED: bool(true),
    RATE_LIMIT_GLOBAL_PER_MIN: int(300, 1),
    RATE_LIMIT_AUTH_PER_MIN: int(10, 1),
    /** Per-IP limit for anonymous write endpoints (checkout, inquiries, bookings, RSVPs). */
    RATE_LIMIT_PUBLIC_PER_MIN: int(20, 1),

    // Optional capabilities: blank = OFF, enforced server-side
    JOBS_ENABLED: bool(true),
    AUDIT_LOG_ENABLED: bool(true),
    STORAGE_PROVIDER: provider(['cloudinary', 's3', 'local']),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    // cloudinary
    CLOUDINARY_CLOUD_NAME: optionalText,
    CLOUDINARY_API_KEY: optionalText,
    CLOUDINARY_API_SECRET: optionalText,
    CLOUDINARY_FOLDER: optionalText,
    // s3 (AWS, or any S3-compatible service such as R2, Wasabi, MinIO via S3_ENDPOINT)
    S3_BUCKET: optionalText,
    S3_REGION: optionalText,
    S3_ACCESS_KEY_ID: optionalText,
    S3_SECRET_ACCESS_KEY: optionalText,
    S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
    S3_FORCE_PATH_STYLE: bool(false),
    EMAIL_PROVIDER: provider(['console', 'smtp']),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
    // smtp
    SMTP_HOST: optionalText,
    SMTP_PORT: int(587, 1, 65535),
    SMTP_SECURE: bool(false), // true = implicit TLS (port 465); false = STARTTLS upgrade when offered (port 587)
    SMTP_USER: optionalText,
    SMTP_PASS: optionalText,
    AI_PROVIDER: provider([] as unknown as readonly [string, ...string[]]).pipe(z.literal('')),
    PAYMENT_PROVIDER: provider([] as unknown as readonly [string, ...string[]]).pipe(z.literal('')),

    // First Super Admin (used by `npm run seed`)
    SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  })
  .superRefine((env, ctx) => {
    // A selected provider makes its credentials required; a blank provider ignores them.
    const need = (names: readonly (keyof typeof env)[], why: string) => {
      for (const n of names) if (env[n] === undefined) ctx.addIssue({ code: 'custom', path: [n], message: `Required when ${why}` });
    };
    if (env.STORAGE_PROVIDER === 'cloudinary') need(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'STORAGE_PROVIDER=cloudinary');
    if (env.STORAGE_PROVIDER === 's3') need(['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'], 'STORAGE_PROVIDER=s3');
    if (env.EMAIL_PROVIDER === 'smtp') {
      need(['SMTP_HOST'], 'EMAIL_PROVIDER=smtp');
      if ((env.SMTP_USER === undefined) !== (env.SMTP_PASS === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_PASS'], message: 'SMTP_USER and SMTP_PASS must be set together (or both left blank for an open relay)' });
      }
    }
    if (env.EMAIL_PROVIDER && !env.EMAIL_FROM) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'Required when EMAIL_PROVIDER is set' });
    }
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE?.toLowerCase() === 'false') {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Must not be false in production' });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'The console provider prints message bodies (including links); not allowed in production' });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use https origins in production' });
    }
  });

/** `DATABASE_URL` on the loaded env is always the RESOLVED url (whichever DB_PROVIDER selected). */
export type ApiEnv = Omit<z.infer<typeof apiEnvSchema>, 'DATABASE_URL'> & { DATABASE_URL: string; DB_PROVIDER_RESOLVED: string; COOKIE_SECURE_RESOLVED: boolean };

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validates once at boot. Throws EnvValidationError so the process refuses to start. */
export function loadApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);
  const db = resolveDatabaseUrl(source);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  // An unknown DB_PROVIDER is already reported by the schema; avoid saying it twice.
  if ('error' in db && !issues.some((i) => i.startsWith('DB_PROVIDER'))) issues.push(`DB_PROVIDER: ${db.error}`);
  if (!parsed.success || 'error' in db) throw new EnvValidationError(issues);
  const env = parsed.data;
  const secure = env.COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : env.COOKIE_SECURE.toLowerCase() === 'true';
  return {
    ...env,
    DATABASE_URL: db.url,
    DB_PROVIDER_RESOLVED: db.provider,
    API_DOCS_ENABLED: source.API_DOCS_ENABLED === undefined ? env.NODE_ENV !== 'production' : env.API_DOCS_ENABLED,
    COOKIE_SECURE_RESOLVED: secure,
  };
}
