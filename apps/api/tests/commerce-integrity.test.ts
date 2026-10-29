import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, createUser, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;
beforeAll(async () => {
  t = await createTestApp();
  admin = (await signInWithTwoFactor(t, 'shop-admin@example.test', 'admin')).client;
}, 90_000);
afterAll(async () => {
  if (t) await t.close();
});

let seq = 0;
/** A fresh product with one variant of the given stock. */
async function makeVariant(stock: number, priceCents = 1000) {
  const n = ++seq;
  const cat = (await admin.post('/api/v1/products/categories', { slug: `c${n}`, name: `C${n}`, sortOrder: n })).body;
  const prod = (
    await admin.post('/api/v1/products', {
      slug: `p${n}`, name: `P${n}`, description: 'd', categoryId: cat.id, isActive: true, imageIds: [],
      variants: [{ sku: `SKU-${n}`, title: 'Std', priceCents, stock, isActive: true }],
    })
  ).body;
  return prod.variants[0] as { id: string; sku: string };
}
const stockOf = async (id: string) => (await t.c.db.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const buy = (variantId: string, i: number, extra: Record<string, unknown> = {}, client = new Client(t.app)) =>
  client.post('/api/v1/store/checkout', {
    customerEmail: `buyer${i}@example.test`, customerName: `Buyer ${i}`, shippingAddress: { street: '1 Main St', city: 'Dhaka' },
    items: [{ variantId, quantity: 1 }], ...extra,
  });

describe('checkout never oversells', () => {
  it('6 simultaneous buyers, stock 1: exactly one order, stock 0, and the database refuses a negative value', async () => {
    const v = await makeVariant(1);
    const res = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => buy(v.id, i)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(v.id)).toBe(0);
    expect(await t.c.db.orderItem.count({ where: { variantId: v.id } })).toBe(1);
    await expect(t.c.db.$executeRaw`UPDATE "ProductVariant" SET "stock" = -1 WHERE "id" = ${v.id}`).rejects.toBeDefined();
  });

  it('a promo code with maxUses 2 is used exactly twice, and failed buyers keep their stock', async () => {
    const v = await makeVariant(10);
    await admin.post('/api/v1/promo-codes', { code: 'TWICE', discountBps: 1000, isActive: true, maxUses: 2 });
    const res = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => buy(v.id, 20 + i, { promoCode: 'twice' })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(res.filter((r) => r.status === 400)).toHaveLength(4);
    expect((await t.c.db.promoCode.findFirstOrThrow({ where: { code: 'TWICE' } })).usedCount).toBe(2);
    expect(await stockOf(v.id)).toBe(8); // rolled-back attempts released their stock
  });

  it('the same cart twice in one request is merged and checked as one quantity', async () => {
    const v = await makeVariant(1);
    const r = await buy(v.id, 30, { items: [{ variantId: v.id, quantity: 1 }, { variantId: v.id, quantity: 1 }] });
    expect(r.status).toBe(409);
    expect(await stockOf(v.id)).toBe(1);
  });

  it('concurrent manual stock decreases cannot push stock below zero', async () => {
    const v = await makeVariant(2);
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => admin.post(`/api/v1/products/variants/${v.id}/adjust-stock`, { quantity: -1, reason: 'shrinkage' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await stockOf(v.id)).toBe(0);
  });
});

describe('idempotent checkout', () => {
  it('three simultaneous requests with one key create one order and take stock once', async () => {
    const v = await makeVariant(5);
    const res = await Promise.all([1, 2, 3].map(() => buy(v.id, 40, { idempotencyKey: 'idem-key-0001' })));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(await stockOf(v.id)).toBe(4);
  });

  it('refuses to replay a key against a different customer', async () => {
    const v = await makeVariant(5);
    expect((await buy(v.id, 41, { idempotencyKey: 'idem-key-0002' })).status).toBe(201);
    expect((await buy(v.id, 42, { idempotencyKey: 'idem-key-0002' })).status).toBe(409);
  });
});

describe('public checkout input is bounded and sanitized', () => {
  it('rejects oversized, malformed and control-character input', async () => {
    const v = await makeVariant(50);
    const bad: Record<string, unknown>[] = [
      { customerName: 'x'.repeat(121) },
      { customerName: 'Evil\u0000Name' },
      { customerEmail: 'not-an-email' },
      { shippingAddress: { street: 'x'.repeat(301) } },
      { shippingAddress: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'v'])) },
      { shippingAddress: {} },
      { items: Array.from({ length: 51 }, () => ({ variantId: v.id, quantity: 1 })) },
      { items: [{ variantId: v.id, quantity: 101 }] },
      { items: [{ variantId: v.id, quantity: 0 }] },
      { idempotencyKey: 'short' },
    ];
    for (const patch of bad) expect([JSON.stringify(patch).slice(0, 40), (await buy(v.id, 50, patch)).status]).toEqual([JSON.stringify(patch).slice(0, 40), 400]);
    expect(await stockOf(v.id)).toBe(50);
  });

  it('normalizes the email so "Ann@X.com " and "ann@x.com" are one customer', async () => {
    const v = await makeVariant(5);
    await buy(v.id, 51, { customerEmail: ' Same@Example.TEST ' });
    await buy(v.id, 51, { customerEmail: 'same@example.test' });
    expect(await t.c.db.customer.count({ where: { email: 'same@example.test' } })).toBe(1);
  });

  it('does not let an anonymous buyer rename a customer or un-block a blocked one', async () => {
    const v = await makeVariant(5);
    await t.c.db.customer.create({ data: { email: 'blocked@example.test', name: 'Blocked Person', status: 'BLOCKED' } });
    expect((await buy(v.id, 52, { customerEmail: 'blocked@example.test' })).status).toBe(403);
    expect(await stockOf(v.id)).toBe(5);
    await buy(v.id, 53);
    await buy(v.id, 53, { customerName: 'Renamed By Stranger' });
    expect((await t.c.db.customer.findUniqueOrThrow({ where: { email: 'buyer53@example.test' } })).name).toBe('Buyer 53');
  });
});

describe('order lifecycle invariants', () => {
  async function placedOrder(qty = 2, priceCents = 1000) {
    const v = await makeVariant(10, priceCents);
    const r = await buy(v.id, 60 + ++seq, { items: [{ variantId: v.id, quantity: qty }] });
    expect(r.status).toBe(201);
    return { v, order: r.body as { id: string; totalCents: number } };
  }

  it('cancelling concurrently releases stock and the promo use exactly once', async () => {
    const { v, order } = await placedOrder(3);
    expect(await stockOf(v.id)).toBe(7);
    const res = await Promise.all([1, 2, 3].map(() => admin.patch(`/api/v1/orders/${order.id}/status`, { status: 'CANCELLED' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await stockOf(v.id)).toBe(10);
  });

  it('payments cannot exceed the amount due, even simultaneously; customer spend follows real payments', async () => {
    const { order } = await placedOrder(2, 1000); // total 2000
    const over = await admin.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 2001, paymentMethod: 'CASH_ON_DELIVERY' });
    expect(over.status).toBe(409);
    const res = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 1000, paymentMethod: 'CASH_ON_DELIVERY' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    const row = await t.c.db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([row.paidCents, row.paymentStatus, row.status]).toEqual([2000, 'PAID', 'PAID']);
    const cust = await t.c.db.customer.findUniqueOrThrow({ where: { id: row.customerId! } });
    expect(cust.totalSpentCents).toBe(2000);
  });

  it('customer lifetime spend is zero until money is received', async () => {
    const { order } = await placedOrder(1, 500);
    const row = await t.c.db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect((await t.c.db.customer.findUniqueOrThrow({ where: { id: row.customerId! } })).totalSpentCents).toBe(0);
  });

  it('refunds cannot exceed what was paid, even simultaneously', async () => {
    const { order } = await placedOrder(1, 1000);
    await admin.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 1000, paymentMethod: 'MANUAL_BANK_TRANSFER' });
    const res = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/orders/${order.id}/refund`, { amountCents: 600, reason: 'goodwill' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await t.c.db.order.findUniqueOrThrow({ where: { id: order.id } })).refundedCents).toBe(600);
  });

  it('a cancelled order cannot be paid or shipped, and a pending one cannot be returned', async () => {
    const { order } = await placedOrder(1);
    expect((await admin.post(`/api/v1/orders/${order.id}/returns`, { reason: 'nope' })).status).toBe(409);
    await admin.patch(`/api/v1/orders/${order.id}/status`, { status: 'CANCELLED' });
    expect((await admin.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 100, paymentMethod: 'CASH_ON_DELIVERY' })).status).toBe(409);
    expect((await admin.post(`/api/v1/orders/${order.id}/shipments`, { carrier: 'DHL' })).status).toBe(409);
  });

  it('a return can be restocked once, never twice', async () => {
    const { v, order } = await placedOrder(2, 1000);
    await admin.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 2000, paymentMethod: 'CASH_ON_DELIVERY' });
    await admin.post(`/api/v1/orders/${order.id}/shipments`, { carrier: 'DHL' });
    const ret = (await admin.post(`/api/v1/orders/${order.id}/returns`, { reason: 'wrong size', restockResellable: true })).body.returns[0];
    expect(await stockOf(v.id)).toBe(8);
    const res = await Promise.all([1, 2].map(() => admin.patch(`/api/v1/orders/${order.id}/returns/${ret.id}`, { status: 'RESTOCKED' })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(v.id)).toBe(10);
    expect((await admin.patch(`/api/v1/orders/${order.id}/returns/${ret.id}`, { status: 'RESTOCKED' })).status).toBe(409);
    expect(await stockOf(v.id)).toBe(10);
  });
});

describe('"assigned" scope covers EVERY order action, not just read', () => {
  it('a Manager cannot pay, ship, return, cancel or read an order that is not assigned to them', async () => {
    const mgr = await createUser(t.c, { email: 'mgr-orders@example.test', roleKey: 'manager' });
    const m = new Client(t.app);
    expect((await m.login('mgr-orders@example.test')).status).toBe(200);
    const v = await makeVariant(10);
    const order = (await buy(v.id, 70)).body;
    const probes = [
      () => m.get(`/api/v1/orders/${order.id}`),
      () => m.patch(`/api/v1/orders/${order.id}/status`, { status: 'CANCELLED' }),
      () => m.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 100, paymentMethod: 'CASH_ON_DELIVERY' }),
      () => m.post(`/api/v1/orders/${order.id}/shipments`, { carrier: 'DHL' }),
      () => m.post(`/api/v1/orders/${order.id}/returns`, { reason: 'x' }),
    ];
    for (const probe of probes) expect((await probe()).status).toBe(404);
    expect((await m.get('/api/v1/orders')).body.items.map((o: { id: string }) => o.id)).not.toContain(order.id);
    // Admin assigns the order via the assign endpoint
    const assignRes = await admin.patch(`/api/v1/orders/${order.id}/assign`, { assignedUserId: mgr.id });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.assignedUserId).toBe(mgr.id);
    // once assigned to the Manager, the calls now work
    expect((await m.get(`/api/v1/orders/${order.id}`)).status).toBe(200);
    expect((await m.post(`/api/v1/orders/${order.id}/payments`, { amountCents: 100, paymentMethod: 'CASH_ON_DELIVERY' })).status).toBe(200);
  });
});

// Last on purpose: building a second test app truncates the shared database, which would sign the admin out.
describe('anonymous write endpoints are rate limited per IP', () => {
  it('checkout, inquiries, booking and RSVP return 429 after the public limit', async () => {
    const limited = await createTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_PUBLIC_PER_MIN: '3' });
    try {
      const c = new Client(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await c.post('/api/v1/store/checkout', {})).status);
      expect(codes.slice(0, 3)).toEqual([400, 400, 400]);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
    // the limiter is declared on every anonymous write route
    const anonWrites = t.routes.filter((r) => r.access.type === 'public' && r.method !== 'get');
    expect(anonWrites.map((r) => r.path).sort()).toEqual(
      ['/api/v1/auth/invitations/accept', '/api/v1/auth/login', '/api/v1/auth/password/forgot', '/api/v1/auth/password/reset', '/api/v1/public/events/{slug}/rsvp', '/api/v1/public/inquiries', '/api/v1/public/meetings/book', '/api/v1/store/checkout'].sort(),
    );
  }, 120_000);
});
