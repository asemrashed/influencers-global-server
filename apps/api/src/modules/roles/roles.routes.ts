import { Router } from 'express';
import {
  createRoleBodySchema, idParamSchema, permissionSchema, roleDetailSchema, roleListQuerySchema, rolePageSchema,
  setRolePermissionsBodySchema, updateRoleBodySchema,
} from '@platform/shared-types';
import { z } from 'zod';
import type { Container } from '../../container.js';
import type { DbOrTx } from '../../db.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { errors } from '../../lib/errors.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { auditContext } from '../audit/audit.service.js';
import { assertCanGrant, assertKnownPermissions, SCOPE_FROM_DB, SCOPE_TO_DB } from './access.js';

const tags = ['Roles'];
const roleWithCount = { _count: { select: { users: true } } } satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleWithCount }>;

const toRoleDto = (r: RoleRow) => ({
  id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, isLocked: r.isLocked,
  requireTwoFactor: r.requireTwoFactor, userCount: r._count.users, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

async function detail(db: DbOrTx, id: string) {
  const role = await db.role.findUnique({ where: { id }, include: { ...roleWithCount, permissions: { include: { permission: true } } } });
  if (!role) throw errors.notFound('Role');
  return {
    ...toRoleDto(role),
    permissions: role.permissions
      .map((rp) => ({ permission: rp.permission.key, scope: SCOPE_FROM_DB[rp.scope] ?? ('own' as const) }))
      .sort((a, b) => a.permission.localeCompare(b.permission)),
  };
}

async function writePermissions(c: Container, tx: DbOrTx, roleId: string, grants: { permission: string; scope: 'all' | 'assigned' | 'own' }[]) {
  const perms = await tx.permission.findMany({ where: { key: { in: grants.map((g) => g.permission) } } });
  const idByKey = new Map(perms.map((p) => [p.key, p.id]));
  await tx.rolePermission.deleteMany({ where: { roleId } });
  await tx.rolePermission.createMany({
    data: grants.map((g) => ({ roleId, permissionId: idByKey.get(g.permission)!, scope: SCOPE_TO_DB[g.scope] })),
  });
}

export function rolesRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/permissions', operationId: 'listPermissions', tags, summary: 'List the permission catalog',
      access: { type: 'permission', permission: 'roles.read' }, response: { status: 200, schema: z.object({ items: z.array(permissionSchema) }).meta({ id: 'PermissionList' }) },
    },
    async () => {
      const rows = await c.db.permission.findMany({ orderBy: { key: 'asc' } });
      return { items: rows.map((p) => ({ key: p.key, module: p.module, description: p.description })) };
    },
  );

  route(
    {
      method: 'get', path: '/api/v1/roles', operationId: 'listRoles', tags, summary: 'List roles',
      access: { type: 'permission', permission: 'roles.read' }, query: roleListQuerySchema, response: { status: 200, schema: rolePageSchema },
    },
    async ({ query }) => {
      const rows = await c.db.role.findMany({ include: roleWithCount, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...pageArgs(query) });
      return toPage(rows, query.limit, toRoleDto);
    },
  );

  route(
    {
      method: 'get', path: '/api/v1/roles/{id}', operationId: 'getRole', tags, summary: 'Get a role with its permissions',
      access: { type: 'permission', permission: 'roles.read' }, params: idParamSchema, response: { status: 200, schema: roleDetailSchema }, errors: ['NOT_FOUND'],
    },
    ({ params }) => detail(c.db, params.id),
  );

  route(
    {
      method: 'post', path: '/api/v1/roles', operationId: 'createRole', tags, summary: 'Create a custom role',
      description: 'You cannot grant a permission (or a wider scope) than you hold. Changes apply to users on their next request.',
      access: { type: 'permission', permission: 'roles.manage' }, body: createRoleBodySchema, response: { status: 201, schema: roleDetailSchema },
      errors: ['CONFLICT', 'PERMISSION_ESCALATION'],
    },
    async ({ body, auth, req }) => {
      assertKnownPermissions(body.permissions);
      assertCanGrant(auth, body.permissions);
      if (await c.db.role.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw errors.conflict('A role with this name already exists');
      return c.db.$transaction(async (tx) => {
        const role = await tx.role.create({ data: { name: body.name, description: body.description ?? null, requireTwoFactor: body.requireTwoFactor } });
        await writePermissions(c, tx, role.id, body.permissions);
        await c.audit.record(tx, { action: 'roles.created', ...auditContext(req), entityType: 'Role', entityId: role.id, metadata: { name: role.name, permissions: body.permissions } });
        return detail(tx, role.id);
      });
    },
  );

  route(
    {
      method: 'patch', path: '/api/v1/roles/{id}', operationId: 'updateRole', tags, summary: 'Edit a role\'s name, description or two-factor requirement',
      access: { type: 'permission', permission: 'roles.manage' }, params: idParamSchema, body: updateRoleBodySchema, response: { status: 200, schema: roleDetailSchema },
      errors: ['NOT_FOUND', 'LOCKED_ROLE', 'CONFLICT'],
    },
    async ({ params, body, req }) =>
      c.db.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { id: params.id } });
        if (!role) throw errors.notFound('Role');
        if (role.isLocked) throw errors.lockedRole();
        if (body.name && (await tx.role.findFirst({ where: { id: { not: role.id }, name: { equals: body.name, mode: 'insensitive' } } }))) {
          throw errors.conflict('A role with this name already exists');
        }
        await tx.role.update({
          where: { id: role.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.requireTwoFactor !== undefined ? { requireTwoFactor: body.requireTwoFactor } : {}),
          },
        });
        await c.audit.record(tx, { action: 'roles.updated', ...auditContext(req), entityType: 'Role', entityId: role.id, metadata: { changes: body } });
        return detail(tx, role.id);
      }),
  );

  route(
    {
      method: 'put', path: '/api/v1/roles/{id}/permissions', operationId: 'setRolePermissions', tags, summary: 'Replace a role\'s permissions',
      description: 'Adding a permission requires holding it yourself with at least that scope. Takes effect on affected users\' next request.',
      access: { type: 'permission', permission: 'roles.manage' }, params: idParamSchema, body: setRolePermissionsBodySchema, response: { status: 200, schema: roleDetailSchema },
      errors: ['NOT_FOUND', 'LOCKED_ROLE', 'PERMISSION_ESCALATION'],
    },
    async ({ params, body, auth, req }) => {
      assertKnownPermissions(body.permissions);
      return c.db.$transaction(async (tx) => {
        const before = await detail(tx, params.id);
        if (before.isLocked) throw errors.lockedRole();
        // Only newly added or widened grants need to be covered by the actor; removals are always allowed.
        const had = new Map(before.permissions.map((p) => [p.permission, p.scope]));
        assertCanGrant(auth, body.permissions.filter((g) => had.get(g.permission) !== g.scope));
        await writePermissions(c, tx, params.id, body.permissions);
        await c.audit.record(tx, {
          action: 'roles.permissions.changed', ...auditContext(req), entityType: 'Role', entityId: params.id,
          metadata: { before: before.permissions, after: body.permissions },
        });
        return detail(tx, params.id);
      });
    },
  );

  route(
    {
      method: 'delete', path: '/api/v1/roles/{id}', operationId: 'deleteRole', tags, summary: 'Delete a custom role',
      description: 'System roles cannot be deleted, and neither can a role that still has users.',
      access: { type: 'permission', permission: 'roles.manage' }, params: idParamSchema, response: { status: 204 }, errors: ['NOT_FOUND', 'LOCKED_ROLE', 'CONFLICT'],
    },
    async ({ params, req }) => {
      await c.db.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { id: params.id }, include: roleWithCount });
        if (!role) throw errors.notFound('Role');
        if (role.isLocked) throw errors.lockedRole();
        if (role.isSystem) throw errors.conflict('System roles cannot be deleted');
        if (role._count.users > 0) throw errors.conflict('Reassign this role\'s users before deleting it');
        await tx.role.delete({ where: { id: role.id } });
        await c.audit.record(tx, { action: 'roles.deleted', ...auditContext(req), entityType: 'Role', entityId: role.id, metadata: { name: role.name } });
      });
    },
  );

  return router;
}
