import { Router } from 'express';
import {
  addTicketReplySchema,
  createSupportTicketSchema,
  idParamSchema,
  supportTicketDetailSchema,
  supportTicketListQuerySchema,
  supportTicketPageSchema,
  supportTicketReplySchema,
  supportTicketSchema,
  updateSupportTicketSchema,
} from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';
import { sendNotificationEmail } from '../../lib/notifications.js';

export function supportRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get',
      path: '/api/v1/support/tickets',
      operationId: 'listSupportTickets',
      tags: ['Support'],
      summary: 'List support tickets with scope filtering',
      access: { type: 'permission', permission: 'support.read' },
      query: supportTicketListQuerySchema,
      response: { status: 200, schema: supportTicketPageSchema },
    },
    async ({ query, auth, scope }) => {
      // Matrix: Super Admin & Admin have all, Manager has own (tickets they created)
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'requesterId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.SupportTicketWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
        ...(query.search
          ? {
              OR: [
                { subject: { contains: query.search, mode: 'insensitive' } },
                { requesterName: { contains: query.search, mode: 'insensitive' } },
                { requesterEmail: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.SupportTicketWhereInput;
      const rows = await c.db.supportTicket.findMany({
        where: finalWhere,
        include: { _count: { select: { replies: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        requesterEmail: t.requesterEmail,
        requesterName: t.requesterName,
        requesterId: t.requesterId,
        assignedUserId: t.assignedUserId,
        replyCount: t._count.replies,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/support/tickets',
      operationId: 'createSupportTicket',
      tags: ['Support'],
      summary: 'Create a new support ticket',
      access: { type: 'permission', permission: 'support.write' },
      body: createSupportTicketSchema,
      response: { status: 201, schema: supportTicketSchema },
    },
    async ({ body, auth }) => {
      const cleanMessage = sanitizeRichText(body.message);
      const requesterName = body.requesterName ?? auth.user.name;
      const requesterEmail = (body.requesterEmail ?? auth.user.email).toLowerCase();

      const ticket = await c.db.$transaction(async (tx) => {
        const t = await tx.supportTicket.create({
          data: {
            subject: body.subject,
            category: body.category,
            priority: body.priority,
            status: 'OPEN',
            requesterName,
            requesterEmail,
            requesterId: auth.user.id,
          },
        });

        await tx.supportTicketReply.create({
          data: {
            ticketId: t.id,
            authorId: auth.user.id,
            authorName: requesterName,
            authorEmail: requesterEmail,
            isStaff: false,
            message: cleanMessage,
            attachmentIds: [],
          },
        });

        return t;
      });

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        requesterEmail: ticket.requesterEmail,
        requesterName: ticket.requesterName,
        requesterId: ticket.requesterId,
        assignedUserId: ticket.assignedUserId,
        replyCount: 1,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/support/tickets/{id}',
      operationId: 'getSupportTicketById',
      tags: ['Support'],
      summary: 'Get ticket details and replies',
      params: idParamSchema,
      access: { type: 'permission', permission: 'support.read' },
      response: { status: 200, schema: supportTicketDetailSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'requesterId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.SupportTicketWhereInput;

      const ticket = await c.db.supportTicket.findFirst({
        where: finalWhere,
        include: {
          replies: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!ticket) {
        throw errors.notFound('Ticket not found');
      }

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        requesterEmail: ticket.requesterEmail,
        requesterName: ticket.requesterName,
        requesterId: ticket.requesterId,
        assignedUserId: ticket.assignedUserId,
        replyCount: ticket.replies.length,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        replies: ticket.replies.map((r) => ({
          id: r.id,
          ticketId: r.ticketId,
          authorId: r.authorId,
          authorName: r.authorName,
          authorEmail: r.authorEmail,
          isStaff: r.isStaff,
          message: r.message,
          attachmentIds: r.attachmentIds,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/support/tickets/{id}/replies',
      operationId: 'replyToSupportTicket',
      tags: ['Support'],
      summary: 'Post a reply to a support ticket',
      params: idParamSchema,
      access: { type: 'permission', permission: 'support.write' },
      body: addTicketReplySchema,
      response: { status: 201, schema: supportTicketReplySchema },
    },
    async ({ params, body, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'requesterId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.SupportTicketWhereInput;
      const ticket = await c.db.supportTicket.findFirst({ where: finalWhere });
      if (!ticket) {
        throw errors.notFound('Ticket not found');
      }

      const cleanMessage = sanitizeRichText(body.message);
      const isStaffUser = auth.roles.some((r) => r.key === 'super_admin' || r.key === 'admin');

      const reply = await c.db.$transaction(async (tx) => {
        const rep = await tx.supportTicketReply.create({
          data: {
            ticketId: ticket.id,
            authorId: auth.user.id,
            authorName: auth.user.name,
            authorEmail: auth.user.email,
            isStaff: isStaffUser,
            message: cleanMessage,
            attachmentIds: body.attachmentIds,
          },
        });

        // Update ticket status
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status: isStaffUser ? 'WAITING_CUSTOMER' : 'IN_PROGRESS',
            updatedAt: new Date(),
          },
        });

        return rep;
      });

      // Send email notification for ticket reply if email is configured
      // If staff replied, notify requester. If requester/customer replied, notify assigned user or requester
      const recipient = isStaffUser
        ? ticket.requesterEmail
        : (ticket.assignedUserId
            ? (await c.db.user.findUnique({ where: { id: ticket.assignedUserId }, select: { email: true } }))?.email
            : null) ?? ticket.requesterEmail;

      if (recipient && recipient !== auth.user.email) {
        await sendNotificationEmail(
          c,
          {
            to: recipient,
            subject: `New reply on ticket #${ticket.ticketNumber}: ${ticket.subject}`,
            text: `${auth.user.name} wrote:\n\n${cleanMessage}`,
          },
          `notif:ticket-reply:${reply.id}`,
        );
      }

      return {
        id: reply.id,
        ticketId: reply.ticketId,
        authorId: reply.authorId,
        authorName: reply.authorName,
        authorEmail: reply.authorEmail,
        isStaff: reply.isStaff,
        message: reply.message,
        attachmentIds: reply.attachmentIds,
        createdAt: reply.createdAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/support/tickets/{id}',
      operationId: 'updateSupportTicket',
      tags: ['Support'],
      summary: 'Update ticket status, priority, or assignment',
      params: idParamSchema,
      access: { type: 'permission', permission: 'support.write' },
      body: updateSupportTicketSchema,
      response: { status: 200, schema: supportTicketSchema },
    },
    async ({ params, body, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'requesterId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.SupportTicketWhereInput;
      const ticket = await c.db.supportTicket.findFirst({
        where: finalWhere,
        include: { _count: { select: { replies: true } } },
      });
      if (!ticket) {
        throw errors.notFound('Ticket not found');
      }

      const updated = await c.db.supportTicket.update({
        where: { id: ticket.id },
        data: body,
      });

      return {
        id: updated.id,
        ticketNumber: updated.ticketNumber,
        subject: updated.subject,
        category: updated.category,
        priority: updated.priority,
        status: updated.status,
        requesterEmail: updated.requesterEmail,
        requesterName: updated.requesterName,
        requesterId: updated.requesterId,
        assignedUserId: updated.assignedUserId,
        replyCount: ticket._count.replies,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  return router;
}
