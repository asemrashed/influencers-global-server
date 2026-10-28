import type { PermissionDef } from '../../permissions/types.js';

export const contactsPermissions = [
  { key: 'contacts.read', description: 'View contacts list and details', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'contacts.write', description: 'Create and edit contacts', defaults: { admin: 'all', manager: 'assigned' } },
] as const satisfies readonly PermissionDef[];

