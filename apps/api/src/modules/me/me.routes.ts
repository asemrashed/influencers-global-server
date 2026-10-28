import { Router } from 'express';
import { meSchema, updateMeBodySchema } from '@platform/shared-types';
import type { Container } from '../../container.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { auditContext } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';

async function buildMe(c: Container, auth: AuthContext) {
  const pending = auth.twoFactorRequired && !auth.session.twoFactorVerified;
  return {
    user: { id: auth.user.id, email: auth.user.email, name: auth.user.name, twoFactorEnabled: auth.user.twoFactorEnabled },
    roles: auth.roles.map((r) => ({ id: r.id, key: r.key, name: r.name })),
    // Nothing is granted until two-factor is complete, so a pending session cannot be used to map the system.
    permissions: pending ? [] : [...auth.permissions].map(([permission, scope]) => ({ permission, scope })).sort((a, b) => a.permission.localeCompare(b.permission)),
    modules: pending ? [] : await c.modules.list(),
    session: { twoFactorVerified: auth.session.twoFactorVerified, twoFactorRequired: auth.twoFactorRequired, csrfToken: auth.session.csrfToken },
  };
}

export function meRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/me', operationId: 'getMe', tags: ['Me'], summary: 'Who am I? Effective permissions, enabled modules and CSRF token',
      description: 'Call after sign-in and on app start. Use `permissions` and `modules` to shape navigation; the server enforces them regardless.',
      access: { type: 'pending-2fa' }, response: { status: 200, schema: meSchema },
    },
    ({ auth }) => buildMe(c, auth),
  );

  route(
    {
      method: 'patch', path: '/api/v1/me', operationId: 'updateMe', tags: ['Me'], summary: 'Update your display name',
      access: { type: 'authenticated' }, body: updateMeBodySchema, response: { status: 200, schema: meSchema },
    },
    async ({ auth, body, req }) => {
      await c.db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: auth.user.id }, data: { name: body.name } });
        await c.audit.record(tx, { action: 'users.updated', ...auditContext(req), entityType: 'User', entityId: auth.user.id, metadata: { fields: ['name'], self: true } });
      });
      return buildMe(c, { ...auth, user: { ...auth.user, name: body.name } });
    },
  );
  return router;
}
