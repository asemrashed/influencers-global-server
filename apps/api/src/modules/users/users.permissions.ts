import type { PermissionDef } from '../../permissions/types.js';

export const usersPermissions = [
  { key: 'users.read', description: 'View users', defaults: { admin: 'all' } },
  { key: 'users.write', description: 'Edit users and assign roles', defaults: { admin: 'all' } },
  { key: 'users.invite', description: 'Invite users and manage invitations', defaults: { admin: 'all' } },
  { key: 'users.revoke', description: 'Disable users and revoke their sessions', defaults: { admin: 'all' } },
] as const satisfies readonly PermissionDef[];
