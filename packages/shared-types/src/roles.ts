import { z } from 'zod';
import { grantedPermissionSchema } from './permissions.js';
import { isoDateTime, pageOf, paginationQuerySchema, plainText } from './common.js';

export const roleSchema = z
  .object({
    id: z.string(),
    key: z.string().nullable().describe('Set for system roles: super_admin, admin, manager'),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    isLocked: z.boolean().describe('Locked roles (Super Admin) cannot be edited or deleted'),
    requireTwoFactor: z.boolean(),
    userCount: z.number().int(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .meta({ id: 'Role' });
export type RoleDto = z.infer<typeof roleSchema>;

export const roleDetailSchema = roleSchema
  .extend({ permissions: z.array(grantedPermissionSchema) })
  .meta({ id: 'RoleDetail' });
export type RoleDetailDto = z.infer<typeof roleDetailSchema>;

export const rolePageSchema = pageOf(roleSchema, 'RolePage');
export const roleListQuerySchema = paginationQuerySchema;

export const createRoleBodySchema = z.object({
  name: plainText(2, 60),
  description: plainText(0, 300).optional(),
  requireTwoFactor: z.boolean().default(false),
  permissions: z.array(grantedPermissionSchema).max(500).default([]),
});
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

export const updateRoleBodySchema = z
  .object({
    name: plainText(2, 60).optional(),
    description: plainText(0, 300).nullable().optional(),
    requireTwoFactor: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;

export const setRolePermissionsBodySchema = z.object({
  permissions: z.array(grantedPermissionSchema).max(500),
});
export type SetRolePermissionsBody = z.infer<typeof setRolePermissionsBodySchema>;
