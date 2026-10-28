import type { Request } from 'express';
import type { Container } from '../../container.js';
import type { DbOrTx, Tx } from '../../db.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { errors } from '../../lib/errors.js';
import { auditContext } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { destroyUserSessions } from '../auth/session.service.js';
import { assertCanAssignRole } from '../roles/access.js';

export const userInclude = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;
export type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export const isSuperAdminRow = (u: UserRow): boolean => u.roles.some((r) => r.role.isLocked);

export function toUserDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    twoFactorEnabled: u.twoFactorEnabled,
    roles: u.roles.map((r) => ({ id: r.role.id, key: r.role.key, name: r.role.name })),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

/** Admins manage everyone except Super Admins; only a Super Admin may touch a Super Admin. */
export function assertCanManage(actor: AuthContext, target: UserRow): void {
  if (isSuperAdminRow(target) && !actor.isSuperAdmin) throw errors.forbidden('Only a Super Admin can change a Super Admin');
}

/**
 * Throws LAST_SUPER_ADMIN if `userId` is the only active Super Admin. Takes a row lock on the Super Admin role
 * so two concurrent demotions cannot both pass the check.
 */
export async function assertNotLastSuperAdmin(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Role" WHERE "isLocked" = true FOR UPDATE`;
  const others = await tx.user.count({
    where: { id: { not: userId }, status: 'ACTIVE', deletedAt: null, roles: { some: { role: { isLocked: true } } } },
  });
  if (others === 0) throw errors.lastSuperAdmin();
}

export async function getUserOrThrow(db: DbOrTx, id: string): Promise<UserRow> {
  const u = await db.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
  if (!u) throw errors.notFound('User');
  return u;
}

export async function setRoles(c: Container, req: Request, actor: AuthContext, targetId: string, roleIds: string[]): Promise<UserRow> {
  const ids = [...new Set(roleIds)];
  return c.db.$transaction(async (tx) => {
    const target = await getUserOrThrow(tx, targetId);
    assertCanManage(actor, target);
    for (const id of ids) await assertCanAssignRole(tx, actor, id);

    const wasSuper = isSuperAdminRow(target);
    const willBeSuper = (await tx.role.count({ where: { id: { in: ids }, isLocked: true } })) > 0;
    // Changing someone's membership of a locked role is a Super Admin-only change, in either direction.
    if (wasSuper !== willBeSuper && !actor.isSuperAdmin) throw errors.escalation('Only a Super Admin can change Super Admin membership');
    if (wasSuper && !willBeSuper && target.status === 'ACTIVE') await assertNotLastSuperAdmin(tx, targetId);

    const before = target.roles.map((r) => r.roleId).sort();
    await tx.userRole.deleteMany({ where: { userId: targetId, roleId: { notIn: ids } } });
    await tx.userRole.createMany({ data: ids.map((roleId) => ({ userId: targetId, roleId, assignedById: actor.user.id })), skipDuplicates: true });
    await c.audit.record(tx, {
      action: 'users.roles.changed', ...auditContext(req), entityType: 'User', entityId: targetId,
      metadata: { before, after: [...ids].sort() },
    });
    return getUserOrThrow(tx, targetId);
  });
}

export async function setStatus(c: Container, req: Request, actor: AuthContext, targetId: string, status: 'ACTIVE' | 'DISABLED'): Promise<UserRow> {
  if (status === 'DISABLED' && actor.user.id === targetId) throw errors.conflict('You cannot revoke your own access');
  return c.db.$transaction(async (tx) => {
    const target = await getUserOrThrow(tx, targetId);
    assertCanManage(actor, target);
    if (status === 'DISABLED' && isSuperAdminRow(target) && target.status === 'ACTIVE') await assertNotLastSuperAdmin(tx, targetId);
    await tx.user.update({ where: { id: targetId }, data: { status } });
    if (status === 'DISABLED') await destroyUserSessions(tx, targetId); // access ends immediately
    await c.audit.record(tx, { action: status === 'DISABLED' ? 'users.revoked' : 'users.reactivated', ...auditContext(req), entityType: 'User', entityId: targetId });
    return getUserOrThrow(tx, targetId);
  });
}
