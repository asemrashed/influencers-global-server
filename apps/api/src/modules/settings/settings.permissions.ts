import type { PermissionDef } from '../../permissions/types.js';

export const settingsPermissions = [
  { key: 'settings.read', description: 'View settings and module toggles', defaults: { admin: 'all' } },
  { key: 'settings.write', description: 'Change settings and module toggles' },
] as const satisfies readonly PermissionDef[];
