import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

export const loginBodySchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export type LoginBody = z.infer<typeof loginBodySchema>;

export const sessionStateSchema = z
  .object({
    status: z.enum(['authenticated', 'two_factor_required', 'two_factor_setup_required']),
    csrfToken: z.string().describe('Send as `X-CSRF-Token` on every state-changing request'),
  })
  .meta({ id: 'SessionState' });
export type SessionState = z.infer<typeof sessionStateSchema>;

export const twoFactorCodeBodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Six digits').optional(),
  recoveryCode: z.string().trim().min(8).max(32).optional(),
}).refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), 'Provide either code or recoveryCode');
export type TwoFactorCodeBody = z.infer<typeof twoFactorCodeBodySchema>;

export const twoFactorSetupSchema = z
  .object({
    otpauthUrl: z.string().describe('Render as a QR code for authenticator apps'),
    secret: z.string().describe('Manual-entry key'),
  })
  .meta({ id: 'TwoFactorSetup' });

export const twoFactorEnableBodySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
export const twoFactorEnabledSchema = z
  .object({ recoveryCodes: z.array(z.string()).describe('Shown once. Store them offline.') })
  .meta({ id: 'TwoFactorEnabled' });

export const forgotPasswordBodySchema = z.object({ email: emailSchema });
export const resetPasswordBodySchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
