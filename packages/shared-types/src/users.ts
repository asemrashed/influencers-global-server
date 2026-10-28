import { z } from 'zod';
import { emailSchema, isoDateTime, pageOf, paginationQuerySchema, passwordSchema, plainText } from './common.js';

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const userStatusSchema = z.enum(USER_STATUSES).meta({ id: 'UserStatus' });

export const roleSummarySchema = z
  .object({ id: z.string(), key: z.string().nullable(), name: z.string() })
  .meta({ id: 'RoleSummary' });

export const userSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    status: userStatusSchema,
    twoFactorEnabled: z.boolean(),
    roles: z.array(roleSummarySchema),
    lastLoginAt: isoDateTime.nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .meta({ id: 'User' });
export type UserDto = z.infer<typeof userSchema>;

export const userPageSchema = pageOf(userSchema, 'UserPage');
export const userListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Matches name or email'),
  status: userStatusSchema.optional(),
  roleId: z.string().optional(),
});

export const updateUserBodySchema = z.object({ name: plainText(1, 100) });
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

export const setUserRolesBodySchema = z.object({ roleIds: z.array(z.string()).min(1).max(20) });
export type SetUserRolesBody = z.infer<typeof setUserRolesBodySchema>;

/** Returned when an operator issues a reset or invite and no email provider is configured. */
export const manualDeliverySchema = z
  .object({
    delivery: z.enum(['email', 'manual']),
    token: z.string().optional().describe('Only when delivery = manual. Shown once; share it securely.'),
    expiresAt: isoDateTime,
  })
  .meta({ id: 'IssuedToken' });
export type IssuedToken = z.infer<typeof manualDeliverySchema>;

// Invitations
export const invitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    roles: z.array(roleSummarySchema),
    status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
    expiresAt: isoDateTime,
    createdById: z.string().nullable(),
    createdAt: isoDateTime,
  })
  .meta({ id: 'Invitation' });
export type InvitationDto = z.infer<typeof invitationSchema>;

export const invitationPageSchema = pageOf(invitationSchema, 'InvitationPage');
export const invitationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']).optional(),
});

export const createInvitationBodySchema = z.object({
  email: emailSchema,
  name: plainText(1, 100).optional(),
  roleIds: z.array(z.string()).min(1).max(20),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

export const createInvitationResponseSchema = z
  .object({ invitation: invitationSchema, issued: manualDeliverySchema })
  .meta({ id: 'CreateInvitationResponse' });

export const acceptInvitationBodySchema = z.object({
  token: z.string().min(20).max(200),
  name: plainText(1, 100),
  password: passwordSchema,
});
export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;
