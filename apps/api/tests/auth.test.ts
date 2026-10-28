import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  advance, Client, createTestApp, createUser, enrollTwoFactor, ORIGIN, PASSWORD, signInWithTwoFactor, startClock, stopClock, totp, type TestApp,
} from './helpers.js';

let t: TestApp;
beforeAll(async () => { t = await createTestApp({ LOGIN_MAX_FAILURES: '3' }); });
afterAll(async () => { await t.close(); });

describe('login', () => {
  beforeEach(async () => {
    await t.c.db.user.deleteMany();
    await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
  });

  it('signs in, sets an httpOnly SameSite=Lax cookie, never stores the raw token', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'MGR@example.test ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'authenticated' });
    expect(res.body.csrfToken).toHaveLength(32);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const raw = /sid=([^;]+)/.exec(cookie)![1]!;
    expect(await t.c.db.session.count({ where: { tokenHash: raw } })).toBe(0); // only the hash is stored
    expect(await t.c.db.session.count()).toBe(1);
  });

  it('gives the same answer for wrong password, unknown email and disabled user', async () => {
    await createUser(t.c, { email: 'off@example.test' });
    await t.c.db.user.update({ where: { email: 'off@example.test' }, data: { status: 'DISABLED' } });
    const answers = await Promise.all([
      request(t.app).post('/api/v1/auth/login').send({ email: 'mgr@example.test', password: 'wrong-password-123' }),
      request(t.app).post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: PASSWORD }),
      request(t.app).post('/api/v1/auth/login').send({ email: 'off@example.test', password: PASSWORD }),
    ]);
    for (const a of answers) {
      expect(a.status).toBe(401);
      expect(a.body.code).toBe('INVALID_CREDENTIALS');
      expect(a.body.message).toBe('Invalid email or password');
    }
  });

  it('locks the account after repeated failures and does not reveal the lock', async () => {
    for (let i = 0; i < 3; i++) await request(t.app).post('/api/v1/auth/login').send({ email: 'mgr@example.test', password: 'wrong-password-123' });
    const locked = await request(t.app).post('/api/v1/auth/login').send({ email: 'mgr@example.test', password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe('INVALID_CREDENTIALS');
    await t.c.db.user.update({ where: { email: 'mgr@example.test' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await request(t.app).post('/api/v1/auth/login').send({ email: 'mgr@example.test', password: PASSWORD })).status).toBe(200);
  });

  it('validates input shape', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['body.email', 'body.password']));
  });

  it('rotates the session on login (old cookie stops working)', async () => {
    const a = new Client(t.app);
    await a.login('mgr@example.test');
    const first = await a.get('/api/v1/me');
    expect(first.status).toBe(200);
    await a.login('mgr@example.test');
    expect(await t.c.db.session.count()).toBe(1);
  });
});

describe('csrf and origin', () => {
  it('rejects state-changing requests without a valid CSRF token, accepts them with one', async () => {
    await t.c.db.user.deleteMany();
    await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
    const c = new Client(t.app);
    await c.login('mgr@example.test');
    const good = c.csrf;
    c.csrf = '';
    const missing = await c.patch('/api/v1/me', { name: 'New Name' });
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('CSRF_INVALID');
    c.csrf = 'x'.repeat(32);
    expect((await c.patch('/api/v1/me', { name: 'New Name' })).body.code).toBe('CSRF_INVALID');
    c.csrf = good;
    const ok = await c.patch('/api/v1/me', { name: 'New Name' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe('New Name');
  });

  it('rejects browser requests from origins that are not allow-listed', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
    const allowed = await request(t.app).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: 'a@b.test', password: 'x' });
    expect(allowed.status).toBe(401); // got past the origin check, failed on credentials
  });

  it('answers CORS preflight only for allow-listed origins, with credentials', async () => {
    const ok = await request(t.app).options('/api/v1/me').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(t.app).options('/api/v1/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('two-factor', () => {
  beforeEach(async () => { await t.c.db.user.deleteMany(); startClock(); });
  afterEach(() => stopClock());

  it('forces Super Admin through enrollment; a pending session cannot reach protected routes', async () => {
    await createUser(t.c, { email: 'owner@example.test', roleKey: 'super_admin' });
    const c = new Client(t.app);
    const login = await c.login('owner@example.test');
    expect(login.body.status).toBe('two_factor_setup_required');

    const blocked = await c.get('/api/v1/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');

    const me = await c.get('/api/v1/me'); // allowed while pending, but reveals nothing
    expect(me.status).toBe(200);
    expect(me.body.permissions).toEqual([]);
    expect(me.body.modules).toEqual([]);

    const { recoveryCodes } = await enrollTwoFactor(c);
    expect(recoveryCodes).toHaveLength(10);
    expect((await c.get('/api/v1/users')).status).toBe(200);
  });

  it('stores the TOTP secret encrypted and recovery codes hashed', async () => {
    const { secret, recoveryCodes } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const row = await t.c.db.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } });
    expect(row.twoFactorSecretEnc).toBeTruthy();
    expect(row.twoFactorSecretEnc).not.toContain(secret);
    expect(row.recoveryCodeHashes).toHaveLength(10);
    expect(row.recoveryCodeHashes.join()).not.toContain(recoveryCodes[0]!);
  });

  it('verifies a TOTP on next sign-in, and a used code cannot be replayed', async () => {
    const { secret } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    advance(31); // next 30s step; the enrollment code is spent
    const c = new Client(t.app);
    const login = await c.login('owner@example.test');
    expect(login.body.status).toBe('two_factor_required');
    expect((await c.get('/api/v1/users')).body.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await c.post('/api/v1/auth/2fa/verify', { code: '000000' })).body.code).toBe('INVALID_TWO_FACTOR_CODE');

    const code = totp(secret);
    const ok = await c.post('/api/v1/auth/2fa/verify', { code });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('authenticated');
    c.csrf = ok.body.csrfToken;
    expect((await c.get('/api/v1/users')).status).toBe(200);

    const attacker = new Client(t.app);
    await attacker.login('owner@example.test');
    const replay = await attacker.post('/api/v1/auth/2fa/verify', { code }); // same code, same step
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_TWO_FACTOR_CODE');
  });

  it('accepts a recovery code once', async () => {
    const { recoveryCodes } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const c = new Client(t.app);
    await c.login('owner@example.test');
    const ok = await c.post('/api/v1/auth/2fa/verify', { recoveryCode: recoveryCodes[0]! });
    expect(ok.status).toBe(200);
    const again = new Client(t.app);
    await again.login('owner@example.test');
    expect((await again.post('/api/v1/auth/2fa/verify', { recoveryCode: recoveryCodes[0]! })).status).toBe(401);
    expect((await t.c.db.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).recoveryCodeHashes).toHaveLength(9);
  });

  it('rotates the session when two-factor completes', async () => {
    await createUser(t.c, { email: 'owner@example.test', roleKey: 'super_admin' });
    const c = new Client(t.app);
    const login = await c.login('owner@example.test');
    const before = login.body.csrfToken;
    await enrollTwoFactor(c);
    expect(c.csrf).not.toBe(before);
    expect(await t.c.db.session.count()).toBe(1);
  });
});

describe('invitations and passwords (email off)', () => {
  beforeEach(async () => { await t.c.db.user.deleteMany(); await t.c.db.invitation.deleteMany(); });

  it('forgot-password is rejected, not faked, when no email provider is configured', async () => {
    const res = await request(t.app).post('/api/v1/auth/password/forgot').send({ email: 'mgr@example.test' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('CAPABILITY_DISABLED');
  });

  it('administrator-issued reset link works once, ends every session and unlocks the account', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const victim = await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
    const phone = new Client(t.app);
    await phone.login('mgr@example.test');

    const issued = await owner.post(`/api/v1/users/${victim.id}/password-reset`);
    expect(issued.status).toBe(200);
    expect(issued.body.delivery).toBe('manual');
    const token = issued.body.token as string;
    expect(await t.c.db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0); // stored hashed

    expect((await request(t.app).post('/api/v1/auth/password/reset').send({ token, password: 'short' })).status).toBe(400);
    const newPassword = 'A-Brand-New-Passphrase-1';
    expect((await request(t.app).post('/api/v1/auth/password/reset').send({ token, password: newPassword })).status).toBe(204);
    expect((await request(t.app).post('/api/v1/auth/password/reset').send({ token, password: newPassword })).body.code).toBe('INVALID_TOKEN');

    expect((await phone.get('/api/v1/me')).status).toBe(401); // old session is gone
    expect((await new Client(t.app).login('mgr@example.test')).status).toBe(401);
    expect((await new Client(t.app).login('mgr@example.test', newPassword)).status).toBe(200);
  });

  it('change-password signs out other devices but keeps this one', async () => {
    await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
    const a = new Client(t.app);
    const b = new Client(t.app);
    await a.login('mgr@example.test');
    await b.login('mgr@example.test');
    expect((await a.post('/api/v1/auth/password/change', { currentPassword: 'wrong-password-123', newPassword: 'Another-Long-Passphrase-2' })).status).toBe(401);
    expect((await a.post('/api/v1/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Another-Long-Passphrase-2' })).status).toBe(204);
    expect((await a.get('/api/v1/me')).status).toBe(200);
    expect((await b.get('/api/v1/me')).status).toBe(401);
  });

  it('invitation accept: single use, expiry and revocation are enforced', async () => {
    const { client: owner } = await signInWithTwoFactor(t, 'owner@example.test', 'super_admin');
    const roles = (await owner.get('/api/v1/roles')).body.items as { id: string; key: string }[];
    const managerId = roles.find((r) => r.key === 'manager')!.id;

    const created = await owner.post('/api/v1/invitations', { email: 'New.Person@example.test', roleIds: [managerId] });
    expect(created.status).toBe(201);
    expect(created.body.issued.delivery).toBe('manual');
    const token = created.body.issued.token as string;

    const accepted = await request(t.app).post('/api/v1/auth/invitations/accept').send({ token, name: 'New Person', password: PASSWORD });
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('authenticated');
    expect((await t.c.db.user.findUniqueOrThrow({ where: { email: 'new.person@example.test' }, include: { roles: true } })).roles).toHaveLength(1);

    const twice = await request(t.app).post('/api/v1/auth/invitations/accept').send({ token, name: 'Again', password: PASSWORD });
    expect(twice.body.code).toBe('INVALID_TOKEN');

    // expiry
    const second = await owner.post('/api/v1/invitations', { email: 'late@example.test', roleIds: [managerId] });
    await t.c.db.invitation.update({ where: { id: second.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(t.app).post('/api/v1/auth/invitations/accept').send({ token: second.body.issued.token, name: 'Late', password: PASSWORD })).body.code).toBe('INVALID_TOKEN');

    // revocation, and re-inviting revokes the earlier pending one
    const third = await owner.post('/api/v1/invitations', { email: 'gone@example.test', roleIds: [managerId] });
    expect((await owner.post(`/api/v1/invitations/${third.body.invitation.id}/revoke`)).status).toBe(204);
    expect((await request(t.app).post('/api/v1/auth/invitations/accept').send({ token: third.body.issued.token, name: 'Gone', password: PASSWORD })).body.code).toBe('INVALID_TOKEN');
    const a = await owner.post('/api/v1/invitations', { email: 'dup@example.test', roleIds: [managerId] });
    const b = await owner.post('/api/v1/invitations', { email: 'dup@example.test', roleIds: [managerId] });
    expect((await request(t.app).post('/api/v1/auth/invitations/accept').send({ token: a.body.issued.token, name: 'Dup', password: PASSWORD })).body.code).toBe('INVALID_TOKEN');
    expect((await request(t.app).post('/api/v1/auth/invitations/accept').send({ token: b.body.issued.token, name: 'Dup', password: PASSWORD })).status).toBe(201);
  });
});

describe('logout', () => {
  it('ends the session server-side', async () => {
    await t.c.db.user.deleteMany();
    await createUser(t.c, { email: 'mgr@example.test', roleKey: 'manager' });
    const c = new Client(t.app);
    await c.login('mgr@example.test');
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/me')).status).toBe(401);
    expect(await t.c.db.session.count()).toBe(0);
  });
});
