import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { routeFactory } from '../src/lib/route.js';
import { Client, createTestApp, createUser, PASSWORD, resetDb, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); }, 180_000);
afterAll(async () => { if (t) await t.close(); });
beforeEach(async () => { await resetDb(t.c.db); await bootstrap(t.c); }, 60_000);

const roleId = async (key: string) => (await t.c.db.role.findUniqueOrThrow({ where: { key } })).id;

/** Super Admin invites someone, they accept, and the returned client is signed in. */
async function inviteAndAccept(owner: Client, email: string, roleIds: string[]): Promise<Client> {
  const inv = await owner.post('/api/v1/invitations', { email, roleIds });
  expect(inv.status).toBe(201);
  const c = new Client(t.app);
  const accepted = await c.post('/api/v1/auth/invitations/accept', { token: inv.body.issued.token, name: email.split('@')[0], password: PASSWORD });
  expect(accepted.status).toBe(201);
  c.csrf = accepted.body.csrfToken;
  return c;
}

describe('Phase 1 exit criterion: custom role limits a Manager', () => {
  it('Super Admin signs in, creates a role, assigns permissions, and the Manager is limited by it', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');

    // 1. custom role
    const created = await owner.post('/api/v1/roles', {
      name: 'Support Lead',
      description: 'Can look people up',
      permissions: [{ permission: 'users.read', scope: 'all' }, { permission: 'roles.read', scope: 'all' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.permissions).toHaveLength(2);
    const supportLead = created.body.id as string;

    // 2. invite a Manager (the default role grants business permissions only, none of the access-control ones)
    const manager = await inviteAndAccept(owner, 'manager@example.test', [await roleId('manager')]);
    const held = (await manager.get('/api/v1/me')).body.permissions.map((p: { permission: string }) => p.permission);
    expect(held.filter((p: string) => /^(users|roles|audit|settings)\./.test(p))).toEqual([]);
    for (const path of ['/api/v1/users', '/api/v1/roles', '/api/v1/audit-logs', '/api/v1/settings', '/api/v1/invitations']) {
      const r = await manager.get(path);
      expect([path, r.status, r.body.code]).toEqual([path, 403, 'FORBIDDEN']);
    }

    // 3. grant the custom role: effective on the Manager's very next request, no re-login
    const managerId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'manager@example.test' } })).id;
    expect((await owner.put(`/api/v1/users/${managerId}/roles`, { roleIds: [await roleId('manager'), supportLead] })).status).toBe(200);
    expect((await manager.get('/api/v1/users')).status).toBe(200);
    expect((await manager.get('/api/v1/roles')).status).toBe(200);
    expect((await manager.get('/api/v1/audit-logs')).status).toBe(403); // still not granted
    expect((await manager.patch(`/api/v1/users/${managerId}`, { name: 'Hacked' })).status).toBe(403); // read ≠ write

    // 4. take a permission away: effective immediately too
    expect((await owner.put(`/api/v1/roles/${supportLead}/permissions`, { permissions: [{ permission: 'roles.read', scope: 'all' }] })).status).toBe(200);
    expect((await manager.get('/api/v1/users')).status).toBe(403);
    expect((await manager.get('/api/v1/roles')).status).toBe(200);

    // 5. everything above was audited
    const audit = await owner.get('/api/v1/audit-logs?limit=100');
    const actions = (audit.body.items as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['roles.created', 'users.roles.changed', 'roles.permissions.changed', 'auth.invitation.created', 'auth.invitation.accepted']));
  });

  it('keeps secrets out of the audit log', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    await inviteAndAccept(owner, 'manager@example.test', [await roleId('manager')]);
    const rows = await t.c.db.auditLog.findMany();
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(new RegExp(PASSWORD.replace(/[-]/g, '\\-')));
    expect(blob).not.toMatch(/passwordHash|tokenHash|"token"|twoFactorSecret/i);
  });
});

describe('privilege escalation', () => {
  it('nobody can grant permissions they do not hold', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const editor = (await owner.post('/api/v1/roles', {
      name: 'Role Editor',
      permissions: [{ permission: 'roles.manage', scope: 'all' }, { permission: 'roles.read', scope: 'all' }, { permission: 'users.read', scope: 'all' }, { permission: 'users.write', scope: 'all' }],
    })).body.id as string;
    const bob = await inviteAndAccept(owner, 'bob@example.test', [editor]);

    const tooMuch = await bob.post('/api/v1/roles', { name: 'Sneaky', permissions: [{ permission: 'audit.read', scope: 'all' }] });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.code).toBe('PERMISSION_ESCALATION');
    expect((await bob.post('/api/v1/roles', { name: 'Fine', permissions: [{ permission: 'users.read', scope: 'all' }] })).status).toBe(201);

    // widening a scope counts as granting
    const narrow = await inviteAndAccept(owner, 'narrow@example.test', [
      (await owner.post('/api/v1/roles', { name: 'Own Only', permissions: [{ permission: 'roles.manage', scope: 'all' }, { permission: 'users.read', scope: 'own' }] })).body.id,
    ]);
    expect((await narrow.post('/api/v1/roles', { name: 'Wider', permissions: [{ permission: 'users.read', scope: 'all' }] })).body.code).toBe('PERMISSION_ESCALATION');

    // assigning an existing powerful role is the same thing
    const adminRole = await roleId('admin');
    const bobId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'bob@example.test' } })).id;
    const self = await bob.put(`/api/v1/users/${bobId}/roles`, { roleIds: [adminRole] });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('PERMISSION_ESCALATION');
    const saRole = await roleId('super_admin');
    expect((await bob.put(`/api/v1/users/${bobId}/roles`, { roleIds: [saRole] })).body.code).toBe('PERMISSION_ESCALATION');
    expect((await owner.post('/api/v1/roles', { name: 'x', permissions: [{ permission: 'nope.nope', scope: 'all' }] })).status).toBe(400);
  });

  it('an Admin cannot invite, edit, disable or reset a Super Admin, nor assign the Super Admin role', async () => {
    await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const { client: admin } = await signInWithTwoFactor(t, 'admin@example.test', 'admin');
    const ownerId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
    const saRole = await roleId('super_admin');

    expect((await admin.get(`/api/v1/users/${ownerId}`)).status).toBe(200); // Admins may see users
    expect((await admin.patch(`/api/v1/users/${ownerId}`, { name: 'Pwned' })).status).toBe(403);
    expect((await admin.post(`/api/v1/users/${ownerId}/revoke`)).status).toBe(403);
    expect((await admin.post(`/api/v1/users/${ownerId}/password-reset`)).status).toBe(403);
    expect((await admin.post(`/api/v1/users/${ownerId}/two-factor/reset`)).status).toBe(403);
    expect((await admin.put(`/api/v1/users/${ownerId}/roles`, { roleIds: [await roleId('manager')] })).status).toBe(403);
    expect((await admin.post('/api/v1/invitations', { email: 'evil@example.test', roleIds: [saRole] })).body.code).toBe('PERMISSION_ESCALATION');
    // Admin does not hold roles.manage, settings.write or audit.read by default
    expect((await admin.post('/api/v1/roles', { name: 'x' })).status).toBe(403);
    expect((await admin.put('/api/v1/settings', { 'site.name': 'x' })).status).toBe(403);
    expect((await admin.get('/api/v1/audit-logs')).status).toBe(403);
    expect((await admin.get('/api/v1/settings')).status).toBe(200);
    expect((await t.c.db.user.findUniqueOrThrow({ where: { id: ownerId } })).name).not.toBe('Pwned');
  });
});

describe('Super Admin protection', () => {
  it('the locked role and system roles cannot be changed or deleted', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const sa = await roleId('super_admin');
    for (const res of [
      await owner.patch(`/api/v1/roles/${sa}`, { name: 'Renamed' }),
      await owner.put(`/api/v1/roles/${sa}/permissions`, { permissions: [] }),
      await owner.delete(`/api/v1/roles/${sa}`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LOCKED_ROLE');
    }
    expect((await owner.delete(`/api/v1/roles/${await roleId('admin')}`)).body.code).toBe('CONFLICT');
    const detail = await owner.get(`/api/v1/roles/${sa}`);
    expect(detail.body.permissions.length).toBeGreaterThan(8); // really holds everything
  });

  it('the last active Super Admin cannot be disabled or demoted', async () => {
    const { client: a } = await signInWithTwoFactor(t, 'a@example.test', 'super_admin');
    const aId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'a@example.test' } })).id;
    expect((await a.post(`/api/v1/users/${aId}/revoke`)).status).toBe(409); // cannot revoke yourself

    const { client: b } = await signInWithTwoFactor(t, 'b@example.test', 'super_admin');
    const bId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'b@example.test' } })).id;
    expect((await a.post(`/api/v1/users/${bId}/revoke`)).status).toBe(200); // fine: A remains
    const demote = await a.put(`/api/v1/users/${aId}/roles`, { roleIds: [await roleId('admin')] });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('LAST_SUPER_ADMIN');
    void b;
  });

  it('two Super Admins demoting each other at the same instant cannot leave zero', async () => {
    const { client: a } = await signInWithTwoFactor(t, 'a@example.test', 'super_admin');
    const { client: b } = await signInWithTwoFactor(t, 'b@example.test', 'super_admin');
    const aId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'a@example.test' } })).id;
    const bId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'b@example.test' } })).id;
    const admin = await roleId('admin');
    const [r1, r2] = await Promise.all([
      a.put(`/api/v1/users/${bId}/roles`, { roleIds: [admin] }),
      b.put(`/api/v1/users/${aId}/roles`, { roleIds: [admin] }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await t.c.db.user.count({ where: { status: 'ACTIVE', roles: { some: { role: { isLocked: true } } } } })).toBe(1);
  });
});

describe('revocation, scope and IDOR', () => {
  it('revoking a user ends their sessions immediately and blocks sign-in until reactivated', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const mgr = await inviteAndAccept(owner, 'm@example.test', [await roleId('manager')]);
    const mId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'm@example.test' } })).id;
    expect((await mgr.get('/api/v1/me')).status).toBe(200);
    expect((await owner.post(`/api/v1/users/${mId}/revoke`)).status).toBe(200);
    expect((await mgr.get('/api/v1/me')).status).toBe(401);
    expect((await new Client(t.app).login('m@example.test')).status).toBe(401);
    expect((await owner.post(`/api/v1/users/${mId}/reactivate`)).status).toBe(200);
    expect((await new Client(t.app).login('m@example.test')).status).toBe(200);
  });

  it('scope "own" limits users.invite to the caller\'s own invitations, and hides others as 404', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const inviter = (await owner.post('/api/v1/roles', { name: 'Inviter', permissions: [{ permission: 'users.invite', scope: 'own' }] })).body.id as string;
    const i1 = await inviteAndAccept(owner, 'i1@example.test', [inviter]);
    const i2 = await inviteAndAccept(owner, 'i2@example.test', [inviter]);

    // an inviter can only hand out roles no stronger than their own, so the invitees get a role with no permissions
    const empty = (await owner.post('/api/v1/roles', { name: 'No Access', permissions: [] })).body.id as string;
    const mine = await i1.post('/api/v1/invitations', { email: 'guest@example.test', roleIds: [empty] });
    expect(mine.status).toBe(201);
    expect((await i1.get('/api/v1/invitations')).body.items.map((i: { email: string }) => i.email)).toEqual(['guest@example.test']);
    expect((await i2.get('/api/v1/invitations')).body.items).toEqual([]);
    expect((await owner.get('/api/v1/invitations')).body.items.length).toBeGreaterThanOrEqual(3);
    const other = await i2.post(`/api/v1/invitations/${mine.body.invitation.id}/revoke`);
    expect(other.status).toBe(404); // not 403: existence is not revealed
    expect((await i1.post('/api/v1/invitations', { email: 'x@example.test', roleIds: [await roleId('admin')] })).body.code).toBe('PERMISSION_ESCALATION');
  });

  it('scope "own" on users.read returns only the caller and 404s on other ids', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const self = (await owner.post('/api/v1/roles', { name: 'Self Reader', permissions: [{ permission: 'users.read', scope: 'own' }] })).body.id as string;
    const me = await inviteAndAccept(owner, 'me@example.test', [self]);
    const ownerId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
    const meId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'me@example.test' } })).id;
    expect((await me.get('/api/v1/users')).body.items.map((u: { id: string }) => u.id)).toEqual([meId]);
    expect((await me.get(`/api/v1/users/${meId}`)).status).toBe(200);
    expect((await me.get(`/api/v1/users/${ownerId}`)).status).toBe(404);
  });

  it('paginates users with a cursor and no duplicates', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    for (let i = 0; i < 6; i++) await createUser(t.c, { email: `u${i}@example.test` });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await owner.get(`/api/v1/users?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((u: { id: string }) => u.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect((await owner.get('/api/v1/users?limit=500')).status).toBe(400);
    expect((await owner.get('/api/v1/users?q=u3')).body.items).toHaveLength(1);
  });

  it('resetting two-factor forces re-enrollment and ends sessions', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const { client: admin } = await signInWithTwoFactor(t, 'admin@example.test', 'admin');
    const adminId = (await t.c.db.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } })).id;
    expect((await owner.post(`/api/v1/users/${adminId}/two-factor/reset`)).status).toBe(204);
    expect((await admin.get('/api/v1/me')).status).toBe(401);
    expect((await new Client(t.app).login('admin@example.test')).body.status).toBe('two_factor_setup_required');
  });
});

describe('settings and module toggles', () => {
  it('validates settings, rejects unknown keys, and audits changes', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    expect((await owner.get('/api/v1/settings')).body).toEqual({ 'site.name': null, 'site.timezone': null, 'site.supportEmail': null });
    expect((await owner.put('/api/v1/settings', { 'site.timezone': 'Mars/Olympus' })).status).toBe(400);
    expect((await owner.put('/api/v1/settings', { 'secret.key': 'x' })).status).toBe(400);
    expect((await owner.put('/api/v1/settings', {})).status).toBe(400);
    const ok = await owner.put('/api/v1/settings', { 'site.name': 'Aisha Official', 'site.timezone': 'Asia/Dhaka', 'site.supportEmail': 'Help@Example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ 'site.name': 'Aisha Official', 'site.timezone': 'Asia/Dhaka', 'site.supportEmail': 'help@example.com' });
    expect(await t.c.db.auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });

  it('a disabled module rejects its routes on the server, and /me reports it', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    // No Phase 1 route belongs to a toggleable module yet, so exercise the guard with a probe route.
    const probe = express.Router();
    routeFactory({ c: t.c, registry: [], authLimiter: (_q, _s, n) => n(), publicLimiter: (_q, _s, n) => n() }, probe)(
      { method: 'get', path: '/probe', operationId: 'probe', summary: 'probe', tags: ['t'], access: { type: 'public', reason: 'test' }, module: 'inbox', response: { status: 204 } },
      async () => undefined,
    );
    const app = express().use(probe).use(((err, _req, res, _next) => res.status(err.status ?? 500).json({ code: err.code })) as express.ErrorRequestHandler);

    expect((await request(app).get('/probe')).status).toBe(204);
    expect((await owner.patch('/api/v1/modules/inbox', { enabled: false })).body).toEqual({ key: 'inbox', enabled: false });
    const blocked = await request(app).get('/probe');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MODULE_DISABLED');
    expect((await owner.get('/api/v1/me')).body.modules.find((m: { key: string }) => m.key === 'inbox').enabled).toBe(false);
    expect((await owner.patch('/api/v1/modules/auth', { enabled: false })).status).toBe(400); // core modules are not toggleable
    await owner.patch('/api/v1/modules/inbox', { enabled: true });
    expect((await request(app).get('/probe')).status).toBe(204);
  });
});
