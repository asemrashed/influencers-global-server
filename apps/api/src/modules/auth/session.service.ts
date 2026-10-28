import type { Request, Response } from 'express';
import type { Scope } from '@platform/shared-types';
import type { Container } from '../../container.js';
import type { DbOrTx } from '../../db.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { widest } from '../../lib/scope.js';
import { ALL_PERMISSION_KEYS } from '../../permissions/definitions.js';
import type { AuthContext } from './auth.types.js';

const DB_TO_SCOPE: Record<string, Scope> = { ALL: 'all', ASSIGNED: 'assigned', OWN: 'own' };
const TOUCH_AFTER_MS = 60_000;

export interface CreatedSession {
  token: string;
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
}

/** Creates a session. The raw token goes to the cookie once; only its SHA-256 is stored. */
export async function createSession(
  c: Container,
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; twoFactorVerified: boolean },
  db: DbOrTx = c.db,
): Promise<CreatedSession> {
  const now = Date.now();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(now + c.env.SESSION_ABSOLUTE_HOURS * 3600_000);
  const row = await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfToken,
      twoFactorVerified: meta.twoFactorVerified,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      idleExpiresAt: new Date(now + c.env.SESSION_IDLE_MINUTES * 60_000),
      expiresAt,
    },
  });
  return { token, sessionId: row.id, csrfToken, expiresAt };
}

/** Resolves a cookie value to an auth context, or null if the session is missing, expired or the user is not active. */
export async function loadAuth(c: Container, rawToken: string): Promise<AuthContext | null> {
  const s = await c.db.session.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: {
      user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } },
    },
  });
  if (!s) return null;
  const now = new Date();
  if (s.expiresAt <= now || s.idleExpiresAt <= now) {
    await c.db.session.deleteMany({ where: { id: s.id } });
    return null;
  }
  const { user } = s;
  if (user.status !== 'ACTIVE' || user.deletedAt) return null;

  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await c.db.session.update({
      where: { id: s.id },
      data: { lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + c.env.SESSION_IDLE_MINUTES * 60_000) },
    });
  }

  const roles = user.roles.map((ur) => ur.role);
  const isSuperAdmin = roles.some((r) => r.isLocked);
  const permissions = new Map<string, Scope>();
  if (isSuperAdmin) {
    // Locked role: every permission the code declares, immediately, with no DB grants required.
    for (const key of ALL_PERMISSION_KEYS) permissions.set(key, 'all');
  } else {
    for (const role of roles) {
      for (const rp of role.permissions) {
        const scope = DB_TO_SCOPE[rp.scope] ?? 'own';
        const prev = permissions.get(rp.permission.key);
        permissions.set(rp.permission.key, prev ? widest(prev, scope) : scope);
      }
    }
  }

  return {
    user: { id: user.id, email: user.email, name: user.name, twoFactorEnabled: user.twoFactorEnabled },
    session: { id: s.id, csrfToken: s.csrfToken, twoFactorVerified: s.twoFactorVerified },
    roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isLocked: r.isLocked, requireTwoFactor: r.requireTwoFactor })),
    permissions,
    isSuperAdmin,
    twoFactorRequired: user.twoFactorEnabled || roles.some((r) => r.requireTwoFactor || r.isLocked),
  };
}

export const destroySession = (db: DbOrTx, sessionId: string) => db.session.deleteMany({ where: { id: sessionId } });

/** Ends every session of a user, optionally keeping the current one. */
export const destroyUserSessions = (db: DbOrTx, userId: string, exceptSessionId?: string) =>
  db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });

export function setSessionCookie(c: Container, res: Response, s: CreatedSession): void {
  res.cookie(c.env.SESSION_COOKIE_NAME, s.token, {
    httpOnly: true,
    secure: c.env.COOKIE_SECURE_RESOLVED,
    sameSite: 'lax',
    path: '/',
    expires: s.expiresAt,
  });
}

export function clearSessionCookie(c: Container, res: Response): void {
  res.clearCookie(c.env.SESSION_COOKIE_NAME, { httpOnly: true, secure: c.env.COOKIE_SECURE_RESOLVED, sameSite: 'lax', path: '/' });
}

export const sessionMeta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
