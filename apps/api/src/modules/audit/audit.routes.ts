import { Router } from 'express';
import { auditLogListQuerySchema, auditLogPageSchema } from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';

export function auditRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/api/v1/audit-logs', operationId: 'listAuditLogs', tags: ['Audit'], summary: 'Search the audit log',
      description: 'Append-only record of security-relevant actions, newest first.',
      access: { type: 'permission', permission: 'audit.read' }, query: auditLogListQuerySchema, response: { status: 200, schema: auditLogPageSchema },
    },
    async ({ query }) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      };
      const rows = await c.db.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(query) });
      return toPage(rows, query.limit, (r) => ({
        id: r.id, action: r.action, actorId: r.actorId, entityType: r.entityType, entityId: r.entityId,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null, ip: r.ip, requestId: r.requestId, createdAt: r.createdAt.toISOString(),
      }));
    },
  );
  return router;
}
