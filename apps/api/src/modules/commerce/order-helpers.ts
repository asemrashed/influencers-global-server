import { randomBytes } from 'node:crypto';
import type { Scope } from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import { errors } from '../../lib/errors.js';

/** Everything an order response needs. */
export const orderInclude = { items: true, shipments: true, returns: true } as const;
export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Maps an order row to the API shape (ISO dates, JSON columns typed). One mapper, so no endpoint can drift. */
export function orderDto(o: OrderWithRelations) {
  return {
    ...o,
    shippingAddress: o.shippingAddress as Record<string, unknown>,
    paymentDetails: o.paymentDetails as Record<string, unknown> | null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: o.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
    shipments: o.shipments.map((s) => ({
      ...s,
      shippedAt: s.shippedAt?.toISOString() ?? null,
      deliveredAt: s.deliveredAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    returns: o.returns.map((r) => ({
      ...r,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/**
 * Enforces the `assigned` scope on a single order. An order assigned to someone else is reported as
 * not found, so a Manager cannot learn which order ids exist.
 */
export function assertOrderInScope(scope: Scope | undefined, order: { assignedUserId: string | null }, userId: string): void {
  if (scope === 'assigned' && order.assignedUserId !== userId) throw errors.notFound('Order');
}

/** Unguessable, collision-resistant, still readable on a parcel label. */
export function newOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
