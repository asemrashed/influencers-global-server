import type { PermissionDef } from '../../permissions/types.js';

export const inboxPermissions = [
  { key: 'inbox.read', description: 'View inbox threads and messages', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'inbox.reply', description: 'Reply to threads and collaboration inquiries', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'inbox.approve', description: 'Approve AI drafts and automated replies', defaults: { admin: 'all' } },
] as const satisfies readonly PermissionDef[];

