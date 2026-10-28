import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiClient } from '@platform/api-client';
import { createUser, createTestApp, PASSWORD, type TestApp } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let t: TestApp;
beforeAll(async () => { t = await createTestApp(); }, 180_000);
afterAll(async () => { if (t) await t.close(); });

describe('OpenAPI contract', () => {
  it('documents every route, with its access policy and error codes', () => {
    const spec = t.openapi() as any;
    const documented = Object.entries(spec.paths).flatMap(([p, ops]: [string, any]) => Object.keys(ops).map((m) => `${m} ${p}`)).sort();
    expect(documented).toEqual(t.routes.map((r) => `${r.method} ${r.path}`).sort());
    for (const ops of Object.values<any>(spec.paths)) {
      for (const op of Object.values<any>(ops)) {
        expect(op['x-access']).toBeDefined();
        expect(op.operationId).toMatch(/^[a-z][A-Za-z0-9]+$/);
        expect(op.responses['500']).toBeDefined();
      }
    }
    expect(spec.paths['/api/v1/auth/login'].post.security).toEqual([]);
    expect(spec.paths['/api/v1/users'].get.security).toEqual([{ cookieAuth: [] }]);
    expect(spec.paths['/api/v1/roles'].post.security).toEqual([{ cookieAuth: [], csrfHeader: [] }]);
    expect(spec.paths['/api/v1/users'].get['x-access']).toEqual({ type: 'permission', permission: 'users.read' });
  });

  it('exposes no secret-bearing field names', () => {
    const text = JSON.stringify(t.openapi());
    expect(text).not.toMatch(/passwordHash|tokenHash|twoFactorSecretEnc|twoFactorPendingSecretEnc|recoveryCodeHashes|APP_ENCRYPTION_KEY|DATABASE_URL/);
  });

  it('the committed openapi.json is up to date (run `npm run client:generate` if this fails)', () => {
    const committed = JSON.parse(readFileSync(path.join(here, '../openapi.json'), 'utf8'));
    expect(t.openapi()).toEqual(committed);
  });
});

describe('generated api-client against the real API', () => {
  it('signs in, attaches the CSRF header by itself, and returns typed data', async () => {
    await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
    const server = t.app.listen(0);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Node's fetch has no cookie jar; browsers do (credentials: 'include'). Emulate one.
    let cookie = '';
    const jarFetch: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      if (cookie) req.headers.set('cookie', cookie);
      const res = await fetch(req);
      const set = res.headers.getSetCookie?.()[0];
      if (set) cookie = set.split(';')[0]!;
      return res;
    };
    const api = createApiClient({ baseUrl, fetch: jarFetch });

    const login = await api.POST('/api/v1/auth/login', { body: { email: 'mgr@example.test', password: PASSWORD } });
    expect(login.data?.status).toBe('authenticated');

    const me = await api.GET('/api/v1/me');
    expect(me.data?.user.email).toBe('mgr@example.test');

    const renamed = await api.PATCH('/api/v1/me', { body: { name: 'Typed Name' } }); // would be 403 CSRF_INVALID without the auto header
    expect(renamed.response.status).toBe(200);
    expect(renamed.data?.user.name).toBe('Typed Name');

    const denied = await api.GET('/api/v1/users');
    expect(denied.response.status).toBe(403);
    expect(denied.error?.code).toBe('FORBIDDEN');

    const bad = await api.POST('/api/v1/auth/login', { body: { email: 'nope', password: 'x' } });
    expect(bad.error?.code).toBe('VALIDATION_FAILED');
    expect(bad.error?.details?.[0]?.path).toBe('body.email');
    void authenticator;
    server.close();
  });
});
