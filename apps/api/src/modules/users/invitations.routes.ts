import { Router } from 'express';
import {
  createInvitationBodySchema, createInvitationResponseSchema, idParamSchema, invitationListQuerySchema, invitationPageSchema,
} from '@platform/shared-types';
import type { Container } from '../../container.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { errors } from '../../lib/errors.js';
import { issueToken } from '../../lib/mailer.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { auditContext } from '../audit/audit.service.js';
import { INVITE_TTL } from '../auth/auth.service.js';
import { assertCanAssignRole } from '../roles/access.js';

const tags = ['Invitations'];

type InvitationRow = Prisma.InvitationGetPayload<object>;

function statusOf(i: InvitationRow): 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' {
  if (i.acceptedAt) return 'ACCEPTED';
  if (i.revokedAt) return 'REVOKED';
  return i.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING';
}

async function toDtos(c: Container, rows: InvitationRow[]) {
  const roleIds = [...new Set(rows.flatMap((r) => r.roleIds))];
  const roles = new Map((await c.db.role.findMany({ where: { id: { in: roleIds } } })).map((r) => [r.id, r]));
  return rows.map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    roles: i.roleIds.flatMap((id) => {
      const r = roles.get(id);
      return r ? [{ id: r.id, key: r.key, name: r.name }] : [];
    }),
    status: statusOf(i),
    expiresAt: i.expiresAt.toISOString(),
    createdById: i.createdById,
    createdAt: i.createdAt.toISOString(),
  }));
}

/** Inviter-visible rows. Scope `own` limits to invitations the caller created. */
const visible = (scope: Parameters<typeof scopeWhere>[0], userId: string) => scopeWhere(scope, { userId, ownField: 'createdById' });

export function invitationsRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/invitations', operationId: 'listInvitations', tags, summary: 'List invitations',
      description: 'Scope `own` returns only invitations the caller created.',
      access: { type: 'permission', permission: 'users.invite' }, query: invitationListQuerySchema, response: { status: 200, schema: invitationPageSchema },
    },
    async ({ query, auth, scope }) => {
      const now = new Date();
      const statusWhere: Prisma.InvitationWhereInput =
        query.status === 'ACCEPTED' ? { acceptedAt: { not: null } }
        : query.status === 'REVOKED' ? { acceptedAt: null, revokedAt: { not: null } }
        : query.status === 'EXPIRED' ? { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } }
        : query.status === 'PENDING' ? { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }
        : {};
      const rows = await c.db.invitation.findMany({
        where: { AND: [visible(scope, auth.user.id), statusWhere] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });
      const page = toPage(rows, query.limit, (r) => r);
      const dtos = await toDtos(c, page.items);
      return { items: dtos, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
  );

  route(
    {
      method: 'post', path: '/api/v1/invitations', operationId: 'createInvitation', tags, summary: 'Invite someone',
      description: 'Valid for 7 days, single use. Emails the link when email is configured; otherwise the token is returned once (`issued.delivery = manual`). Re-inviting the same address revokes the earlier pending invitation.',
      access: { type: 'permission', permission: 'users.invite' }, body: createInvitationBodySchema, response: { status: 201, schema: createInvitationResponseSchema },
      errors: ['CONFLICT', 'PERMISSION_ESCALATION'],
    },
    async ({ body, auth, req }) => {
      for (const id of new Set(body.roleIds)) await assertCanAssignRole(c.db, auth, id);
      if (await c.db.user.findUnique({ where: { email: body.email } })) throw errors.conflict('An account with this email already exists');

      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + INVITE_TTL);
      const row = await c.db.$transaction(async (tx) => {
        await tx.invitation.updateMany({ where: { email: body.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        const created = await tx.invitation.create({
          data: { email: body.email, name: body.name ?? null, tokenHash: sha256(token), roleIds: [...new Set(body.roleIds)], expiresAt, createdById: auth.user.id },
        });
        await c.audit.record(tx, { action: 'auth.invitation.created', ...auditContext(req), entityType: 'Invitation', entityId: created.id, metadata: { roleIds: created.roleIds } });
        return created;
      });
      const issued = await issueToken(c, {
        to: body.email, subject: `You are invited to ${c.env.APP_NAME}`, path: '/accept-invite', token, expiresAt,
        text: (link) => `You have been invited to ${c.env.APP_NAME}. Accept within 7 days:\n${link}`,
      });
      const [dto] = await toDtos(c, [row]);
      return { invitation: dto!, issued };
    },
  );

  route(
    {
      method: 'post', path: '/api/v1/invitations/{id}/revoke', operationId: 'revokeInvitation', tags, summary: 'Revoke a pending invitation',
      access: { type: 'permission', permission: 'users.invite' }, params: idParamSchema, response: { status: 204 }, errors: ['NOT_FOUND', 'CONFLICT'],
    },
    async ({ params, auth, scope, req }) => {
      const row = await c.db.invitation.findFirst({ where: withScope({ id: params.id }, visible(scope, auth.user.id)) });
      if (!row) throw errors.notFound('Invitation');
      if (statusOf(row) !== 'PENDING') throw errors.conflict('Only pending invitations can be revoked');
      await c.db.$transaction(async (tx) => {
        await tx.invitation.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
        await c.audit.record(tx, { action: 'auth.invitation.revoked', ...auditContext(req), entityType: 'Invitation', entityId: row.id });
      });
    },
  );

  return router;
}
