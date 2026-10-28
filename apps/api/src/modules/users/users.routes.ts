import { Router } from 'express';
import {
  idParamSchema, manualDeliverySchema, setUserRolesBodySchema, updateUserBodySchema, userListQuerySchema, userPageSchema, userSchema,
} from '@platform/shared-types';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { errors } from '../../lib/errors.js';
import { auditContext } from '../audit/audit.service.js';
import { destroyUserSessions } from '../auth/session.service.js';
import { issueResetForUser } from '../auth/auth.service.js';
import { assertCanManage, getUserOrThrow, setRoles, setStatus, toUserDto, userInclude } from './users.service.js';

const tags = ['Users'];

export function usersRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/users', operationId: 'listUsers', tags, summary: 'List users',
      description: 'Scope `own` returns only the caller.',
      access: { type: 'permission', permission: 'users.read' }, query: userListQuerySchema, response: { status: 200, schema: userPageSchema },
    },
    async ({ query, auth, scope }) => {
      const where = {
        deletedAt: null,
        AND: [scopeWhere(scope, { userId: auth.user.id, ownField: 'id' })],
        ...(query.status ? { status: query.status } : {}),
        ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { email: { contains: query.q, mode: 'insensitive' as const } }] } : {}),
      };
      const rows = await c.db.user.findMany({ where, include: userInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(query) });
      return toPage(rows, query.limit, toUserDto);
    },
  );

  route(
    {
      method: 'get', path: '/api/v1/users/{id}', operationId: 'getUser', tags, summary: 'Get a user',
      access: { type: 'permission', permission: 'users.read' }, params: idParamSchema, response: { status: 200, schema: userSchema }, errors: ['NOT_FOUND'],
    },
    async ({ params, auth, scope }) => {
      // Out-of-scope records look exactly like missing ones.
      const row = await c.db.user.findFirst({ where: withScope({ id: params.id, deletedAt: null }, scopeWhere(scope, { userId: auth.user.id, ownField: 'id' })), include: userInclude });
      if (!row) throw errors.notFound('User');
      return toUserDto(row);
    },
  );

  route(
    {
      method: 'patch', path: '/api/v1/users/{id}', operationId: 'updateUser', tags, summary: 'Rename a user',
      access: { type: 'permission', permission: 'users.write' }, params: idParamSchema, body: updateUserBodySchema, response: { status: 200, schema: userSchema },
      errors: ['NOT_FOUND', 'FORBIDDEN'],
    },
    async ({ params, body, auth, req }) =>
      c.db.$transaction(async (tx) => {
        const target = await getUserOrThrow(tx, params.id);
        assertCanManage(auth, target);
        await tx.user.update({ where: { id: params.id }, data: { name: body.name } });
        await c.audit.record(tx, { action: 'users.updated', ...auditContext(req), entityType: 'User', entityId: params.id, metadata: { fields: ['name'] } });
        return toUserDto(await getUserOrThrow(tx, params.id));
      }),
  );

  route(
    {
      method: 'put', path: '/api/v1/users/{id}/roles', operationId: 'setUserRoles', tags, summary: 'Replace a user\'s roles',
      description: 'You can only assign roles whose permissions you hold yourself. Only a Super Admin can add or remove the Super Admin role, and the last active Super Admin cannot be demoted.',
      access: { type: 'permission', permission: 'users.write' }, params: idParamSchema, body: setUserRolesBodySchema, response: { status: 200, schema: userSchema },
      errors: ['NOT_FOUND', 'FORBIDDEN', 'PERMISSION_ESCALATION', 'LAST_SUPER_ADMIN'],
    },
    async ({ params, body, auth, req }) => toUserDto(await setRoles(c, req, auth, params.id, body.roleIds)),
  );

  route(
    {
      method: 'post', path: '/api/v1/users/{id}/revoke', operationId: 'revokeUser', tags, summary: 'Disable a user and end all their sessions',
      access: { type: 'permission', permission: 'users.revoke' }, params: idParamSchema, response: { status: 200, schema: userSchema },
      errors: ['NOT_FOUND', 'FORBIDDEN', 'LAST_SUPER_ADMIN', 'CONFLICT'],
    },
    async ({ params, auth, req }) => toUserDto(await setStatus(c, req, auth, params.id, 'DISABLED')),
  );

  route(
    {
      method: 'post', path: '/api/v1/users/{id}/reactivate', operationId: 'reactivateUser', tags, summary: 'Re-enable a disabled user',
      access: { type: 'permission', permission: 'users.revoke' }, params: idParamSchema, response: { status: 200, schema: userSchema }, errors: ['NOT_FOUND', 'FORBIDDEN'],
    },
    async ({ params, auth, req }) => toUserDto(await setStatus(c, req, auth, params.id, 'ACTIVE')),
  );

  route(
    {
      method: 'post', path: '/api/v1/users/{id}/password-reset', operationId: 'issuePasswordReset', tags, summary: 'Issue a password reset link for a user',
      description: 'Emails the link when email is configured; otherwise returns the token once (`delivery: manual`).',
      access: { type: 'permission', permission: 'users.write' }, params: idParamSchema, response: { status: 200, schema: manualDeliverySchema }, errors: ['NOT_FOUND', 'FORBIDDEN'],
    },
    async ({ params, auth, req }) => {
      const target = await getUserOrThrow(c.db, params.id);
      assertCanManage(auth, target);
      const issued = await issueResetForUser(c, target.id, target.email);
      await c.audit.record(c.db, { action: 'users.password_reset_issued', ...auditContext(req), entityType: 'User', entityId: target.id, metadata: { delivery: issued.delivery } });
      return issued;
    },
  );

  route(
    {
      method: 'post', path: '/api/v1/users/{id}/two-factor/reset', operationId: 'resetUserTwoFactor', tags, summary: 'Remove a user\'s two-factor enrollment (lost device)',
      description: 'The user must enroll again at next sign-in. All their sessions end.',
      access: { type: 'permission', permission: 'users.write' }, params: idParamSchema, response: { status: 204 }, errors: ['NOT_FOUND', 'FORBIDDEN'],
    },
    async ({ params, auth, req }) => {
      await c.db.$transaction(async (tx) => {
        const target = await getUserOrThrow(tx, params.id);
        assertCanManage(auth, target);
        await tx.user.update({ where: { id: target.id }, data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorPendingSecretEnc: null, twoFactorLastStep: null, recoveryCodeHashes: [] } });
        await destroyUserSessions(tx, target.id);
        await c.audit.record(tx, { action: 'users.two_factor_reset', ...auditContext(req), entityType: 'User', entityId: target.id });
      });
    },
  );

  return router;
}
