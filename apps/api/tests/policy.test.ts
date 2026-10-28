import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, createUser, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); }, 90_000);
afterAll(async () => { if (t) await t.close(); });

const concrete = (p: string) => p.replace(/\{(\w+)\}/g, (_m, name: string) => (name === 'key' ? 'inbox' : 'x'));
const expressPath = (p: string) => p.replace(/\{(\w+)\}/g, ':$1');

/** Every route that Express actually serves, found by walking the live router stack. */
function liveRoutes(): string[] {
  const out: string[] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) out.push(`${m} ${layer.route.path}`);
      else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((t.app as any).router.stack);
  return out.sort();
}

describe('every route has an explicit access policy', () => {
  it('registers routes with unique method+path and a declared policy', () => {
    expect(t.routes.length).toBeGreaterThan(25);
    const keys = t.routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of t.routes) expect(['public', 'pending-2fa', 'authenticated', 'permission']).toContain(r.access.type);
  });

  it('serves exactly the registered routes: nothing is mounted outside the policy-checked factory', () => {
    const registered = t.routes.map((r) => `${r.method} ${expressPath(r.path)}`).sort();
    expect(liveRoutes()).toEqual(registered);
  });

  it('only the intended entry points are public', () => {
    const publics = t.routes.filter((r) => r.access.type === 'public').map((r) => `${r.method} ${r.path}`).sort();
    expect(publics).toEqual([
      'get /api/v1/public/events/{slug}',
      'get /api/v1/public/meetings/slots',
      'get /api/v1/public/portfolio/albums',
      'get /api/v1/public/portfolio/albums/{slug}',
      'get /api/v1/public/profile',
      'get /api/v1/store/categories',
      'get /api/v1/store/products',
      'get /health',
      'get /ready',
      'post /api/v1/auth/invitations/accept',
      'post /api/v1/auth/login',
      'post /api/v1/auth/password/forgot',
      'post /api/v1/auth/password/reset',
      'post /api/v1/public/events/{slug}/rsvp',
      'post /api/v1/public/inquiries',
      'post /api/v1/public/meetings/book',
      'post /api/v1/store/checkout',
    ]);
  });

  it('every non-public route answers 401 with no session', async () => {
    for (const r of t.routes.filter((x) => x.access.type !== 'public')) {
      const res = await (request(t.app) as any)[r.method](concrete(r.path)).send({});
      expect([`${r.method} ${r.path}`, res.status, res.body.code]).toEqual([`${r.method} ${r.path}`, 401, 'UNAUTHENTICATED']);
    }
  });

  it('every permission route answers 403 to a signed-in user without that permission', async () => {
    // Create custom role with no permissions so every permission route responds 403
    const emptyRole = await t.c.db.role.create({
      data: { name: 'EmptyRole', isSystem: false },
    });
    await createUser(t.c, { email: 'empty@example.test', roleKey: undefined, roleId: emptyRole.id });
    const c = new Client(t.app);
    await c.login('empty@example.test');
    for (const r of t.routes.filter((x) => x.access.type === 'permission')) {
      const res = await (c as any)[r.method](concrete(r.path), {});
      expect([`${r.method} ${r.path}`, res.status, res.body.code]).toEqual([`${r.method} ${r.path}`, 403, 'FORBIDDEN']);
    }
  }, 60_000);

  it('every state-changing authenticated route requires the CSRF token', async () => {
    const c = new Client(t.app);
    await c.login('empty@example.test');
    c.csrf = '';
    for (const r of t.routes.filter((x) => x.csrf)) {
      const res = await (c as any)[r.method](concrete(r.path), {});
      expect([`${r.method} ${r.path}`, res.status, res.body.code]).toEqual([`${r.method} ${r.path}`, 403, 'CSRF_INVALID']);
    }
  }, 60_000);
});
