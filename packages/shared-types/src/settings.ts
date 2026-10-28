import { z } from 'zod';
import { emailSchema, plainText } from './common.js';

function isTimeZone(v: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Known setting keys and their value schemas. Unknown keys are rejected. */
export const SETTING_SCHEMAS = {
  'site.name': plainText(1, 100),
  'site.timezone': z.string().refine(isTimeZone, 'Unknown IANA time zone'),
  'site.supportEmail': emailSchema,
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;

export const settingsSchema = z
  .object({
    'site.name': z.string().nullable(),
    'site.timezone': z.string().nullable(),
    'site.supportEmail': z.string().nullable(),
  })
  .meta({ id: 'Settings' });
export type SettingsDto = z.infer<typeof settingsSchema>;

export const updateSettingsBodySchema = z
  .object({
    'site.name': SETTING_SCHEMAS['site.name'].optional(),
    'site.timezone': SETTING_SCHEMAS['site.timezone'].optional(),
    'site.supportEmail': SETTING_SCHEMAS['site.supportEmail'].optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one setting');

/** Feature modules that can be switched off per client. Core modules (auth, users, roles, settings, audit) cannot. */
export const MODULE_KEYS = [
  'profile', 'contacts', 'inbox', 'support', 'proposals', 'campaigns', 'deliverables', 'agreements',
  'meetings', 'events', 'pr', 'content', 'social', 'analytics', 'earnings', 'customers', 'products',
  'orders', 'workflows', 'ai', 'reports',
] as const;
export const moduleKeySchema = z.enum(MODULE_KEYS).meta({ id: 'ModuleKey' });
export type ModuleKey = z.infer<typeof moduleKeySchema>;

export const moduleToggleSchema = z
  .object({ key: moduleKeySchema, enabled: z.boolean() })
  .meta({ id: 'ModuleToggle' });
export const moduleListSchema = z.object({ items: z.array(moduleToggleSchema) }).meta({ id: 'ModuleList' });
export const moduleParamSchema = z.object({ key: moduleKeySchema });
export const updateModuleBodySchema = z.object({ enabled: z.boolean() });
