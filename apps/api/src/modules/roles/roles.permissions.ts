import type { PermissionDef } from '../../permissions/types.js';

export const rolesPermissions = [
  { key: 'roles.read', description: 'View roles and the permission catalog', defaults: { admin: 'all' } },
  { key: 'roles.manage', description: 'Create, edit and delete roles and their permissions' },
] as const satisfies readonly PermissionDef[];
