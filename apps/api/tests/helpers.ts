import type { Express } from 'express';
import { authenticator } from 'otplib';
import request from 'supertest';
import { vi } from 'vitest';
import { loadApiEnv, type ApiEnv } from '@platform/config';
import { createApp } from '../src/app.js';
import { bootstrap } from '../src/bootstrap.js';
import { buildContainer, type Container } from '../src/container.js';
import type { Providers } from '../src/providers/index.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { TEST_DB_URL } from './global-setup.js';

export const PASSWORD = 'Correct-Horse-Battery-9';
export const ORIGIN = 'https://app.example.test';
const KEY = Buffer.alloc(32, 7).toString('base64');

export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    APP_ENCRYPTION_KEY: KEY,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_ENABLED: 'false',
    JOBS_ENABLED: 'false',
    CORS_ORIGINS: ORIGIN,
    API_DOCS_ENABLED: 'false',
    ...overrides,
  });
}

export async function resetDb(db: Container["db"]): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export interface TestApp {
  c: Container;
  app: Express;
  routes: ReturnType<typeof createApp>['routes'];
  openapi: ReturnType<typeof createApp>['openapi'];
  close(): Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}, opts: { jobsSchema?: string; providers?: Partial<Providers> } = {}): Promise<TestApp> {
  const c = buildContainer(testEnv(overrides), { ...(opts.jobsSchema ? { jobsSchema: opts.jobsSchema } : {}), ...(opts.providers ? { providers: opts.providers } : {}) });
  const created = createApp(c);
  await resetDb(c.db);
  await bootstrap(c);
  return { c, ...created, close: async () => { await c.jobs.stop(); await c.db.$disconnect(); } };
}

/** A browser-like client: keeps the cookie jar and adds the CSRF header to state-changing calls. */
export class Client {
  readonly agent;
  csrf = '';
  constructor(readonly app: Express) {
    this.agent = request.agent(app);
  }
  private withCsrf<T extends request.Test>(t: T): T {
    if (this.csrf) t.set('X-CSRF-Token', this.csrf);
    return t;
  }
  get = (path: string) => this.agent.get(path);
  post = (path: string, body?: object) => this.withCsrf(this.agent.post(path)).send(body ?? {});
  put = (path: string, body?: object) => this.withCsrf(this.agent.put(path)).send(body ?? {});
  patch = (path: string, body?: object) => this.withCsrf(this.agent.patch(path)).send(body ?? {});
  delete = (path: string) => this.withCsrf(this.agent.delete(path));

  async login(email: string, password = PASSWORD) {
    const res = await this.agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status === 200) this.csrf = res.body.csrfToken;
    return res;
  }
  async refreshCsrf(): Promise<void> {
    this.csrf = (await this.agent.get('/api/v1/me')).body.session.csrfToken;
  }
}

export async function createUser(c: Container, input: { email: string; roleKey?: string; roleId?: string; name?: string; password?: string }) {
  const role = input.roleId
    ? await c.db.role.findUniqueOrThrow({ where: { id: input.roleId } })
    : await c.db.role.findUniqueOrThrow({ where: { key: input.roleKey ?? 'manager' } });
  return c.db.user.create({
    data: {
      email: input.email, name: input.name ?? input.email.split('@')[0]!, passwordHash: await hashPassword(input.password ?? PASSWORD),
      roles: { create: { roleId: role.id } },
    },
  });
}

/** Jump the clock forward. Both the server and otplib read Date.now(), so TOTP steps advance together. */
export function startClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date() });
}
export function advance(seconds: number): void {
  vi.setSystemTime(Date.now() + seconds * 1000);
}
export const stopClock = (): void => void vi.useRealTimers();

export async function enrollTwoFactor(client: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await client.post('/api/v1/auth/2fa/setup');
  const secret = setup.body.secret as string;
  const enable = await client.post('/api/v1/auth/2fa/enable', { code: authenticator.generate(secret) });
  if (enable.status !== 200) throw new Error(`2FA enable failed: ${enable.status} ${JSON.stringify(enable.body)}`);
  await client.refreshCsrf();
  return { secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}

/** Creates a user holding `roleKey`, signs in and completes two-factor enrollment. */
export async function signInWithTwoFactor(t: TestApp, email: string, roleKey: 'super_admin' | 'admin') {
  await createUser(t.c, { email, roleKey });
  const client = new Client(t.app);
  const login = await client.login(email);
  if (login.body.status !== 'two_factor_setup_required') throw new Error(`unexpected login state ${JSON.stringify(login.body)}`);
  const { secret, recoveryCodes } = await enrollTwoFactor(client);
  return { client, secret, recoveryCodes };
}

export const totp = (secret: string): string => authenticator.generate(secret);
