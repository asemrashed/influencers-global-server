import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeFactory } from '../src/lib/route.js';
import { errorHandler } from '../src/middleware/common.js';
import { Client, createTestApp, createUser, PASSWORD, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('transport hardening', () => {
  it('sets security headers, hides the stack, and forbids caching', async () => {
    const res = await request(t.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', version: '0.1.0' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('echoes a safe X-Request-Id and replaces unsafe ones', async () => {
    expect((await request(t.app).get('/health').set('X-Request-Id', 'trace-1234567890')).headers['x-request-id']).toBe('trace-1234567890');
    const replaced = await request(t.app).get('/health').set('X-Request-Id', 'bad id\twith<script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns JSON errors with a request id for unknown routes, bad JSON and oversized bodies', async () => {
    const nf = await request(t.app).get('/api/v1/nope');
    expect(nf.status).toBe(404);
    expect(nf.body).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
    const bad = await request(t.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const big = await request(t.app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(1_200_000) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('serves no docs when disabled', async () => {
    expect((await request(t.app).get('/docs/')).status).toBe(404);
    expect((await request(t.app).get('/openapi.json')).status).toBe(404);
  });
});

describe('no data leakage', () => {
  it('never returns password hashes, token hashes, 2FA secrets or lockout counters', async () => {
    const { client } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const id = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
    const bodies = [
      (await client.get('/api/v1/users')).text,
      (await client.get(`/api/v1/users/${id}`)).text,
      (await client.get('/api/v1/me')).text,
      (await client.get('/api/v1/roles')).text,
      (await client.get('/api/v1/audit-logs')).text,
    ];
    for (const b of bodies) expect(b).not.toMatch(/passwordHash|tokenHash|twoFactorSecret|twoFactorPendingSecret|recoveryCodeHashes|failedLoginCount|lockedUntil|argon2/i);
  });

  it('response schemas strip fields a handler forgot to map (raw ORM rows cannot leak)', async () => {
    const probe = express.Router();
    routeFactory({ c: t.c, registry: [], authLimiter: (_q, _s, n) => n(), publicLimiter: (_q, _s, n) => n() }, probe)(
      { method: 'get', path: '/leaky', operationId: 'leaky', summary: 's', tags: ['t'], access: { type: 'public', reason: 'test' }, response: { status: 200, schema: z.object({ id: z.string() }) } },
      async () => ({ id: '1', passwordHash: '$argon2id$secret', tokenHash: 'abc' }) as { id: string },
    );
    const res = await request(express().use(probe)).get('/leaky');
    expect(res.body).toEqual({ id: '1' });
  });

  it('turns unexpected errors into a generic 500 without leaking internals', async () => {
    const probe = express.Router();
    routeFactory({ c: t.c, registry: [], authLimiter: (_q, _s, n) => n(), publicLimiter: (_q, _s, n) => n() }, probe)(
      { method: 'get', path: '/boom', operationId: 'boom', summary: 's', tags: ['t'], access: { type: 'public', reason: 'test' }, response: { status: 204 } },
      async () => { throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db:5432'); },
    );
    const app = express().use((req, _r, n) => { req.requestId = 'rid-12345678'; n(); }).use(probe).use(errorHandler(t.c));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL', message: 'Something went wrong', requestId: 'rid-12345678' });
    expect(res.text).not.toMatch(/hunter2|postgres/);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per IP and answers with the standard error shape', async () => {
    const limited = await createTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_PER_MIN: '3' });
    await createUser(limited.c, { email: 'm@example.test' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await new Client(limited.app).login('m@example.test', i < 4 ? 'wrong-password-123' : PASSWORD)).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const res = await new Client(limited.app).login('m@example.test');
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(res.headers['ratelimit']).toBeDefined();
    await limited.close();
    // restore this file's app state for later tests
    t = await createTestApp();
  });

  it('applies a global ceiling to the whole API', async () => {
    const limited = await createTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_GLOBAL_PER_MIN: '4' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(limited.app).get('/api/v1/me')).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
    expect((await request(limited.app).get('/health')).status).toBe(200); // probes are not throttled
    await limited.close();
    t = await createTestApp();
  });
});

describe('interactive docs', () => {
  it('are served with their own CSP only when enabled', async () => {
    const docs = await createTestApp({ API_DOCS_ENABLED: 'true' });
    const page = await request(docs.app).get('/docs/');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
    const spec = await request(docs.app).get('/openapi.json');
    expect(spec.body.openapi).toBe('3.1.0');
    expect((await request(docs.app).get('/api/v1/me')).headers['content-security-policy']).toContain("default-src 'none'"); // API stays strict
    await docs.close();
    t = await createTestApp();
  });
});
