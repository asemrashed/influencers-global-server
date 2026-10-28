import type { PermissionDef } from '../../permissions/types.js';

export const eventsPermissions = [
  { key: 'events.read', description: 'View events, guest lists and RSVPs', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'events.write', description: 'Create and edit events and manage guest list', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'events.checkin', description: 'Scan QR tickets and check in attendees', defaults: { admin: 'all', manager: 'assigned' } },

  { key: 'pr.read', description: 'View PR packages, tracking and invitations', defaults: { admin: 'all', manager: 'assigned' } },
  { key: 'pr.write', description: 'Create and manage PR packages and invitations', defaults: { admin: 'all', manager: 'assigned' } },
] as const satisfies readonly PermissionDef[];

