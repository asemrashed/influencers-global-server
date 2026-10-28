import { Router } from 'express';
import {
  contactListQuerySchema,
  contactPageSchema,
  contactSchema,
  createContactSchema,
  idParamSchema,
  okSchema,
  updateContactSchema,
} from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function contactsRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get',
      path: '/api/v1/contacts',
      operationId: 'listContacts',
      tags: ['Contacts'],
      summary: 'List contacts with filters and search',
      access: { type: 'permission', permission: 'contacts.read' },
      query: contactListQuerySchema,
      response: { status: 200, schema: contactPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.ContactWhereInput = {
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { organization: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.organization ? { organization: { equals: query.organization, mode: 'insensitive' } } : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.ContactWhereInput;
      const rows = await c.db.contact.findMany({
        where: finalWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        organization: row.organization,
        roleOrTitle: row.roleOrTitle,
        notes: row.notes,
        tags: row.tags,
        assignedUserId: row.assignedUserId,
        createdById: row.createdById,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/contacts',
      operationId: 'createContact',
      tags: ['Contacts'],
      summary: 'Create a new contact',
      access: { type: 'permission', permission: 'contacts.write' },
      body: createContactSchema,
      response: { status: 201, schema: contactSchema },
    },
    async ({ body, auth }) => {
      const contact = await c.db.contact.create({
        data: {
          ...body,
          notes: body.notes ? sanitizeRichText(body.notes) : body.notes,
          createdById: auth.user.id,
        },
      });
      return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        organization: contact.organization,
        roleOrTitle: contact.roleOrTitle,
        notes: contact.notes,
        tags: contact.tags,
        assignedUserId: contact.assignedUserId,
        createdById: contact.createdById,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/contacts/{id}',
      operationId: 'getContactById',
      tags: ['Contacts'],
      summary: 'Get contact by ID',
      params: idParamSchema,
      access: { type: 'permission', permission: 'contacts.read' },
      response: { status: 200, schema: contactSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.ContactWhereInput;
      const contact = await c.db.contact.findFirst({ where: finalWhere });
      if (!contact) {
        throw errors.notFound('Contact not found');
      }
      return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        organization: contact.organization,
        roleOrTitle: contact.roleOrTitle,
        notes: contact.notes,
        tags: contact.tags,
        assignedUserId: contact.assignedUserId,
        createdById: contact.createdById,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/contacts/{id}',
      operationId: 'updateContact',
      tags: ['Contacts'],
      summary: 'Update contact details',
      params: idParamSchema,
      access: { type: 'permission', permission: 'contacts.write' },
      body: updateContactSchema,
      response: { status: 200, schema: contactSchema },
    },
    async ({ params, body, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.ContactWhereInput;
      const existing = await c.db.contact.findFirst({ where: finalWhere });
      if (!existing) {
        throw errors.notFound('Contact not found');
      }
      const updated = await c.db.contact.update({
        where: { id: existing.id },
        data: {
          ...body,
          notes: body.notes ? sanitizeRichText(body.notes) : body.notes,
        },
      });
      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        organization: updated.organization,
        roleOrTitle: updated.roleOrTitle,
        notes: updated.notes,
        tags: updated.tags,
        assignedUserId: updated.assignedUserId,
        createdById: updated.createdById,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'delete',
      path: '/api/v1/contacts/{id}',
      operationId: 'deleteContact',
      tags: ['Contacts'],
      summary: 'Delete contact',
      params: idParamSchema,
      access: { type: 'permission', permission: 'contacts.write' },
      response: { status: 200, schema: okSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'createdById',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.ContactWhereInput;
      const existing = await c.db.contact.findFirst({ where: finalWhere });
      if (!existing) {
        throw errors.notFound('Contact not found');
      }
      await c.db.contact.delete({ where: { id: existing.id } });
      return { ok: true as const };
    },
  );

  return router;
}
