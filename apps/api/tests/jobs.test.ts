import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupJob, emailSendJob } from '../src/jobs/jobs.js';
import { sendEmail } from '../src/lib/mailer.js';
import { createTestApp, createUser, type TestApp } from './helpers.js';

const SCHEMA = 'pgboss_test';
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ JOBS_ENABLED: 'true', EMAIL_PROVIDER: 'console', EMAIL_FROM: 'no-reply@example.test' }, { jobsSchema: SCHEMA });
  await t.c.jobs.start();
});
afterAll(async () => {
  await t.close();
});

const jobCount = async (name: string) =>
  Number((await t.c.db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${SCHEMA}.job WHERE name = $1`, name))[0]!.n);

describe('job queue', () => {
  it('starts, and /ready reports it', async () => {
    expect(t.c.jobs.isUp()).toBe(true);
    const { default: request } = await import('supertest');
    expect((await request(t.app).get('/ready')).body).toEqual({ status: 'ready', checks: { database: true, jobs: 'up' } });
  });

  it('collapses duplicate enqueues that share a dedupe key into one job', async () => {
    const msg = { to: 'a@example.test', subject: 'Hi', text: 'Hello' };
    const first = await t.c.jobs.enqueue(emailSendJob, msg, { dedupeKey: 'welcome:a' });
    const second = await t.c.jobs.enqueue(emailSendJob, msg, { dedupeKey: 'welcome:a' });
    const other = await t.c.jobs.enqueue(emailSendJob, msg, { dedupeKey: 'welcome:b' });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(other).toBeTruthy();
    expect(await jobCount('email.send')).toBe(2);
  });

  it('validates payloads before they enter the queue', async () => {
    await expect(t.c.jobs.enqueue(emailSendJob, { to: 'not-an-email', subject: 's', text: 't' })).rejects.toThrow();
  });

  it('delivers email through the queue when jobs are on', async () => {
    await expect(sendEmail(t.c, { to: 'b@example.test', subject: 'Queued', text: 'x' }, 'queued:1')).resolves.toBeUndefined();
    expect(await jobCount('email.send')).toBe(3);
  });

  it('cleanup removes expired sessions and spent tokens and is safe to run twice', async () => {
    const u = await createUser(t.c, { email: 'old@example.test' });
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    await t.c.db.session.createMany({
      data: [
        { userId: u.id, tokenHash: 'expired', csrfToken: 'c', idleExpiresAt: past, expiresAt: future },
        { userId: u.id, tokenHash: 'idle-ok', csrfToken: 'c', idleExpiresAt: future, expiresAt: future },
      ],
    });
    const deps = { db: t.c.db, logger: t.c.logger, providers: t.c.providers };
    await cleanupJob.handler(deps, {});
    await cleanupJob.handler(deps, {});
    expect((await t.c.db.session.findMany()).map((s) => s.tokenHash)).toEqual(['idle-ok']);
  });
});

describe('jobs disabled', () => {
  it('degrades gracefully: enqueue is a no-op and email is sent inline', async () => {
    const off = await createTestApp({ JOBS_ENABLED: 'false', EMAIL_PROVIDER: 'console', EMAIL_FROM: 'no-reply@example.test' });
    expect(await off.c.jobs.enqueue(emailSendJob, { to: 'a@example.test', subject: 's', text: 't' })).toBeNull();
    await expect(sendEmail(off.c, { to: 'a@example.test', subject: 's', text: 't' })).resolves.toBeUndefined();
    const { default: request } = await import('supertest');
    expect((await request(off.app).get('/ready')).body.checks.jobs).toBe('disabled');
    await off.close();
  });

  it('email off: sending is rejected, never faked as sent', async () => {
    const off = await createTestApp();
    await expect(sendEmail(off.c, { to: 'a@example.test', subject: 's', text: 't' })).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED', status: 503 });
    await off.close();
  });
});
