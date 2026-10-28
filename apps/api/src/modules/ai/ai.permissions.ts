import type { PermissionDef } from '../../permissions/types.js';

export const aiPermissions: readonly PermissionDef[] = [
  {
    key: 'ai.read',
    description: 'View AI insights, action logs, and usage',
    defaults: { admin: 'all', manager: 'all' },
  },
  {
    key: 'ai.execute',
    description: 'Trigger AI tasks (drafting, classification, summarizing)',
    defaults: { admin: 'all', manager: 'all' },
  },
  {
    key: 'ai.approve',
    description: 'Approve or reject AI-generated actions and draft replies',
    defaults: { admin: 'all' },
  },
  {
    key: 'workflows.read',
    description: 'View workflow rules and execution logs',
    defaults: { admin: 'all', manager: 'all' },
  },
  {
    key: 'workflows.write',
    description: 'Create and update workflow rules and manual triggers',
    defaults: { admin: 'all' },
  },
] as const;

