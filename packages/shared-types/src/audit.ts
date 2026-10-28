import { z } from 'zod';
import { isoDateTime, pageOf, paginationQuerySchema } from './common.js';

export const auditLogSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    actorId: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    ip: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: isoDateTime,
  })
  .meta({ id: 'AuditLog' });
export type AuditLogDto = z.infer<typeof auditLogSchema>;

export const auditLogPageSchema = pageOf(auditLogSchema, 'AuditLogPage');
export const auditLogListQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(100).optional(),
  actorId: z.string().optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
