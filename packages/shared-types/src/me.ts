import { z } from 'zod';
import { grantedPermissionSchema } from './permissions.js';
import { plainText } from './common.js';
import { roleSummarySchema } from './users.js';

export const meSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      twoFactorEnabled: z.boolean(),
    }),
    roles: z.array(roleSummarySchema),
    permissions: z.array(grantedPermissionSchema).describe('Effective permissions after merging all roles (UX gating only; the server enforces)'),
    modules: z.array(z.object({ key: z.string(), enabled: z.boolean() })),
    session: z.object({
      twoFactorVerified: z.boolean(),
      twoFactorRequired: z.boolean(),
      csrfToken: z.string(),
    }),
  })
  .meta({ id: 'Me' });
export type MeDto = z.infer<typeof meSchema>;

export const updateMeBodySchema = z.object({ name: plainText(1, 100) });
