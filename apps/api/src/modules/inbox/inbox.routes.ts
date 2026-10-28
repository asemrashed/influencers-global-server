import { Router } from 'express';
import {
  idParamSchema,
  inboxMessageSchema,
  inboxThreadDetailSchema,
  inboxThreadListQuerySchema,
  inboxThreadPageSchema,
  inboxThreadSchema,
  notificationPageSchema,
  notificationSchema,
  okSchema,
  paginationQuerySchema,
  publicInquirySubmissionSchema,
  sendInboxReplySchema,
  unreadCountSchema,
  updateThreadSchema,
} from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { scopeWhere, withScope } from '../../lib/scope.js';
import { sanitizeRichText } from '../../lib/sanitize.js';
import { errors } from '../../lib/errors.js';

export function inboxRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  // ───────────── Public Inquiries (Bot-protected, Rate-limited) ─────────────

  route(
    {
      method: 'post',
      path: '/api/v1/public/inquiries',
      operationId: 'submitPublicInquiry',
      tags: ['Public', 'Inbox'],
      summary: 'Submit public collaboration or booking inquiry',
      description: 'Public form submission. Rate limited and protected by honeypot.',
      access: { type: 'public', reason: 'Public booking and collaboration submission' },
      rateLimit: 'public-form',
      csrf: false,
      body: publicInquirySubmissionSchema,
      response: { status: 201, schema: okSchema },
    },
    async ({ body }) => {
      // Honeypot bot protection
      if (body.website_hp && body.website_hp.length > 0) {
        // Silently succeed for bots so they don't adapt
        return { ok: true as const };
      }

      // Check if inquiries are allowed
      const profile = await c.db.profile.findFirst();
      if (profile && !profile.allowInquiries) {
        throw errors.forbidden('Inquiries are currently disabled');
      }

      const cleanMessage = sanitizeRichText(body.message);
      const snippet = cleanMessage.length > 100 ? `${cleanMessage.slice(0, 97)}...` : cleanMessage;

      await c.db.$transaction(async (tx) => {
        const thread = await tx.inboxThread.create({
          data: {
            type: 'PUBLIC_INQUIRY',
            status: 'OPEN',
            subject: body.subject,
            snippet,
            senderName: body.name,
            senderEmail: body.email.toLowerCase(),
            brandName: body.brandName,
            unreadCount: 1,
            metadata: {
              budgetRange: body.budgetRange,
              timeline: body.timeline,
            },
          },
        });

        await tx.inboxMessage.create({
          data: {
            threadId: thread.id,
            senderName: body.name,
            senderEmail: body.email.toLowerCase(),
            isFromStaff: false,
            body: cleanMessage,
            attachmentIds: [],
          },
        });
      });

      return { ok: true as const };
    },
  );

  // ───────────── Inbox Threads Management ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/inbox/threads',
      operationId: 'listInboxThreads',
      tags: ['Inbox'],
      summary: 'List inbox threads with filtering',
      access: { type: 'permission', permission: 'inbox.read' },
      query: inboxThreadListQuerySchema,
      response: { status: 200, schema: inboxThreadPageSchema },
    },
    async ({ query, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });

      const where: Prisma.InboxThreadWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
        ...(query.search
          ? {
              OR: [
                { subject: { contains: query.search, mode: 'insensitive' } },
                { senderName: { contains: query.search, mode: 'insensitive' } },
                { senderEmail: { contains: query.search, mode: 'insensitive' } },
                { brandName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const finalWhere = withScope(where as Record<string, unknown>, scopeFilter) as Prisma.InboxThreadWhereInput;
      const rows = await c.db.inboxThread.findMany({
        where: finalWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        subject: t.subject,
        snippet: t.snippet,
        senderName: t.senderName,
        senderEmail: t.senderEmail,
        brandName: t.brandName,
        unreadCount: t.unreadCount,
        assignedUserId: t.assignedUserId,
        metadata: (t.metadata as Record<string, unknown> | null) ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/inbox/threads/{id}',
      operationId: 'getInboxThreadById',
      tags: ['Inbox'],
      summary: 'Get thread details and all messages',
      params: idParamSchema,
      access: { type: 'permission', permission: 'inbox.read' },
      response: { status: 200, schema: inboxThreadDetailSchema },
    },
    async ({ params, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.InboxThreadWhereInput;

      const thread = await c.db.inboxThread.findFirst({
        where: finalWhere,
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!thread) {
        throw errors.notFound('Thread not found');
      }

      // Mark unread count as read
      if (thread.unreadCount > 0) {
        await c.db.inboxThread.update({
          where: { id: thread.id },
          data: { unreadCount: 0 },
        });
      }

      return {
        id: thread.id,
        type: thread.type,
        status: thread.status,
        subject: thread.subject,
        snippet: thread.snippet,
        senderName: thread.senderName,
        senderEmail: thread.senderEmail,
        brandName: thread.brandName,
        unreadCount: 0,
        assignedUserId: thread.assignedUserId,
        metadata: (thread.metadata as Record<string, unknown> | null) ?? null,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        messages: thread.messages.map((m) => ({
          id: m.id,
          threadId: m.threadId,
          senderId: m.senderId,
          senderName: m.senderName,
          senderEmail: m.senderEmail,
          isFromStaff: m.isFromStaff,
          body: m.body,
          attachmentIds: m.attachmentIds,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/inbox/threads/{id}/messages',
      operationId: 'replyToInboxThread',
      tags: ['Inbox'],
      summary: 'Reply to an inbox thread',
      params: idParamSchema,
      access: { type: 'permission', permission: 'inbox.reply' },
      body: sendInboxReplySchema,
      response: { status: 201, schema: inboxMessageSchema },
    },
    async ({ params, body, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.InboxThreadWhereInput;
      const thread = await c.db.inboxThread.findFirst({ where: finalWhere });
      if (!thread) {
        throw errors.notFound('Thread not found');
      }

      const cleanBody = sanitizeRichText(body.body);
      const message = await c.db.$transaction(async (tx) => {
        const msg = await tx.inboxMessage.create({
          data: {
            threadId: thread.id,
            senderId: auth.user.id,
            senderName: auth.user.name,
            senderEmail: auth.user.email,
            isFromStaff: true,
            body: cleanBody,
            attachmentIds: body.attachmentIds,
          },
        });

        await tx.inboxThread.update({
          where: { id: thread.id },
          data: {
            status: 'WAITING',
            snippet: cleanBody.length > 100 ? `${cleanBody.slice(0, 97)}...` : cleanBody,
            updatedAt: new Date(),
          },
        });

        return msg;
      });

      return {
        id: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        isFromStaff: message.isFromStaff,
        body: message.body,
        attachmentIds: message.attachmentIds,
        createdAt: message.createdAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/inbox/threads/{id}',
      operationId: 'updateInboxThread',
      tags: ['Inbox'],
      summary: 'Update thread status or assigned user',
      params: idParamSchema,
      access: { type: 'permission', permission: 'inbox.reply' },
      body: updateThreadSchema,
      response: { status: 200, schema: inboxThreadSchema },
    },
    async ({ params, body, auth, scope }) => {
      const scopeFilter = scopeWhere(scope, {
        userId: auth.user.id,
        ownField: 'assignedUserId',
        assigned: (userId) => ({ assignedUserId: userId }),
      });
      const finalWhere = withScope({ id: params.id }, scopeFilter) as Prisma.InboxThreadWhereInput;
      const thread = await c.db.inboxThread.findFirst({ where: finalWhere });
      if (!thread) {
        throw errors.notFound('Thread not found');
      }

      const updated = await c.db.inboxThread.update({
        where: { id: thread.id },
        data: body,
      });

      return {
        id: updated.id,
        type: updated.type,
        status: updated.status,
        subject: updated.subject,
        snippet: updated.snippet,
        senderName: updated.senderName,
        senderEmail: updated.senderEmail,
        brandName: updated.brandName,
        unreadCount: updated.unreadCount,
        assignedUserId: updated.assignedUserId,
        metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ───────────── Notifications ─────────────

  route(
    {
      method: 'get',
      path: '/api/v1/notifications',
      operationId: 'listMyNotifications',
      tags: ['Notifications'],
      summary: 'List notifications for current user',
      access: { type: 'authenticated' },
      query: paginationQuerySchema,
      response: { status: 200, schema: notificationPageSchema },
    },
    async ({ query, auth }) => {
      const rows = await c.db.notification.findMany({
        where: { userId: auth.user.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(rows, query.limit, (n) => ({
        id: n.id,
        userId: n.userId,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        metadata: (n.metadata as Record<string, unknown> | null) ?? null,
        createdAt: n.createdAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/notifications/unread-count',
      operationId: 'getUnreadNotificationCount',
      tags: ['Notifications'],
      summary: 'Get total unread notifications count',
      access: { type: 'authenticated' },
      response: { status: 200, schema: unreadCountSchema },
    },
    async ({ auth }) => {
      const count = await c.db.notification.count({
        where: { userId: auth.user.id, readAt: null },
      });
      return { unreadCount: count };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/notifications/{id}/read',
      operationId: 'markNotificationAsRead',
      tags: ['Notifications'],
      summary: 'Mark notification as read',
      params: idParamSchema,
      access: { type: 'authenticated' },
      response: { status: 200, schema: notificationSchema },
    },
    async ({ params, auth }) => {
      const notif = await c.db.notification.findFirst({
        where: { id: params.id, userId: auth.user.id },
      });
      if (!notif) {
        throw errors.notFound('Notification not found');
      }

      const updated = await c.db.notification.update({
        where: { id: notif.id },
        data: { readAt: new Date() },
      });

      return {
        id: updated.id,
        userId: updated.userId,
        title: updated.title,
        body: updated.body,
        link: updated.link,
        readAt: updated.readAt ? updated.readAt.toISOString() : null,
        metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );

  return router;
}
