import type { PermissionDef } from '../../permissions/types.js';

export const collaborationPermissions = [
  { key: 'proposals.read', description: 'View proposals and negotiation history', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'proposals.write', description: 'Create and draft proposals', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'proposals.respond', description: 'Accept or decline proposals', defaults: { admin: 'all' } },

  { key: 'campaigns.read', description: 'View campaigns, workspaces and briefs', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'campaigns.write', description: 'Manage campaigns, tasks and briefs', defaults: { admin: 'all', manager: 'assigned' } },

  { key: 'deliverables.read', description: 'View campaign deliverables', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'deliverables.submit', description: 'Submit assets and links for deliverables', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'deliverables.approve', description: 'Approve or request revisions on deliverables', defaults: { admin: 'all' } },

  { key: 'agreements.read', description: 'View campaign agreements', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'agreements.write', description: 'Create and edit agreements', defaults: { admin: 'all' } },
  { key: 'agreements.sign', description: 'Sign agreements electronically', defaults: { admin: 'all' } },

  { key: 'meetings.read', description: 'View scheduled meetings and calendar slots', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'meetings.write', description: 'Schedule and reschedule meetings', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'meetings.confirm', description: 'Confirm or cancel meetings', defaults: { admin: 'all' } },
] as const satisfies readonly PermissionDef[];

