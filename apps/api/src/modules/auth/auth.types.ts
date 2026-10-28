import type { Scope } from '@platform/shared-types';

export interface AuthContext {
  user: { id: string; email: string; name: string; twoFactorEnabled: boolean };
  session: { id: string; csrfToken: string; twoFactorVerified: boolean };
  roles: { id: string; key: string | null; name: string; isLocked: boolean; requireTwoFactor: boolean }[];
  /** Effective permissions after merging all roles; the widest scope wins. */
  permissions: Map<string, Scope>;
  isSuperAdmin: boolean;
  /** True when any of the user's roles demands two-factor. */
  twoFactorRequired: boolean;
}

/** Scope the caller holds for `permission`, or null if not granted. */
export const scopeFor = (auth: AuthContext, permission: string): Scope | null => auth.permissions.get(permission) ?? null;
