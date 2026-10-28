import type { Request } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbOrTx } from '../../db.js';
import type { Logger } from '../../lib/logger.js';

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Never put secrets, tokens, passwords or raw PII here. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Pulls actor and request details from an Express request. */
export const auditContext = (req: Request) => ({
  actorId: req.auth?.user.id ?? null,
  ip: req.ip ?? null,
  userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  requestId: req.requestId,
});

export class AuditService {
  constructor(
    private readonly enabled: boolean,
    private readonly logger: Logger,
  ) {}

  /** Pass a transaction client so the audit row commits or rolls back together with the change it describes. */
  async record(db: DbOrTx, event: AuditEvent): Promise<void> {
    if (!this.enabled) return;
    try {
      await db.auditLog.create({
        data: {
          action: event.action,
          actorId: event.actorId ?? null,
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          metadata: (event.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
          requestId: event.requestId ?? null,
        },
      });
    } catch (err) {
      // Inside a transaction a failed insert aborts it anyway; outside, an audit failure must not hide the real result.
      this.logger.error({ err, action: event.action }, 'audit write failed');
      throw err;
    }
  }
}
