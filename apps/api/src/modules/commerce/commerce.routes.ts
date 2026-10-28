import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  customerSchema,
  customerListQuerySchema,
  customerPageSchema,
  createCustomerBodySchema,
  updateCustomerBodySchema,
  productCategorySchema,
  createProductCategoryBodySchema,
  productSchema,
  productListQuerySchema,
  productPageSchema,
  createProductBodySchema,
  updateProductBodySchema,
  stockAdjustmentBodySchema,
  promoCodeSchema,
  createPromoCodeBodySchema,
  orderSchema,
  orderListQuerySchema,
  orderPageSchema,
  checkoutBodySchema,
  updateOrderStatusBodySchema,
  recordOrderPaymentBodySchema,
  refundOrderBodySchema,
  createShipmentBodySchema,
  createReturnRequestBodySchema,
  decideReturnRequestBodySchema,
  invoiceSchema,
  invoiceListQuerySchema,
  invoicePageSchema,
  createInvoiceBodySchema,
  recordInvoicePaymentBodySchema,
  earningEntrySchema,
  earningEntryListQuerySchema,
  earningEntryPageSchema,
  createEarningEntryBodySchema,
  earningsSummarySchema,
} from '@platform/shared-types';
import { errors } from '../../lib/errors.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';

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
      access: { type: 'public', reason: 'Public storefront product catalog' },
      query: productListQuerySchema,
      response: { status: 200, schema: productPageSchema },
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
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
      access: { type: 'public', reason: 'Public customer shopping cart checkout' },
      rateLimit: 'public-form',
      body: checkoutBodySchema,
      response: { status: 201, schema: orderSchema },
    },
    async ({ body }) => {
      if (body.paymentMethod !== 'CASH_ON_DELIVERY' && body.paymentMethod !== 'MANUAL_BANK_TRANSFER' && body.paymentMethod !== 'OTHER_OFFLINE') {
        throw errors.validation([{ path: 'paymentMethod', message: 'Online payment provider is not configured. Offline payment required.' }]);
      }

      if (body.idempotencyKey) {
        const existing = await db.order.findUnique({
          where: { idempotencyKey: body.idempotencyKey },
          include: { items: true, shipments: true, returns: true },
        });
        if (existing) {
          return {
            ...existing,
            shippingAddress: existing.shippingAddress as Record<string, unknown>,
            paymentDetails: existing.paymentDetails as Record<string, unknown> | null,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: existing.updatedAt.toISOString(),
            items: existing.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
            shipments: existing.shipments.map((s) => ({
              ...s,
              shippedAt: s.shippedAt?.toISOString() ?? null,
              deliveredAt: s.deliveredAt?.toISOString() ?? null,
              createdAt: s.createdAt.toISOString(),
              updatedAt: s.updatedAt.toISOString(),
            })),
            returns: existing.returns.map((ret) => ({
              ...ret,
              decidedAt: ret.decidedAt?.toISOString() ?? null,
              createdAt: ret.createdAt.toISOString(),
              updatedAt: ret.updatedAt.toISOString(),
            })),
          };
        }
      }

      return await db.$transaction(async (tx) => {
        let promoCodeRow = null;
        let discountCents = 0;
        if (body.promoCode) {
          promoCodeRow = await tx.promoCode.findUnique({ where: { code: body.promoCode.toUpperCase() } });
          if (!promoCodeRow || !promoCodeRow.isActive) {
            throw errors.validation([{ path: 'promoCode', message: 'Promo code is invalid or inactive' }]);
          }
          if (promoCodeRow.expiresAt && promoCodeRow.expiresAt < new Date()) {
            throw errors.validation([{ path: 'promoCode', message: 'Promo code has expired' }]);
          }
          if (promoCodeRow.maxUses) {
            // Atomic conditional update to guard promo code max uses against race conditions
            const updatedPromo = await tx.$executeRaw`
              UPDATE "PromoCode"
              SET "usedCount" = "usedCount" + 1
              WHERE "id" = ${promoCodeRow.id} AND "usedCount" < ${promoCodeRow.maxUses}
            `;
            if (updatedPromo === 0) {
              throw errors.validation([{ path: 'promoCode', message: 'Promo code has reached max uses' }]);
            }
          } else {
            await tx.promoCode.update({
              where: { id: promoCodeRow.id },
              data: { usedCount: { increment: 1 } },
            });
          }
        }

        let subtotalCents = 0;
        const itemsToCreate = [];

        for (const item of body.items) {
          const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
          if (!variant || !variant.isActive) {
            throw errors.notFound(`Variant ${item.variantId}`);
          }

          // Atomic conditional stock decrement: prevents overselling under race conditions
          const rowsUpdated = await tx.$executeRaw`
            UPDATE "ProductVariant"
            SET "stock" = "stock" - ${item.quantity}
            WHERE "id" = ${variant.id} AND "stock" >= ${item.quantity}
          `;
          if (rowsUpdated === 0) {
            throw errors.conflict(`Variant ${variant.sku} has insufficient stock`);
          }

          await tx.inventoryMovement.create({
            data: {
              variantId: variant.id,
              quantity: -item.quantity,
              action: 'STOCK_OUT',
              reason: 'Order checkout',
            },
          });

          const itemTotal = variant.priceCents * item.quantity;
          subtotalCents += itemTotal;
          itemsToCreate.push({
            variantId: variant.id,
            title: variant.title,
            sku: variant.sku,
            quantity: item.quantity,
            unitPriceCents: variant.priceCents,
            totalPriceCents: itemTotal,
          });
        }

        if (promoCodeRow) {
          if (promoCodeRow.discountCents) {
            discountCents = Math.min(subtotalCents, promoCodeRow.discountCents);
          } else if (promoCodeRow.discountBps) {
            discountCents = Math.round((subtotalCents * promoCodeRow.discountBps) / 10000);
          }
        }

        const totalCents = Math.max(0, subtotalCents - discountCents);
        const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        // Link or create customer (totalSpentCents is updated when payment is recorded, not at checkout)
        let customer = await tx.customer.findUnique({ where: { email: body.customerEmail.toLowerCase() } });
        if (!customer) {
          customer = await tx.customer.create({
            data: {
              email: body.customerEmail.toLowerCase(),
              name: body.customerName,
              phone: body.customerPhone,
              status: 'ACTIVE',
              totalSpentCents: 0,
              ordersCount: 1,
            },
          });
        } else {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              ordersCount: { increment: 1 },
              status: 'ACTIVE',
            },
          });
        }

        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            customerEmail: body.customerEmail.toLowerCase(),
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            shippingAddress: body.shippingAddress as Prisma.InputJsonValue,
            status: 'PENDING',
            paymentStatus: 'UNPAID',
            paymentMethod: body.paymentMethod,
            promoCodeId: promoCodeRow?.id,
            subtotalCents,
            discountCents,
            totalCents,
            idempotencyKey: body.idempotencyKey,
            items: {
              create: itemsToCreate,
            },
          },
          include: { items: true, shipments: true, returns: true },
        });

        return {
          ...order,
          shippingAddress: order.shippingAddress as Record<string, unknown>,
          paymentDetails: order.paymentDetails as Record<string, unknown> | null,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          items: order.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
          shipments: [],
          returns: [],
        };
      });
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
      query: customerListQuerySchema,
      response: { status: 200, schema: customerPageSchema },
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

      const rows = await db.customer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });
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
        const variant = await tx.productVariant.findUnique({ where: { id: params.id } });
        if (!variant) throw errors.notFound('Product variant');

        const newStock = variant.stock + body.quantity;
        if (newStock < 0) {
          throw errors.conflict(`Adjustment would result in negative stock (${newStock})`);
        }

        await tx.productVariant.update({
          where: { id: params.id },
          data: { stock: newStock },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: params.id,
            quantity: body.quantity,
            action: body.quantity >= 0 ? 'STOCK_IN' : 'STOCK_OUT',
            reason: body.reason ?? 'Manual adjustment',
            actorId: auth.user.id,
          },
        });

        return { variantId: params.id, newStock };
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
      query: orderListQuerySchema,
      response: { status: 200, schema: orderPageSchema },
    },
    async ({ query, scope, auth }) => {
      const where: Prisma.OrderWhereInput = {};
      if (scope === 'assigned') where.assignedUserId = auth.user.id;
      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;

      const orders = await db.order.findMany({
        where,
        include: { items: true, shipments: true, returns: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });

      return toPage(orders, query.limit, (o) => ({
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
        returns: o.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      }));
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
      const order = await db.order.findUnique({
        where: { id: params.id },
        include: { items: true, shipments: true, returns: true },
      });
      if (!order) throw errors.notFound('Order');
      if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot access order assigned to another user');
      }

      return {
        ...order,
        shippingAddress: order.shippingAddress as Record<string, unknown>,
        paymentDetails: order.paymentDetails as Record<string, unknown> | null,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        items: order.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
        shipments: order.shipments.map((s) => ({
          ...s,
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        returns: order.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      };
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
        const order = await tx.order.findUnique({
          where: { id: params.id },
          include: { items: true, shipments: true, returns: true },
        });
        if (!order) throw errors.notFound('Order');
        if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
          throw errors.forbidden('Cannot transition order assigned to another user');
        }

        const validTransitions: Record<string, string[]> = {
          PENDING: ['PAID', 'CANCELLED'],
          PAID: ['FULFILLED', 'REFUNDED', 'CANCELLED'],
          FULFILLED: ['DELIVERED', 'REFUNDED'],
          DELIVERED: ['REFUNDED'],
          CANCELLED: [],
          REFUNDED: [],
        };

        const allowed = validTransitions[order.status] ?? [];
        if (!allowed.includes(body.status)) {
          throw errors.conflict(`Cannot transition order from ${order.status} to ${body.status}`);
        }

        if (body.status === 'CANCELLED') {
          for (const item of order.items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                quantity: item.quantity,
                action: 'RELEASE',
                referenceId: order.id,
                reason: 'Order cancelled',
                actorId: auth.user.id,
              },
            });
          }
        }

        const updated = await tx.order.update({
          where: { id: params.id },
          data: { status: body.status },
          include: { items: true, shipments: true, returns: true },
        });

        return {
          ...updated,
          shippingAddress: updated.shippingAddress as Record<string, unknown>,
          paymentDetails: updated.paymentDetails as Record<string, unknown> | null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          items: updated.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
          shipments: updated.shipments.map((s) => ({
            ...s,
            shippedAt: s.shippedAt?.toISOString() ?? null,
            deliveredAt: s.deliveredAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
          returns: updated.returns.map((ret) => ({
            ...ret,
            decidedAt: ret.decidedAt?.toISOString() ?? null,
            createdAt: ret.createdAt.toISOString(),
            updatedAt: ret.updatedAt.toISOString(),
          })),
        };
      });
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
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({
        where: { id: params.id },
        include: { items: true, shipments: true, returns: true },
      });
      if (!order) throw errors.notFound('Order');
      if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot manage payment for order assigned to another user');
      }

      const newPaidCents = order.paidCents + body.amountCents;
      const isFullyPaid = newPaidCents >= order.totalCents;

      // Update customer totalSpentCents when order is paid
      if (order.customerId) {
        await db.customer.update({
          where: { id: order.customerId },
          data: { totalSpentCents: { increment: body.amountCents } },
        });
      }

      const updated = await db.order.update({
        where: { id: params.id },
        data: {
          paidCents: newPaidCents,
          paymentStatus: isFullyPaid ? 'PAID' : order.paymentStatus,
          status: isFullyPaid && order.status === 'PENDING' ? 'PAID' : order.status,
          paymentMethod: body.paymentMethod,
          paymentDetails: {
            reference: body.reference,
            notes: body.notes,
            recordedAt: new Date().toISOString(),
          },
        },
        include: { items: true, shipments: true, returns: true },
      });

      return {
        ...updated,
        shippingAddress: updated.shippingAddress as Record<string, unknown>,
        paymentDetails: updated.paymentDetails as Record<string, unknown> | null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        items: updated.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
        shipments: updated.shipments.map((s) => ({
          ...s,
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        returns: updated.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      };
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
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({
        where: { id: params.id },
        include: { items: true, shipments: true, returns: true },
      });
      if (!order) throw errors.notFound('Order');
      if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot refund order assigned to another user');
      }

      if (body.amountCents + order.refundedCents > order.paidCents) {
        throw errors.conflict(`Refund amount exceeds paid amount (paid: ${order.paidCents}, already refunded: ${order.refundedCents})`);
      }

      const totalRefunded = order.refundedCents + body.amountCents;
      const isFullRefund = totalRefunded >= order.paidCents;

      const updated = await db.order.update({
        where: { id: params.id },
        data: {
          refundedCents: totalRefunded,
          paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          status: isFullRefund ? 'REFUNDED' : order.status,
        },
        include: { items: true, shipments: true, returns: true },
      });

      return {
        ...updated,
        shippingAddress: updated.shippingAddress as Record<string, unknown>,
        paymentDetails: updated.paymentDetails as Record<string, unknown> | null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        items: updated.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
        shipments: updated.shipments.map((s) => ({
          ...s,
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        returns: updated.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      };
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
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({ where: { id: params.id } });
      if (!order) throw errors.notFound('Order');
      if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot create shipment for order assigned to another user');
      }

      await db.shipment.create({
        data: {
          orderId: params.id,
          carrier: body.carrier,
          trackingNumber: body.trackingNumber,
          notes: body.notes,
          status: 'SHIPPED',
          shippedAt: body.shippedAt ? new Date(body.shippedAt) : new Date(),
        },
      });

      const updated = await db.order.update({
        where: { id: params.id },
        data: { status: 'FULFILLED' },
        include: { items: true, shipments: true, returns: true },
      });

      return {
        ...updated,
        shippingAddress: updated.shippingAddress as Record<string, unknown>,
        paymentDetails: updated.paymentDetails as Record<string, unknown> | null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        items: updated.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
        shipments: updated.shipments.map((s) => ({
          ...s,
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        returns: updated.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      };
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
    },
    async ({ params, body, scope, auth }) => {
      const order = await db.order.findUnique({ where: { id: params.id } });
      if (!order) throw errors.notFound('Order');
      if (scope === 'assigned' && order.assignedUserId !== auth.user.id) {
        throw errors.forbidden('Cannot request return for order assigned to another user');
      }

      await db.returnRequest.create({
        data: {
          orderId: params.id,
          reason: body.reason,
          restockResellable: body.restockResellable,
          status: 'REQUESTED',
        },
      });

      const updated = await db.order.findUniqueOrThrow({
        where: { id: params.id },
        include: { items: true, shipments: true, returns: true },
      });

      return {
        ...updated,
        shippingAddress: updated.shippingAddress as Record<string, unknown>,
        paymentDetails: updated.paymentDetails as Record<string, unknown> | null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        items: updated.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
        shipments: updated.shipments.map((s) => ({
          ...s,
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        returns: updated.returns.map((ret) => ({
          ...ret,
          decidedAt: ret.decidedAt?.toISOString() ?? null,
          createdAt: ret.createdAt.toISOString(),
          updatedAt: ret.updatedAt.toISOString(),
        })),
      };
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
    },
    async ({ params, body, scope, auth }) => {
      return await db.$transaction(async (tx) => {
        const ret = await tx.returnRequest.findUnique({ where: { id: params.returnId } });
        if (!ret || ret.orderId !== params.id) throw errors.notFound('Return request');

        const orderCheck = await tx.order.findUnique({ where: { id: params.id } });
        if (!orderCheck) throw errors.notFound('Order');
        if (scope === 'assigned' && orderCheck.assignedUserId !== auth.user.id) {
          throw errors.forbidden('Cannot decide return for order assigned to another user');
        }

        await tx.returnRequest.update({
          where: { id: params.returnId },
          data: {
            status: body.status,
            decisionNotes: body.decisionNotes,
            decidedAt: new Date(),
          },
        });

        if (body.status === 'RESTOCKED' && ret.restockResellable) {
          const order = await tx.order.findUniqueOrThrow({
            where: { id: params.id },
            include: { items: true },
          });

          for (const item of order.items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                quantity: item.quantity,
                action: 'RETURN_RESTOCK',
                referenceId: order.id,
                reason: 'Customer return approved and restocked',
                actorId: auth.user.id,
              },
            });
          }
        }

        const order = await tx.order.findUniqueOrThrow({
          where: { id: params.id },
          include: { items: true, shipments: true, returns: true },
        });

        return {
          ...order,
          shippingAddress: order.shippingAddress as Record<string, unknown>,
          paymentDetails: order.paymentDetails as Record<string, unknown> | null,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          items: order.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
          shipments: order.shipments.map((s) => ({
            ...s,
            shippedAt: s.shippedAt?.toISOString() ?? null,
            deliveredAt: s.deliveredAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
          returns: order.returns.map((r) => ({
            ...r,
            decidedAt: r.decidedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        };
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
      query: invoiceListQuerySchema,
      response: { status: 200, schema: invoicePageSchema },
    },
    async ({ query }) => {
      const where: Prisma.InvoiceWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.campaignId) where.campaignId = query.campaignId;

      const invoices = await db.invoice.findMany({
        where,
        include: { milestones: true, payments: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
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
      query: earningEntryListQuerySchema,
      response: { status: 200, schema: earningEntryPageSchema },
    },
    async ({ query }) => {
      const where: Prisma.EarningEntryWhereInput = {};
      if (query.category) where.category = query.category;
      if (query.campaignId) where.campaignId = query.campaignId;

      const entries = await db.earningEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      });
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
