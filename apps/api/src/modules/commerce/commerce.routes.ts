import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  customerSchema,
  createCustomerBodySchema,
  updateCustomerBodySchema,
  productCategorySchema,
  createProductCategoryBodySchema,
  productSchema,
  createProductBodySchema,
  updateProductBodySchema,
  stockAdjustmentBodySchema,
  promoCodeSchema,
  createPromoCodeBodySchema,
  orderSchema,
  checkoutBodySchema,
  updateOrderStatusBodySchema,
  assignOrderBodySchema,
  recordOrderPaymentBodySchema,
  refundOrderBodySchema,
  createShipmentBodySchema,
  createReturnRequestBodySchema,
  decideReturnRequestBodySchema,
  invoiceSchema,
  createInvoiceBodySchema,
  recordInvoicePaymentBodySchema,
  earningEntrySchema,
  createEarningEntryBodySchema,
  earningsSummarySchema,
  pageOf,
  paginationQuerySchema,
} from '@platform/shared-types';
import { errors } from '../../lib/errors.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { fireWorkflowsSafely } from '../ai/workflows.service.js';
import { assertOrderInScope, newOrderNumber, orderDto, orderInclude } from './order-helpers.js';

export function commerceRoutes(kit: RouteKit): Router {
  const router = Router();
  const route = routeFactory(kit, router);
  const { db } = kit.c;

  // ─────────────────────────────────────────────────────────────
  // PUBLIC STOREFRONT & CHECKOUT
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/store/categories',
      operationId: 'listStoreCategories',
      tags: ['Storefront'],
      summary: 'List active storefront categories',
      access: { type: 'public', reason: 'Public storefront category catalog' },
      response: { status: 200, schema: z.array(productCategorySchema) },
    },
    async () => {
      const categories = await db.productCategory.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return categories.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/store/products',
      operationId: 'listStoreProducts',
      tags: ['Storefront'],
      summary: 'List storefront products',
      access: { type: 'public', reason: 'Public storefront category catalog' },
      query: paginationQuerySchema.extend({
        categoryId: z.string().max(100).optional(),
        search: z.string().trim().max(100).optional(),
      }),
      response: { status: 200, schema: pageOf(productSchema, 'StoreProductPage') },
    },
    async ({ query }) => {
      const where: Prisma.ProductWhereInput = { isActive: true };
      if (query.categoryId) where.categoryId = query.categoryId;
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ];
      }
      const products = await db.product.findMany({
        where,
        include: {
          variants: { where: { isActive: true } },
        },
        ...pageArgs(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      return toPage(products, query.limit, (p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        variants: p.variants.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/store/checkout',
      operationId: 'storeCheckout',
      tags: ['Storefront'],
      summary: 'Storefront checkout / order creation',
      description:
        'Offline payment methods only. Send an `idempotencyKey` to make retries safe: the same key returns the original order. ' +
        'Stock and promo-code usage are claimed atomically, so concurrent buyers can never oversell.',
      access: { type: 'public', reason: 'Anonymous storefront checkout; rate limited per IP, offline payment only' },
      rateLimit: 'public',
      body: checkoutBodySchema,
      response: { status: 201, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ body }) => {
      const replay = async () =>
        body.idempotencyKey
          ? db.order.findUnique({ where: { idempotencyKey: body.idempotencyKey }, include: orderInclude })
          : null;

      const existing = await replay();
      if (existing) {
        // Same key with a different cart is a client bug, not a replay: refuse instead of silently returning the old order.
        if (existing.customerEmail !== body.customerEmail) throw errors.conflict('This idempotency key was used for a different order');
        return orderDto(existing);
      }

      // Merge repeated variants, then lock rows in a stable order so concurrent carts cannot deadlock.
      const wanted = new Map<string, number>();
      for (const it of body.items) wanted.set(it.variantId, (wanted.get(it.variantId) ?? 0) + it.quantity);
      const lines = [...wanted.entries()].sort(([x], [y]) => (x < y ? -1 : 1));

      try {
        const created = await db.$transaction(async (tx) => {
          const customerRow = await tx.customer.findUnique({ where: { email: body.customerEmail } });
          if (customerRow?.status === 'BLOCKED') throw errors.forbidden('This customer cannot place orders');

          let subtotalCents = 0;
          const itemsToCreate = [];
          for (const [variantId, quantity] of lines) {
            // One conditional UPDATE is the whole check: it only succeeds while enough stock remains.
            const claimed = await tx.productVariant.updateMany({
              where: { id: variantId, isActive: true, stock: { gte: quantity } },
              data: { stock: { decrement: quantity } },
            });
            if (claimed.count === 0) {
              const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
              if (!variant || !variant.isActive) throw errors.notFound('Product variant');
              throw errors.conflict(`${variant.sku} has insufficient stock (available: ${variant.stock})`);
            }
            const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
            await tx.inventoryMovement.create({
              data: { variantId, quantity: -quantity, action: 'STOCK_OUT', reason: 'Order checkout' },
            });
            const totalPriceCents = variant.priceCents * quantity;
            subtotalCents += totalPriceCents;
            itemsToCreate.push({ variantId, title: variant.title, sku: variant.sku, quantity, unitPriceCents: variant.priceCents, totalPriceCents });
          }

          let promoCodeId: string | undefined;
          let discountCents = 0;
          if (body.promoCode) {
            const promo = await tx.promoCode.findUnique({ where: { code: body.promoCode.toUpperCase() } });
            if (!promo) throw errors.validation([{ path: 'promoCode', message: 'Promo code is invalid or inactive' }]);
            // Claim one use atomically; the WHERE clause re-checks every rule, so two buyers cannot both take the last use.
            const claimed = await tx.$executeRaw`
              UPDATE "PromoCode" SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
              WHERE "id" = ${promo.id} AND "isActive" = true
                AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
                AND ("startsAt" IS NULL OR "startsAt" <= NOW())
                AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`;
            if (claimed === 0) throw errors.validation([{ path: 'promoCode', message: 'Promo code is invalid, expired or fully used' }]);
            promoCodeId = promo.id;
            discountCents = promo.discountCents
              ? Math.min(subtotalCents, promo.discountCents)
              : promo.discountBps
                ? Math.min(subtotalCents, Math.round((subtotalCents * promo.discountBps) / 10_000))
                : 0;
          }

          const customer = await tx.customer.upsert({
            where: { email: body.customerEmail },
            // Name and status of an existing customer are never overwritten by an anonymous request.
            update: { ordersCount: { increment: 1 } },
            create: { email: body.customerEmail, name: body.customerName, phone: body.customerPhone, status: 'ACTIVE', ordersCount: 1 },
          });

          const order = await tx.order.create({
            data: {
              orderNumber: newOrderNumber(),
              customerId: customer.id,
              customerEmail: body.customerEmail,
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              shippingAddress: body.shippingAddress,
              status: 'PENDING',
              paymentStatus: 'UNPAID',
              paymentMethod: body.paymentMethod,
              promoCodeId,
              subtotalCents,
              discountCents,
              totalCents: subtotalCents - discountCents,
              idempotencyKey: body.idempotencyKey,
              items: { create: itemsToCreate },
            },
            include: orderInclude,
          });
          return orderDto(order);
        });
        // After the order is committed; a workflow problem never fails or rolls back the customer's order.
        await fireWorkflowsSafely(kit.c, 'ORDER_CREATED', { orderId: created.id, orderNumber: created.orderNumber, totalCents: created.totalCents, customerEmail: created.customerEmail });
        return created;
      } catch (err) {
        // Two identical requests raced past the replay check: the loser returns the winner's order.
        if ((err as { code?: string })?.code === 'P2002') {
          const winner = await replay();
          if (winner) return orderDto(winner);
        }
        throw err;
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // CUSTOMERS & LEADS (ADMIN / MANAGER)
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/customers',
      operationId: 'listCustomers',
      tags: ['Commerce'],
      summary: 'List customers and leads',
      access: { type: 'permission', permission: 'customers.read' },
      query: paginationQuerySchema.extend({
        status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
        search: z.string().trim().max(100).optional(),
      }),
      response: { status: 200, schema: pageOf(customerSchema, 'CustomerPage') },
    },
    async ({ query, scope, auth }) => {
      const where: Prisma.CustomerWhereInput = {};
      if (scope === 'assigned') where.assignedUserId = auth.user.id;
      if (query.status) where.status = query.status;
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { company: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const rows = await db.customer.findMany({ where, ...pageArgs(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return toPage(rows, query.limit, (c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/customers',
      operationId: 'createCustomer',
      tags: ['Commerce'],
      summary: 'Create customer or lead',
      access: { type: 'permission', permission: 'customers.write' },
      body: createCustomerBodySchema,
      response: { status: 201, schema: customerSchema },
    },
    async ({ body, auth }) => {
      const existing = await db.customer.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existing) throw errors.conflict('A customer with this email already exists');

      const created = await db.customer.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          phone: body.phone,
          company: body.company,
          notes: body.notes,
          status: body.status,
          assignedUserId: body.assignedUserId ?? auth.user.id,
        },
      });

      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/customers/{id}',
      operationId: 'updateCustomer',
      tags: ['Commerce'],
      summary: 'Update customer details',
      access: { type: 'permission', permission: 'customers.write' },
      params: z.object({ id: z.string() }),
      body: updateCustomerBodySchema,
      response: { status: 200, schema: customerSchema },
    },
    async ({ params, body, scope, auth }) => {
      const existing = await db.customer.findUnique({ where: { id: params.id } });
      if (!existing) throw errors.notFound('Customer');
      if (scope === 'assigned' && existing.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot edit customer assigned to another user');
      }

      const updated = await db.customer.update({
        where: { id: params.id },
        data: {
          name: body.name,
          phone: body.phone,
          company: body.company,
          notes: body.notes,
          status: body.status,
          assignedUserId: body.assignedUserId,
        },
      });

      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ─────────────────────────────────────────────────────────────
  // CATALOG MANAGEMENT (PRODUCTS, CATEGORIES, VARIANTS, PROMO)
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'post',
      path: '/api/v1/products/categories',
      operationId: 'createProductCategory',
      tags: ['Commerce'],
      summary: 'Create product category',
      access: { type: 'permission', permission: 'products.write' },
      body: createProductCategoryBodySchema,
      response: { status: 201, schema: productCategorySchema },
    },
    async ({ body }) => {
      const created = await db.productCategory.create({ data: body });
      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/products',
      operationId: 'createProduct',
      tags: ['Commerce'],
      summary: 'Create product with variants',
      access: { type: 'permission', permission: 'products.write' },
      body: createProductBodySchema,
      response: { status: 201, schema: productSchema },
    },
    async ({ body }) => {
      const existing = await db.product.findUnique({ where: { slug: body.slug } });
      if (existing) throw errors.conflict('Product slug already exists');

      const created = await db.product.create({
        data: {
          slug: body.slug,
          name: body.name,
          description: body.description,
          categoryId: body.categoryId,
          isActive: body.isActive,
          imageIds: body.imageIds,
          variants: body.variants ? { create: body.variants } : undefined,
        },
        include: { variants: true },
      });

      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        variants: created.variants.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/products/{id}',
      operationId: 'updateProduct',
      tags: ['Commerce'],
      summary: 'Update product',
      access: { type: 'permission', permission: 'products.write' },
      params: z.object({ id: z.string() }),
      body: updateProductBodySchema,
      response: { status: 200, schema: productSchema },
    },
    async ({ params, body }) => {
      const existing = await db.product.findUnique({ where: { id: params.id } });
      if (!existing) throw errors.notFound('Product');

      const updated = await db.product.update({
        where: { id: params.id },
        data: {
          slug: body.slug,
          name: body.name,
          description: body.description,
          categoryId: body.categoryId,
          isActive: body.isActive,
          imageIds: body.imageIds,
        },
        include: { variants: true },
      });

      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        variants: updated.variants.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/products/variants/{id}/adjust-stock',
      operationId: 'adjustVariantStock',
      tags: ['Commerce'],
      summary: 'Adjust variant stock level',
      access: { type: 'permission', permission: 'products.write' },
      params: z.object({ id: z.string() }),
      body: stockAdjustmentBodySchema,
      response: { status: 200, schema: z.object({ variantId: z.string(), newStock: z.number().int() }) },
    },
    async ({ params, body, auth }) => {
      return await db.$transaction(async (tx) => {
        // Conditional update: a decrease only applies while stock stays >= 0, even under concurrent adjustments.
        const applied = await tx.productVariant.updateMany({
          where: { id: params.id, ...(body.quantity < 0 ? { stock: { gte: -body.quantity } } : {}) },
          data: { stock: { increment: body.quantity } },
        });
        if (applied.count === 0) {
          const variant = await tx.productVariant.findUnique({ where: { id: params.id } });
          if (!variant) throw errors.notFound('Product variant');
          throw errors.conflict(`Adjustment would result in negative stock (${variant.stock + body.quantity})`);
        }
        const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: params.id } });
        await tx.inventoryMovement.create({
          data: {
            variantId: params.id,
            quantity: body.quantity,
            action: body.quantity >= 0 ? 'STOCK_IN' : 'STOCK_OUT',
            reason: body.reason ?? 'Manual adjustment',
            actorId: auth.user.id,
          },
        });
        return { variantId: params.id, newStock: variant.stock };
      });
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/promo-codes',
      operationId: 'createPromoCode',
      tags: ['Commerce'],
      summary: 'Create promo code',
      access: { type: 'permission', permission: 'products.write' },
      body: createPromoCodeBodySchema,
      response: { status: 201, schema: promoCodeSchema },
    },
    async ({ body }) => {
      const existing = await db.promoCode.findUnique({ where: { code: body.code.toUpperCase() } });
      if (existing) throw errors.conflict('Promo code already exists');

      const created = await db.promoCode.create({
        data: {
          code: body.code.toUpperCase(),
          discountBps: body.discountBps,
          discountCents: body.discountCents,
          campaignId: body.campaignId,
          affiliateName: body.affiliateName,
          startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          maxUses: body.maxUses,
          isActive: body.isActive,
        },
      });

      return {
        ...created,
        startsAt: created.startsAt?.toISOString() ?? null,
        expiresAt: created.expiresAt?.toISOString() ?? null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  // ─────────────────────────────────────────────────────────────
  // ORDER MANAGEMENT & FULFILLMENT
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/orders',
      operationId: 'listOrders',
      tags: ['Commerce'],
      summary: 'List customer orders',
      access: { type: 'permission', permission: 'orders.read' },
      query: paginationQuerySchema.extend({
        status: z.enum(['PENDING', 'PAID', 'FULFILLED', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional(),
        customerId: z.string().max(100).optional(),
      }),
      response: { status: 200, schema: pageOf(orderSchema, 'OrderPage') },
    },
    async ({ query, scope, auth }) => {
      const where: Prisma.OrderWhereInput = {};
      if (scope === 'assigned') where.assignedUserId = auth.user.id;
      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;

      const orders = await db.order.findMany({ where, include: orderInclude, ...pageArgs(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return toPage(orders, query.limit, orderDto);
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/orders/{id}',
      operationId: 'getOrder',
      tags: ['Commerce'],
      summary: 'Get order details',
      access: { type: 'permission', permission: 'orders.read' },
      params: z.object({ id: z.string() }),
      response: { status: 200, schema: orderSchema },
    },
    async ({ params, scope, auth }) => {
      const order = await db.order.findUnique({ where: { id: params.id }, include: orderInclude });
      if (!order) throw errors.notFound('Order');
      assertOrderInScope(scope, order, auth.user.id);
      return orderDto(order);
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/orders/{id}/status',
      operationId: 'updateOrderStatus',
      tags: ['Commerce'],
      summary: 'Transition order status',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string() }),
      body: updateOrderStatusBodySchema,
      response: { status: 200, schema: orderSchema },
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: params.id }, include: { items: true } });
        if (!order) throw errors.notFound('Order');
        assertOrderInScope(scope, order, auth.user.id);

        const validTransitions: Record<string, string[]> = {
          PENDING: ['PAID', 'CANCELLED'],
          PAID: ['FULFILLED', 'REFUNDED', 'CANCELLED'],
          FULFILLED: ['DELIVERED', 'REFUNDED'],
          DELIVERED: ['REFUNDED'],
          CANCELLED: [],
          REFUNDED: [],
        };
        if (!(validTransitions[order.status] ?? []).includes(body.status)) {
          throw errors.conflict(`Cannot transition order from ${order.status} to ${body.status}`);
        }

        // Compare-and-set on the current status: of two concurrent "cancel" requests only one wins,
        // so stock is released exactly once.
        const claimed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: body.status } });
        if (claimed.count === 0) throw errors.conflict('The order was changed by someone else; reload and retry');

        if (body.status === 'CANCELLED') {
          for (const item of order.items) {
            await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
            await tx.inventoryMovement.create({
              data: { variantId: item.variantId, quantity: item.quantity, action: 'RELEASE', referenceId: order.id, reason: 'Order cancelled', actorId: auth.user.id },
            });
          }
          if (order.promoCodeId) {
            await tx.$executeRaw`UPDATE "PromoCode" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${order.promoCodeId}`;
          }
        }
        return orderDto(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
      });
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/orders/{id}/assign',
      operationId: 'assignOrder',
      tags: ['Commerce'],
      summary: 'Assign order to a staff member or unassign it',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string() }),
      body: assignOrderBodySchema,
      response: { status: 200, schema: orderSchema },
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({ where: { id: params.id } });
      if (!order) throw errors.notFound('Order');
      assertOrderInScope(scope, order, auth.user.id);

      if (body.assignedUserId) {
        const user = await db.user.findUnique({ where: { id: body.assignedUserId } });
        if (!user || user.status !== 'ACTIVE') throw errors.validation([{ path: 'assignedUserId', message: 'User not found or inactive' }]);
      }

      const updated = await db.order.update({
        where: { id: params.id },
        data: { assignedUserId: body.assignedUserId },
        include: orderInclude,
      });

      return orderDto(updated);
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/orders/{id}/payments',
      operationId: 'recordOrderPayment',
      tags: ['Commerce'],
      summary: 'Record offline payment for an order',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string() }),
      body: recordOrderPaymentBodySchema,
      response: { status: 200, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: params.id } });
        if (!order) throw errors.notFound('Order');
        assertOrderInScope(scope, order, auth.user.id);
        if (order.status === 'CANCELLED' || order.status === 'REFUNDED') throw errors.conflict(`Cannot record a payment on a ${order.status.toLowerCase()} order`);

        // One guarded UPDATE adds the payment only while the order still has that much left to pay, so
        // simultaneous payments can never add up to more than the total (the row is locked until commit).
        const applied = await tx.$executeRaw`
          UPDATE "Order" SET "paidCents" = "paidCents" + ${body.amountCents}, "updatedAt" = NOW()
          WHERE "id" = ${order.id} AND "status" NOT IN ('CANCELLED', 'REFUNDED') AND "paidCents" + ${body.amountCents} <= "totalCents"`;
        if (applied === 0) {
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
          throw errors.conflict(`Payment exceeds the amount due (due: ${fresh.totalCents - fresh.paidCents})`);
        }
        const after = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        const fullyPaid = after.paidCents >= after.totalCents;
        await tx.order.update({
          where: { id: order.id },
          data: {
            ...(fullyPaid ? { paymentStatus: 'PAID' as const } : {}),
            ...(fullyPaid && after.status === 'PENDING' ? { status: 'PAID' as const } : {}),
            paymentMethod: body.paymentMethod,
            paymentDetails: { reference: body.reference ?? null, notes: body.notes ?? null, recordedAt: new Date().toISOString(), recordedBy: auth.user.id },
          },
        });
        // Customer lifetime value counts money actually received, not orders placed.
        if (order.customerId) await tx.customer.update({ where: { id: order.customerId }, data: { totalSpentCents: { increment: body.amountCents } } });
        return orderDto(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
      });
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/orders/{id}/refund',
      operationId: 'refundOrder',
      tags: ['Commerce'],
      summary: 'Refund order amount',
      access: { type: 'permission', permission: 'orders.refund' },
      params: z.object({ id: z.string() }),
      body: refundOrderBodySchema,
      response: { status: 200, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: params.id } });
        if (!order) throw errors.notFound('Order');
        assertOrderInScope(scope, order, auth.user.id);

        const applied = await tx.$executeRaw`
          UPDATE "Order" SET "refundedCents" = "refundedCents" + ${body.amountCents}, "updatedAt" = NOW()
          WHERE "id" = ${order.id} AND "refundedCents" + ${body.amountCents} <= "paidCents"`;
        if (applied === 0) {
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
          throw errors.conflict(`Refund amount exceeds paid amount (paid: ${fresh.paidCents}, already refunded: ${fresh.refundedCents})`);
        }
        const after = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        const isFullRefund = after.refundedCents >= after.paidCents;
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED', ...(isFullRefund ? { status: 'REFUNDED' as const } : {}) },
        });
        if (order.customerId) await tx.customer.update({ where: { id: order.customerId }, data: { totalSpentCents: { decrement: body.amountCents } } });
        return orderDto(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
      });
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/orders/{id}/shipments',
      operationId: 'createOrderShipment',
      tags: ['Commerce'],
      summary: 'Create order shipment',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string() }),
      body: createShipmentBodySchema,
      response: { status: 200, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: params.id } });
        if (!order) throw errors.notFound('Order');
        assertOrderInScope(scope, order, auth.user.id);
        if (order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.status === 'DELIVERED') {
          throw errors.conflict(`Cannot ship a ${order.status.toLowerCase()} order`);
        }
        await tx.shipment.create({
          data: {
            orderId: order.id,
            carrier: body.carrier,
            trackingNumber: body.trackingNumber,
            notes: body.notes,
            status: 'SHIPPED',
            shippedAt: body.shippedAt ? new Date(body.shippedAt) : new Date(),
          },
        });
        // Only a paid order moves to FULFILLED; cash-on-delivery orders stay PENDING until the money is recorded.
        if (order.status === 'PAID') await tx.order.update({ where: { id: order.id }, data: { status: 'FULFILLED' } });
        return orderDto(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
      });
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/orders/{id}/returns',
      operationId: 'createReturnRequest',
      tags: ['Commerce'],
      summary: 'Request order return',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string() }),
      body: createReturnRequestBodySchema,
      response: { status: 200, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({ where: { id: params.id } });
      if (!order) throw errors.notFound('Order');
      assertOrderInScope(scope, order, auth.user.id);
      if (order.status === 'PENDING' || order.status === 'PAID' || order.status === 'CANCELLED') {
        throw errors.conflict('Only shipped orders can be returned');
      }
      await db.returnRequest.create({ data: { orderId: order.id, reason: body.reason, restockResellable: body.restockResellable, status: 'REQUESTED' } });
      return orderDto(await db.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/orders/{id}/returns/{returnId}',
      operationId: 'decideReturnRequest',
      tags: ['Commerce'],
      summary: 'Decide return request and conditionally restock inventory',
      access: { type: 'permission', permission: 'orders.write' },
      params: z.object({ id: z.string(), returnId: z.string() }),
      body: decideReturnRequestBodySchema,
      response: { status: 200, schema: orderSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: params.id }, include: { items: true } });
        if (!order) throw errors.notFound('Order');
        assertOrderInScope(scope, order, auth.user.id);
        const ret = await tx.returnRequest.findUnique({ where: { id: params.returnId } });
        if (!ret || ret.orderId !== order.id) throw errors.notFound('Return request');
        if (ret.status === 'REJECTED' || ret.status === 'RESTOCKED') throw errors.conflict(`This return is already ${ret.status.toLowerCase()}`);

        // Compare-and-set on the return's status: stock can be restocked only once per return.
        const claimed = await tx.returnRequest.updateMany({
          where: { id: ret.id, status: ret.status },
          data: { status: body.status, decisionNotes: body.decisionNotes, decidedAt: new Date() },
        });
        if (claimed.count === 0) throw errors.conflict('The return was changed by someone else; reload and retry');

        if (body.status === 'RESTOCKED' && ret.restockResellable) {
          for (const item of order.items) {
            await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
            await tx.inventoryMovement.create({
              data: { variantId: item.variantId, quantity: item.quantity, action: 'RETURN_RESTOCK', referenceId: order.id, reason: 'Customer return approved and restocked', actorId: auth.user.id },
            });
          }
        }
        return orderDto(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude }));
      });
    },
  );

  // ─────────────────────────────────────────────────────────────
  // INVOICES, MILESTONES & EARNINGS
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/earnings/invoices',
      operationId: 'listInvoices',
      tags: ['Earnings'],
      summary: 'List client invoices',
      access: { type: 'permission', permission: 'earnings.read' },
      query: paginationQuerySchema.extend({
        status: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']).optional(),
        campaignId: z.string().max(100).optional(),
      }),
      response: { status: 200, schema: pageOf(invoiceSchema, 'InvoicePage') },
    },
    async ({ query }) => {
      const where: Prisma.InvoiceWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.campaignId) where.campaignId = query.campaignId;

      const invoices = await db.invoice.findMany({
        where,
        include: { milestones: true, payments: true },
        ...pageArgs(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      return toPage(invoices, query.limit, (inv) => ({
        ...inv,
        issueDate: inv.issueDate.toISOString(),
        dueDate: inv.dueDate.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
        milestones: inv.milestones.map((m) => ({
          ...m,
          dueDate: m.dueDate.toISOString(),
          completedAt: m.completedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
        payments: inv.payments.map((p) => ({
          ...p,
          paidAt: p.paidAt.toISOString(),
          source: p.source as 'SYNCED' | 'MANUAL',
          createdAt: p.createdAt.toISOString(),
        })),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/earnings/invoices',
      operationId: 'createInvoice',
      tags: ['Earnings'],
      summary: 'Create client invoice with payment milestones',
      access: { type: 'permission', permission: 'earnings.write' },
      body: createInvoiceBodySchema,
      response: { status: 201, schema: invoiceSchema },
    },
    async ({ body, auth }) => {
      const existing = await db.invoice.findUnique({ where: { invoiceNumber: body.invoiceNumber } });
      if (existing) throw errors.conflict('Invoice number already exists');

      const totalCents = body.subtotalCents + body.taxCents;
      const created = await db.invoice.create({
        data: {
          invoiceNumber: body.invoiceNumber,
          campaignId: body.campaignId,
          clientName: body.clientName,
          clientEmail: body.clientEmail,
          issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
          dueDate: new Date(body.dueDate),
          subtotalCents: body.subtotalCents,
          taxCents: body.taxCents,
          totalCents,
          notes: body.notes,
          status: 'ISSUED',
          createdById: auth.user.id,
          milestones: body.milestones
            ? {
                create: body.milestones.map((m) => ({
                  title: m.title,
                  amountCents: m.amountCents,
                  dueDate: new Date(m.dueDate),
                  status: 'PENDING',
                })),
              }
            : undefined,
        },
        include: { milestones: true, payments: true },
      });

      return {
        ...created,
        issueDate: created.issueDate.toISOString(),
        dueDate: created.dueDate.toISOString(),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        milestones: created.milestones.map((m) => ({
          ...m,
          dueDate: m.dueDate.toISOString(),
          completedAt: m.completedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
        payments: [],
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/earnings/invoices/{id}/payments',
      operationId: 'recordInvoicePayment',
      tags: ['Earnings'],
      summary: 'Record partial or full payment on invoice',
      access: { type: 'permission', permission: 'earnings.write' },
      params: z.object({ id: z.string() }),
      body: recordInvoicePaymentBodySchema,
      response: { status: 200, schema: invoiceSchema },
    },
    async ({ params, body }) => {
      return await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({ where: { id: params.id } });
        if (!invoice) throw errors.notFound('Invoice');

        const newPaid = invoice.paidCents + body.amountCents;
        const isFull = newPaid >= invoice.totalCents;

        await tx.earningPayment.create({
          data: {
            invoiceId: invoice.id,
            amountCents: body.amountCents,
            paymentMethod: body.paymentMethod,
            reference: body.reference,
            source: body.source,
            notes: body.notes,
          },
        });

        await tx.earningEntry.create({
          data: {
            campaignId: invoice.campaignId,
            title: `Payment for Invoice ${invoice.invoiceNumber}`,
            category: 'CAMPAIGN_FEE',
            amountCents: body.amountCents,
            receivedAt: new Date(),
            source: body.source,
            reference: body.reference,
            notes: body.notes,
          },
        });

        const updated = await tx.invoice.update({
          where: { id: params.id },
          data: {
            paidCents: newPaid,
            status: isFull ? 'PAID' : 'PARTIALLY_PAID',
          },
          include: { milestones: true, payments: true },
        });

        return {
          ...updated,
          issueDate: updated.issueDate.toISOString(),
          dueDate: updated.dueDate.toISOString(),
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          milestones: updated.milestones.map((m) => ({
            ...m,
            dueDate: m.dueDate.toISOString(),
            completedAt: m.completedAt?.toISOString() ?? null,
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          })),
          payments: updated.payments.map((p) => ({
            ...p,
            paidAt: p.paidAt.toISOString(),
            source: p.source as 'SYNCED' | 'MANUAL',
            createdAt: p.createdAt.toISOString(),
          })),
        };
      });
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/earnings/entries',
      operationId: 'listEarningsEntries',
      tags: ['Earnings'],
      summary: 'List earnings entries across all streams',
      access: { type: 'permission', permission: 'earnings.read' },
      query: paginationQuerySchema.extend({
        category: z.string().max(100).optional(),
        campaignId: z.string().max(100).optional(),
      }),
      response: { status: 200, schema: pageOf(earningEntrySchema, 'EarningEntryPage') },
    },
    async ({ query }) => {
      const where: Prisma.EarningEntryWhereInput = {};
      if (query.category) where.category = query.category;
      if (query.campaignId) where.campaignId = query.campaignId;

      const entries = await db.earningEntry.findMany({ where, ...pageArgs(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return toPage(entries, query.limit, (e) => ({
        ...e,
        expectedAt: e.expectedAt?.toISOString() ?? null,
        receivedAt: e.receivedAt?.toISOString() ?? null,
        source: e.source as 'SYNCED' | 'MANUAL',
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/earnings/entries',
      operationId: 'createEarningEntry',
      tags: ['Earnings'],
      summary: 'Create manual or synced earning entry',
      access: { type: 'permission', permission: 'earnings.write' },
      body: createEarningEntryBodySchema,
      response: { status: 201, schema: earningEntrySchema },
    },
    async ({ body }) => {
      const created = await db.earningEntry.create({
        data: {
          campaignId: body.campaignId,
          title: body.title,
          category: body.category,
          amountCents: body.amountCents,
          expectedAt: body.expectedAt ? new Date(body.expectedAt) : undefined,
          receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
          source: body.source,
          reference: body.reference,
          notes: body.notes,
        },
      });

      return {
        ...created,
        expectedAt: created.expectedAt?.toISOString() ?? null,
        receivedAt: created.receivedAt?.toISOString() ?? null,
        source: created.source as 'SYNCED' | 'MANUAL',
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/earnings/summary',
      operationId: 'getEarningsSummary',
      tags: ['Earnings'],
      summary: 'Aggregated earnings and store revenue metrics',
      access: { type: 'permission', permission: 'earnings.read' },
      response: { status: 200, schema: earningsSummarySchema },
    },
    async () => {
      const [earnings, invoices, orders] = await Promise.all([
        db.earningEntry.findMany({ where: { receivedAt: { not: null } } }),
        db.invoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } }),
        db.order.findMany({ where: { paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }),
      ]);

      const totalEarnedCents = earnings.reduce((sum, e) => sum + e.amountCents, 0);
      const pendingInvoicedCents = invoices.reduce((sum, i) => sum + (i.totalCents - i.paidCents), 0);
      const totalOrdersRevenueCents = orders.reduce((sum, o) => sum + o.paidCents, 0);

      const categories: Record<string, number> = {};
      for (const e of earnings) {
        categories[e.category] = (categories[e.category] ?? 0) + e.amountCents;
      }

      return {
        totalEarnedCents,
        pendingInvoicedCents,
        totalOrdersRevenueCents,
        categories,
      };
    },
  );

  return router;
}
