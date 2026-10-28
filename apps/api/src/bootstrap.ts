import { MODULE_KEYS, type Scope } from '@platform/shared-types';
import type { Container } from './container.js';
import { PERMISSION_DEFS, moduleOf } from './permissions/definitions.js';

const SCOPE_TO_DB = { all: 'ALL', assigned: 'ASSIGNED', own: 'OWN' } as const;

export const SYSTEM_ROLES = [
  { key: 'super_admin', name: 'Super Admin', description: 'The account owner. Always has every permission.', isLocked: true, requireTwoFactor: true },
  { key: 'admin', name: 'Admin', description: 'Staff who run the day-to-day operation.', isLocked: false, requireTwoFactor: true },
  { key: 'manager', name: 'Manager', description: 'Brand or PR team member, limited to assigned records.', isLocked: false, requireTwoFactor: false },
] as const;

/**
 * Idempotent boot step: system roles, permission catalog, default grants, module toggles.
 *  - Roles are created once; later edits by the Super Admin are never overwritten (except the locked Super Admin).
 *  - A permission seen for the first time gets its declared default grants for Admin/Manager; existing ones are untouched.
 *  - Permissions removed from code are deleted (their grants cascade).
 */
export async function bootstrap(c: Container): Promise<{ newPermissions: string[] }> {
  const { db } = c;

  for (const r of SYSTEM_ROLES) {
    const existing = await db.role.findUnique({ where: { key: r.key } });
    if (!existing) {
      await db.role.create({ data: { ...r, isSystem: true } });
    } else if (r.isLocked && (!existing.isLocked || !existing.requireTwoFactor)) {
      await db.role.update({ where: { id: existing.id }, data: { isLocked: true, requireTwoFactor: true } });
    }
  }
  const roleByKey = new Map((await db.role.findMany({ where: { key: { not: null } } })).map((r) => [r.key as string, r]));

  const declared = new Set(PERMISSION_DEFS.map((p) => p.key));
  const existingPerms = await db.permission.findMany();
  const known = new Set(existingPerms.map((p) => p.key));
  const stale = existingPerms.filter((p) => !declared.has(p.key as never)).map((p) => p.id);
  if (stale.length) await db.permission.deleteMany({ where: { id: { in: stale } } });

  const newPermissions: string[] = [];
  for (const def of PERMISSION_DEFS) {
    const row = await db.permission.upsert({
      where: { key: def.key },
      create: { key: def.key, module: moduleOf(def.key), description: def.description },
      update: { module: moduleOf(def.key), description: def.description },
    });
    const grant = async (roleKey: string, scope: Scope) => {
      const role = roleByKey.get(roleKey);
      if (!role) return;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: row.id } },
        create: { roleId: role.id, permissionId: row.id, scope: SCOPE_TO_DB[scope] },
        update: {},
      });
    };
    // Super Admin: every permission, always (also enforced at request time).
    await grant('super_admin', 'all');
    if (!known.has(def.key)) {
      newPermissions.push(def.key);
      if (def.defaults?.admin) await grant('admin', def.defaults.admin);
      if (def.defaults?.manager) await grant('manager', def.defaults.manager);
    }
  }

  await db.moduleToggle.createMany({ data: MODULE_KEYS.map((key) => ({ key, enabled: true })), skipDuplicates: true });
  c.modules.invalidate();
  return { newPermissions };
}
