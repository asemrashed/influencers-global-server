import type { PermissionDef } from '../../permissions/types.js';

export const auditPermissions = [{ key: 'audit.read', description: 'View the audit log' }] as const satisfies readonly PermissionDef[];
