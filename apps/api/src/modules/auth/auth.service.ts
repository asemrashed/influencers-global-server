import type { Request, Response } from 'express';
import { authenticator } from 'otplib';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { SessionState } from '@platform/shared-types';
import type { Container } from '../../container.js';
import { decrypt, encrypt, generateRecoveryCode, randomToken, sha256 } from '../../lib/crypto.js';
import { errors } from '../../lib/errors.js';
import { issueToken, sendEmail, uiLink } from '../../lib/mailer.js';
import { auditContext } from '../audit/audit.service.js';
import type { AuthContext } from './auth.types.js';
import { clearSessionCookie, createSession, destroySession, destroyUserSessions, sessionMeta, setSessionCookie } from './session.service.js';

authenticator.options = { window: 1, step: 30, digits: 6 };

const ARGON2ID = 2 as never; // `Algorithm.Argon2id`; the enum is a const enum and cannot be imported under isolatedModules
const ARGON_OPTS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const RESET_TTL_MS = 60 * 60_000;
const RECOVERY_CODE_COUNT = 10;

export const hashPassword = (password: string): Promise<string> => argonHash(password, ARGON_OPTS);
async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Verified against when the email is unknown, so response time does not reveal which emails exist. */
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken(16)));

export const INVITE_TTL = INVITE_TTL_MS;

/** Records a failed attempt and locks the account after too many. Never reveals the lock to the caller. */
async function registerFailure(c: Container, userId: string): Promise<void> {
  const u = await c.db.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } } });
  if (u.failedLoginCount >= c.env.LOGIN_MAX_FAILURES) {
    await c.db.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + c.env.LOGIN_LOCK_MINUTES * 60_000), failedLoginCount: 0 },
    });
  }
}

const stateFor = (auth: { twoFactorRequired: boolean; twoFactorEnabled: boolean; verified: boolean }, csrfToken: string): SessionState => ({
  status: !auth.twoFactorRequired || auth.verified ? 'authenticated' : auth.twoFactorEnabled ? 'two_factor_required' : 'two_factor_setup_required',
  csrfToken,
});

// ───────────── login / logout ─────────────

export async function login(c: Container, req: Request, res: Response, email: string, password: string): Promise<SessionState> {
  const user = await c.db.user.findUnique({ where: { email }, include: { roles: { include: { role: true } } } });
  const hash = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(hash, password);
  const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
  const usable = Boolean(user && user.status === 'ACTIVE' && !user.deletedAt);

  if (!user || !passwordOk || locked || !usable) {
    if (user && !locked && usable) await registerFailure(c, user.id);
    await c.audit.record(c.db, { action: 'auth.login.failed', ...auditContext(req), actorId: null, ...(user ? { entityType: 'User', entityId: user.id } : {}), metadata: { locked } });
    throw errors.invalidCredentials(); // identical for unknown email, wrong password, disabled and locked accounts
  }

  // Rotate: any session cookie the browser already holds is discarded.
  const old = req.cookies?.[c.env.SESSION_COOKIE_NAME];
  if (typeof old === 'string') await c.db.session.deleteMany({ where: { tokenHash: sha256(old) } });

  const requires2fa = user.twoFactorEnabled || user.roles.some((r) => r.role.requireTwoFactor || r.role.isLocked);
  await c.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const session = await createSession(c, user.id, { ...sessionMeta(req), twoFactorVerified: !requires2fa });
  setSessionCookie(c, res, session);
  await c.audit.record(c.db, { action: 'auth.login', ...auditContext(req), actorId: user.id, entityType: 'User', entityId: user.id, metadata: { twoFactorPending: requires2fa } });
  return stateFor({ twoFactorRequired: requires2fa, twoFactorEnabled: user.twoFactorEnabled, verified: !requires2fa }, session.csrfToken);
}

export async function logout(c: Container, req: Request, res: Response, auth: AuthContext): Promise<void> {
  await destroySession(c.db, auth.session.id);
  clearSessionCookie(c, res);
  await c.audit.record(c.db, { action: 'auth.logout', ...auditContext(req) });
}

/** Replaces the current session with a fresh one (new id and CSRF token) after a privilege change. */
async function rotateSession(c: Container, req: Request, res: Response, auth: AuthContext, twoFactorVerified: boolean): Promise<string> {
  const fresh = await c.db.$transaction(async (tx) => {
    await destroySession(tx, auth.session.id);
    return createSession(c, auth.user.id, { ...sessionMeta(req), twoFactorVerified }, tx);
  });
  setSessionCookie(c, res, fresh);
  return fresh.csrfToken;
}

// ───────────── two-factor ─────────────

export async function twoFactorSetup(c: Container, req: Request, auth: AuthContext) {
  const user = await c.db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (user.twoFactorEnabled) throw errors.conflict('Two-factor is already enabled');
  const secret = authenticator.generateSecret();
  await c.db.user.update({ where: { id: user.id }, data: { twoFactorPendingSecretEnc: encrypt(secret, c.env.APP_ENCRYPTION_KEY) } });
  await c.audit.record(c.db, { action: 'auth.2fa.setup_started', ...auditContext(req), entityType: 'User', entityId: user.id });
  return { otpauthUrl: authenticator.keyuri(user.email, c.env.APP_NAME, secret), secret };
}

export async function twoFactorEnable(c: Container, req: Request, res: Response, auth: AuthContext, code: string) {
  const user = await c.db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (user.twoFactorEnabled) throw errors.conflict('Two-factor is already enabled');
  if (!user.twoFactorPendingSecretEnc) throw errors.conflict('Start setup first');
  const secret = decrypt(user.twoFactorPendingSecretEnc, c.env.APP_ENCRYPTION_KEY);
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) {
    await registerFailure(c, user.id);
    throw errors.invalidTwoFactor();
  }
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await c.db.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecretEnc: user.twoFactorPendingSecretEnc,
      twoFactorPendingSecretEnc: null,
      twoFactorLastStep: Math.floor(Date.now() / 30_000) + delta,
      recoveryCodeHashes: recoveryCodes.map(sha256),
    },
  });
  await rotateSession(c, req, res, auth, true);
  await c.audit.record(c.db, { action: 'auth.2fa.enabled', ...auditContext(req), entityType: 'User', entityId: user.id });
  return { recoveryCodes };
}

export async function twoFactorVerify(c: Container, req: Request, res: Response, auth: AuthContext, input: { code?: string | undefined; recoveryCode?: string | undefined }): Promise<SessionState> {
  const user = await c.db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!user.twoFactorEnabled || !user.twoFactorSecretEnc) throw errors.twoFactorSetupRequired();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw errors.invalidTwoFactor();

  let ok = false;
  if (input.code) {
    const delta = authenticator.checkDelta(input.code, decrypt(user.twoFactorSecretEnc, c.env.APP_ENCRYPTION_KEY));
    if (delta !== null) {
      const step = Math.floor(Date.now() / 30_000) + delta;
      // A code (or an older one) that was already accepted cannot be replayed.
      const claimed = await c.db.user.updateMany({
        where: { id: user.id, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
        data: { twoFactorLastStep: step },
      });
      ok = claimed.count === 1;
    }
  } else if (input.recoveryCode) {
    const h = sha256(input.recoveryCode.trim().toUpperCase());
    const claimed = await c.db.$executeRaw`UPDATE "User" SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${h}), "updatedAt" = now() WHERE id = ${user.id} AND ${h} = ANY("recoveryCodeHashes")`;
    ok = claimed === 1;
  }

  if (!ok) {
    await registerFailure(c, user.id);
    await c.audit.record(c.db, { action: 'auth.2fa.failed', ...auditContext(req), entityType: 'User', entityId: user.id });
    throw errors.invalidTwoFactor();
  }
  await c.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
  const csrfToken = await rotateSession(c, req, res, auth, true);
  await c.audit.record(c.db, { action: 'auth.2fa.verified', ...auditContext(req), entityType: 'User', entityId: user.id, metadata: { method: input.recoveryCode ? 'recovery_code' : 'totp' } });
  return { status: 'authenticated', csrfToken };
}

// ───────────── invitations ─────────────

export async function acceptInvitation(c: Container, req: Request, res: Response, input: { token: string; name: string; password: string }): Promise<SessionState> {
  const invitation = await c.db.invitation.findUnique({ where: { tokenHash: sha256(input.token) } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) throw errors.invalidToken();
  if (input.password.toLowerCase() === invitation.email) throw errors.validation([{ path: 'body.password', message: 'Password must not be your email' }]);

  const roles = await c.db.role.findMany({ where: { id: { in: invitation.roleIds } } });
  if (roles.length === 0) throw errors.conflict('The roles on this invitation no longer exist. Ask for a new invitation.');
  const passwordHash = await hashPassword(input.password);

  const user = await c.db.$transaction(async (tx) => {
    // Claim the invitation atomically so a double submit cannot create two accounts.
    const claimed = await tx.invitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw errors.invalidToken();
    if (await tx.user.findUnique({ where: { email: invitation.email } })) throw errors.conflict('An account with this email already exists');
    const created = await tx.user.create({
      data: { email: invitation.email, name: input.name, passwordHash, roles: { create: roles.map((r) => ({ roleId: r.id, assignedById: invitation.createdById })) } },
    });
    await c.audit.record(tx, { action: 'auth.invitation.accepted', ...auditContext(req), actorId: created.id, entityType: 'Invitation', entityId: invitation.id, metadata: { roleIds: roles.map((r) => r.id) } });
    return created;
  });

  const requires2fa = roles.some((r) => r.requireTwoFactor || r.isLocked);
  const session = await createSession(c, user.id, { ...sessionMeta(req), twoFactorVerified: !requires2fa });
  setSessionCookie(c, res, session);
  return stateFor({ twoFactorRequired: requires2fa, twoFactorEnabled: false, verified: !requires2fa }, session.csrfToken);
}

// ───────────── passwords ─────────────

export async function forgotPassword(c: Container, req: Request, email: string): Promise<void> {
  if (!c.providers.email) throw errors.capabilityDisabled('Email (ask an administrator to issue a reset link)');
  const user = await c.db.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE' || user.deletedAt) return; // same response either way
  const { token, expiresAt } = await createResetToken(c, user.id);
  await sendEmail(c, {
    to: user.email,
    subject: `Reset your ${c.env.APP_NAME} password`,
    text: `Use this link within 1 hour to choose a new password:\n${uiLink(c, '/reset-password', token)}\n\nIf you did not ask for this, ignore this email.`,
  });
  await c.audit.record(c.db, { action: 'auth.password.reset_requested', ...auditContext(req), entityType: 'User', entityId: user.id, metadata: { expiresAt } });
}

export async function createResetToken(c: Container, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await c.db.$transaction([
    c.db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }), // one live token per user
    c.db.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

/** Operator-issued reset link (users.write). Emailed when email is on, otherwise returned once. */
export async function issueResetForUser(c: Container, userId: string, email: string) {
  const { token, expiresAt } = await createResetToken(c, userId);
  return issueToken(c, {
    to: email,
    subject: `Reset your ${c.env.APP_NAME} password`,
    path: '/reset-password',
    token,
    expiresAt,
    text: (link) => `An administrator issued a password reset for your account. Use this link within 1 hour:\n${link}`,
  });
}

export async function resetPassword(c: Container, req: Request, input: { token: string; password: string }): Promise<void> {
  const row = await c.db.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.status !== 'ACTIVE' || row.user.deletedAt) throw errors.invalidToken();
  if (input.password.toLowerCase() === row.user.email) throw errors.validation([{ path: 'body.password', message: 'Password must not be your email' }]);
  const passwordHash = await hashPassword(input.password);
  await c.db.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw errors.invalidToken();
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await destroyUserSessions(tx, row.userId); // every device signs out
    await c.audit.record(tx, { action: 'auth.password.reset', ...auditContext(req), actorId: row.userId, entityType: 'User', entityId: row.userId });
  });
}

export async function changePassword(c: Container, req: Request, auth: AuthContext, input: { currentPassword: string; newPassword: string }): Promise<void> {
  const user = await c.db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw errors.invalidCredentials();
  if (input.newPassword === input.currentPassword) throw errors.validation([{ path: 'body.newPassword', message: 'Choose a different password' }]);
  if (input.newPassword.toLowerCase() === user.email) throw errors.validation([{ path: 'body.newPassword', message: 'Password must not be your email' }]);
  const passwordHash = await hashPassword(input.newPassword);
  await c.db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    await destroyUserSessions(tx, user.id, auth.session.id); // other devices sign out; this one stays
    await c.audit.record(tx, { action: 'auth.password.changed', ...auditContext(req), entityType: 'User', entityId: user.id });
  });
}
