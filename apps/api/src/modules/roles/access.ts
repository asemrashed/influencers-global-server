import type { GrantedPermission, Scope } from '@platform/shared-types';
import type { DbOrTx } from '../../db.js';
import { errors } from '../../lib/errors.js';
import { scopeCovers } from '../../lib/scope.js';
import { ALL_PERMISSION_KEYS } from '../../permissions/definitions.js';
import { scopeFor, type AuthContext } from '../auth/auth.types.js';

export const SCOPE_FROM_DB: Record<string, Scope> = { ALL: 'all', ASSIGNED: 'assigned', OWN: 'own' };
export const SCOPE_TO_DB = { all: 'ALL', assigned: 'ASSIGNED', own: 'OWN' } as const;

/** Nobody can hand out a permission (or a wider scope) than they hold themselves. */
export function assertCanGrant(actor: AuthContext, grants: readonly GrantedPermission[]): void {
  for (const g of grants) {
    const held = scopeFor(actor, g.permission);
    if (!held || !scopeCovers(held, g.scope)) throw errors.escalation(`You cannot grant "${g.permission}" with scope "${g.scope}"`);
  }
}

/** Unknown permission keys are rejected: the registry in code is the only source of truth. */
export function assertKnownPermissions(grants: readonly GrantedPermission[]): void {
  const known = new Set<string>(ALL_PERMISSION_KEYS);
  const bad = grants.filter((g) => !known.has(g.permission));
  if (bad.length) throw errors.validation(bad.map((g) => ({ path: 'body.permissions', message: `Unknown permission "${g.permission}"` })));
  const seen = new Set<string>();
  for (const g of grants) {
    if (seen.has(g.permission)) throw errors.validation([{ path: 'body.permissions', message: `Duplicate permission "${g.permission}"` }]);
    seen.add(g.permission);
  }
}

/** The caller may assign `role` only if they could grant everything in it; the locked role needs a Super Admin. */
export async function assertCanAssignRole(db: DbOrTx, actor: AuthContext, roleId: string): Promise<void> {
  const role = await db.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw errors.validation([{ path: 'body.roleIds', message: `Unknown role "${roleId}"` }]);
  if (role.isLocked) {
    if (!actor.isSuperAdmin) throw errors.escalation('Only a Super Admin can assign the Super Admin role');
    return;
  }
  assertCanGrant(actor, role.permissions.map((rp) => ({ permission: rp.permission.key, scope: SCOPE_FROM_DB[rp.scope] ?? 'own' })));
}
