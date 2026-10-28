import type { Scope } from '@platform/shared-types';

/** Declared in code by the module that owns the routes. Synced into the `Permission` table at boot. */
export interface PermissionDef {
  key: `${string}.${string}`;
  description: string;
  /** Scope seeded for the default Admin / Manager roles the FIRST time this permission is seen. Omit = not granted. */
  defaults?: { admin?: Scope; manager?: Scope };
}
