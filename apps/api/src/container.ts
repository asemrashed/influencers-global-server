import type { ApiEnv } from '@platform/config';
import { createPrisma, type Db } from './db.js';
import { createJobService, type JobService } from './jobs/jobs.js';
import { createLogger, type Logger } from './lib/logger.js';
import { AuditService } from './modules/audit/audit.service.js';
import { ModuleService } from './modules/settings/modules.service.js';
import { createProviders, type Providers } from './providers/index.js';

/** Everything a route or service may depend on. Built once at boot; tests build their own. */
export interface Container {
  env: ApiEnv;
  logger: Logger;
  db: Db;
  audit: AuditService;
  providers: Providers;
  jobs: JobService;
  modules: ModuleService;
}

export function buildContainer(env: ApiEnv, overrides: Partial<Pick<Container, 'logger' | 'db'>> & { jobsSchema?: string; providers?: Partial<Providers> } = {}): Container {
  const logger = overrides.logger ?? createLogger(env);
  const db = overrides.db ?? createPrisma(env.DATABASE_URL);
  const providers = { ...createProviders(env, logger), ...overrides.providers };
  return {
    env,
    logger,
    db,
    audit: new AuditService(env.AUDIT_LOG_ENABLED, logger),
    providers,
    jobs: createJobService(env, { db, logger, providers }, overrides.jobsSchema ? { schema: overrides.jobsSchema } : {}),
    modules: new ModuleService(db),
  };
}
