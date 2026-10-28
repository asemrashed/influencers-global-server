import { Router } from 'express';
import {
  moduleListSchema, moduleParamSchema, moduleToggleSchema, settingsSchema, SETTING_SCHEMAS, updateModuleBodySchema, updateSettingsBodySchema,
  type SettingKey, type SettingsDto,
} from '@platform/shared-types';
import type { Container } from '../../container.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { auditContext } from '../audit/audit.service.js';

const tags = ['Settings'];
const KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

async function readSettings(c: Container): Promise<SettingsDto> {
  const rows = await c.db.setting.findMany({ where: { key: { in: KEYS } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, string | null>;
  for (const k of KEYS) {
    const parsed = SETTING_SCHEMAS[k].safeParse(byKey.get(k));
    out[k] = parsed.success ? (parsed.data as string) : null;
  }
  return out;
}

export function settingsRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/settings', operationId: 'getSettings', tags, summary: 'Get site settings',
      access: { type: 'permission', permission: 'settings.read' }, response: { status: 200, schema: settingsSchema },
    },
    () => readSettings(c),
  );

  route(
    {
      method: 'put', path: '/api/v1/settings', operationId: 'updateSettings', tags, summary: 'Update site settings',
      description: 'Send only the keys to change. Unknown keys are rejected.',
      access: { type: 'permission', permission: 'settings.write' }, body: updateSettingsBodySchema, response: { status: 200, schema: settingsSchema },
    },
    async ({ body, auth, req }) => {
      await c.db.$transaction(async (tx) => {
        for (const [key, value] of Object.entries(body)) {
          await tx.setting.upsert({
            where: { key },
            create: { key, value: value as Prisma.InputJsonValue, updatedById: auth.user.id },
            update: { value: value as Prisma.InputJsonValue, updatedById: auth.user.id },
          });
        }
        await c.audit.record(tx, { action: 'settings.updated', ...auditContext(req), entityType: 'Setting', metadata: { keys: Object.keys(body) } });
      });
      return readSettings(c);
    },
  );

  route(
    {
      method: 'get', path: '/api/v1/modules', operationId: 'listModules', tags, summary: 'List feature modules and whether they are enabled',
      access: { type: 'permission', permission: 'settings.read' }, response: { status: 200, schema: moduleListSchema },
    },
    async () => ({ items: await c.modules.list() }),
  );

  route(
    {
      method: 'patch', path: '/api/v1/modules/{key}', operationId: 'setModuleEnabled', tags, summary: 'Enable or disable a feature module',
      description: 'A disabled module\'s endpoints respond with MODULE_DISABLED. Core modules (auth, users, roles, settings, audit) cannot be disabled.',
      access: { type: 'permission', permission: 'settings.write' }, params: moduleParamSchema, body: updateModuleBodySchema, response: { status: 200, schema: moduleToggleSchema },
    },
    async ({ params, body, auth, req }) => {
      await c.db.$transaction(async (tx) => {
        await tx.moduleToggle.upsert({
          where: { key: params.key },
          create: { key: params.key, enabled: body.enabled, updatedById: auth.user.id },
          update: { enabled: body.enabled, updatedById: auth.user.id },
        });
        await c.audit.record(tx, { action: 'modules.toggled', ...auditContext(req), entityType: 'ModuleToggle', entityId: params.key, metadata: { enabled: body.enabled } });
      });
      c.modules.invalidate();
      return { key: params.key, enabled: body.enabled };
    },
  );

  return router;
}
