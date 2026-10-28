import PgBoss from 'pg-boss';
import { z } from 'zod';
import type { ApiEnv } from '@platform/config';
import type { Db } from '../db.js';
import type { Logger } from '../lib/logger.js';
import type { Providers } from '../providers/index.js';

/**
 * Background jobs (pg-boss, on the same PostgreSQL database).
 *
 * IDEMPOTENT HANDLER PATTERN
 * pg-boss delivers at least once, so every handler must be safe to run twice:
 *   1. enqueue with a `dedupeKey` so double submits collapse into one job;
 *   2. make the handler's effect naturally idempotent (delete-where, upsert, "only if still pending");
 *   3. validate the payload with a Zod schema, and never put secrets in it beyond what the job strictly needs.
 */

export interface JobDeps {
  db: Db;
  logger: Logger;
  providers: Providers;
}

export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  schema: S;
  retryLimit?: number;
  handler: (deps: JobDeps, data: z.output<S>) => Promise<void>;
}

export const defineJob = <S extends z.ZodType>(def: JobDefinition<S>): JobDefinition<S> => def;

export const emailSendJob = defineJob({
  name: 'email.send',
  schema: z.object({ to: z.email(), subject: z.string().max(300), text: z.string().max(20000), html: z.string().max(100000).optional() }),
  retryLimit: 5,
  async handler({ providers }, data) {
    if (!providers.email) return; // capability off: nothing to send, do not retry forever
    await providers.email.send(data);
  },
});

/** Deletes expired sessions and spent/expired one-time tokens. Naturally idempotent. */
export const cleanupJob = defineJob({
  name: 'maintenance.cleanup',
  schema: z.object({}).default({}),
  async handler({ db, logger }) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const [sessions, resets] = await Promise.all([
      db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { idleExpiresAt: { lt: now } }] } }),
      db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { usedAt: { lt: weekAgo } }] } }),
    ]);
    logger.info({ sessions: sessions.count, resetTokens: resets.count }, 'cleanup finished');
  },
});

export const JOBS = [emailSendJob, cleanupJob] as const;

export interface EnqueueOptions {
  /** Same key within the dedupe window = one job. */
  dedupeKey?: string;
  startAfterSeconds?: number;
}

export interface JobService {
  readonly enabled: boolean;
  isUp(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Returns the job id, or null when jobs are disabled or the job was deduplicated. */
  enqueue<S extends z.ZodType>(job: JobDefinition<S>, data: z.input<S>, options?: EnqueueOptions): Promise<string | null>;
}

export function createJobService(env: ApiEnv, deps: JobDeps, opts: { schema?: string } = {}): JobService {
  if (!env.JOBS_ENABLED) {
    return {
      enabled: false,
      isUp: () => false,
      async start() {},
      async stop() {},
      async enqueue() {
        return null;
      },
    };
  }

  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: opts.schema ?? 'pgboss' });
  let up = false;
  boss.on('error', (err) => deps.logger.error({ err }, 'pg-boss error'));

  return {
    enabled: true,
    isUp: () => up,
    async start() {
      await boss.start();
      for (const job of JOBS) {
        await boss.createQueue(job.name);
        await boss.work(job.name, async (batch) => {
          for (const item of batch) {
            const parsed = job.schema.safeParse(item.data ?? {});
            if (!parsed.success) {
              deps.logger.error({ job: job.name, jobId: item.id }, 'job payload failed validation; dropping');
              continue; // retrying cannot fix a bad payload
            }
            await job.handler(deps, parsed.data as never);
          }
        });
      }
      await boss.schedule(cleanupJob.name, '0 3 * * *', {});
      up = true;
    },
    async stop() {
      up = false;
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
    async enqueue(job, data, options = {}) {
      if (!up) return null;
      const payload = job.schema.parse(data);
      return boss.send(job.name, payload as object, {
        retryLimit: job.retryLimit ?? 3,
        retryBackoff: true,
        ...(options.dedupeKey ? { singletonKey: options.dedupeKey, singletonSeconds: 600 } : {}),
        ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      });
    },
  };
}
