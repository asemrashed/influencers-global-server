import { aiPermissions } from '../modules/ai/ai.permissions.js';
import { auditPermissions } from '../modules/audit/audit.permissions.js';
import { collaborationPermissions } from '../modules/collaboration/collaboration.permissions.js';
import { commercePermissions } from '../modules/commerce/commerce.permissions.js';
import { contactsPermissions } from '../modules/contacts/contacts.permissions.js';
import { eventsPermissions } from '../modules/events/events.permissions.js';
import { inboxPermissions } from '../modules/inbox/inbox.permissions.js';
import { profilePermissions } from '../modules/profile/profile.permissions.js';
import { rolesPermissions } from '../modules/roles/roles.permissions.js';
import { settingsPermissions } from '../modules/settings/settings.permissions.js';
import { socialPermissions } from '../modules/social/social.permissions.js';
import { supportPermissions } from '../modules/support/support.permissions.js';
import { usersPermissions } from '../modules/users/users.permissions.js';
import type { PermissionDef } from './types.js';

/** Every permission in the system. A new module appends its own array here in the same change that adds its routes. */
export const PERMISSIONS = [
  ...usersPermissions,
  ...rolesPermissions,
  ...settingsPermissions,
  ...auditPermissions,
  ...profilePermissions,
  ...contactsPermissions,
  ...inboxPermissions,
  ...supportPermissions,
  ...collaborationPermissions,
  ...eventsPermissions,
  ...socialPermissions,
  ...commercePermissions,
  ...aiPermissions,
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);
export const PERMISSION_DEFS: readonly PermissionDef[] = PERMISSIONS;
export const moduleOf = (key: string): string => key.split('.')[0] ?? key;
