import type { PermissionDef } from '../../permissions/types.js';

export const profilePermissions = [
  { key: 'profile.read', description: 'View influencer profile, media kit, rate cards and portfolio', defaults: { admin: 'all' } },
  { key: 'profile.write', description: 'Update profile, bio, niches, media kit and rate cards', defaults: { admin: 'all' } },
  { key: 'portfolio.write', description: 'Create and edit portfolio albums and work showcase items', defaults: { admin: 'all' } },
] as const satisfies readonly PermissionDef[];

