import type { PermissionDef } from '../../permissions/types.js';

export const socialPermissions = [
  { key: 'social.read', description: 'View connected social accounts, follower statistics and status', defaults: { admin: 'all' } },
  { key: 'analytics.read', description: 'View dashboard summary and audience growth analytics', defaults: { admin: 'all' } },
  { key: 'content.read', description: 'View content drafts and scheduling calendar', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'content.write', description: 'Create and edit content drafts', defaults: { admin: 'all' } },
  { key: 'content.publish', description: 'Publish and schedule posts to connected social platforms', defaults: { admin: 'all' } },
] as const satisfies readonly PermissionDef[];

