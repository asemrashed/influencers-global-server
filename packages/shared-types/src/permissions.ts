import { z } from 'zod';

export const SCOPES = ['all', 'assigned', 'own'] as const;
export const scopeSchema = z.enum(SCOPES).meta({ id: 'PermissionScope' });
export type Scope = z.infer<typeof scopeSchema>;

export const permissionSchema = z
  .object({
    key: z.string().describe('`module.action`, e.g. `users.read`'),
    module: z.string(),
    description: z.string(),
  })
  .meta({ id: 'Permission' });
export type PermissionDto = z.infer<typeof permissionSchema>;

export const grantedPermissionSchema = z
  .object({ permission: z.string(), scope: scopeSchema })
  .meta({ id: 'GrantedPermission' });
export type GrantedPermission = z.infer<typeof grantedPermissionSchema>;
