import type { PermissionDef } from '../../permissions/types.js';

export const supportPermissions = [
  { key: 'support.read', description: 'View support tickets', defaults: { admin: 'all', manager: 'own' } },
  { key: 'support.write', description: 'Create, update and reply to support tickets', defaults: { admin: 'all', manager: 'own' } },
] as const satisfies readonly PermissionDef[];

