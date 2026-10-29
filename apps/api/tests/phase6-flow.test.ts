import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 90_000);

afterAll(async () => {
  if (t) await t.close();
});

describe('Phase 6 E2E Flow — Customers, Commerce & Earnings', () => {
  it(
    'runs complete commerce and earnings workflow with invariants enforced',
    async () => {
    // 1. Admin signs in
    const { client: admin } = await signInWithTwoFactor(t, 'admin_commerce@example.test', 'admin');

    // 2. Create Product Category & Product with Variants
    const catRes = await admin.post('/api/v1/products/categories', {
      slug: 'merch',
      name: 'Official Merchandise',
      description: 'Apparel and accessories',
      sortOrder: 1,
    });
    expect(catRes.status).toBe(201);
    const category = catRes.body;

    const prodRes = await admin.post('/api/v1/products', {
      slug: 'tour-hoodie',
      name: 'Tour 2026 Hoodie',
      description: 'Heavyweight organic cotton hoodie',
      categoryId: category.id,
      isActive: true,
      imageIds: [],
      variants: [
        { sku: 'HOODIE-BLK-M', title: 'Black / M', priceCents: 6500, stock: 10, isActive: true },
        { sku: 'HOODIE-BLK-L', title: 'Black / L', priceCents: 6500, stock: 5, isActive: true },
      ],
    });
    expect(prodRes.status).toBe(201);
    const product = prodRes.body;
    expect(product.variants).toHaveLength(2);
    const variantM = product.variants.find((v: any) => v.sku === 'HOODIE-BLK-M');

    // 3. Create Promo Code
    const promoRes = await admin.post('/api/v1/promo-codes', {
      code: 'VIP10',
      discountBps: 1000, // 10%
      isActive: true,
    });
    expect(promoRes.status).toBe(201);

    // 4. Public storefront catalog check
    const guest = new Client(t.app);
    const storeCategories = await guest.get('/api/v1/store/categories');
    expect(storeCategories.status).toBe(200);
    expect(storeCategories.body.length).toBeGreaterThan(0);

    const storeProducts = await guest.get(`/api/v1/store/products?categoryId=${category.id}`);
    expect(storeProducts.status).toBe(200);
    expect(storeProducts.body.items.some((p: any) => p.slug === 'tour-hoodie')).toBe(true);

    // 5. Invariant check: Online payment attempt must be rejected while PAYMENT_PROVIDER is blank
    const fakeOnlineCheckout = await guest.post('/api/v1/store/checkout', {
      customerEmail: 'fan@example.com',
      customerName: 'Loyal Fan',
      shippingAddress: { street: '123 Main St', city: 'Metropolis', country: 'US' },
      items: [{ variantId: variantM.id, quantity: 2 }],
      paymentMethod: 'STRIPE',
    });
    expect(fakeOnlineCheckout.status).toBe(400);

    // 6. Checkout with offline method (CASH_ON_DELIVERY) and promo code
    const checkoutRes = await guest.post('/api/v1/store/checkout', {
      customerEmail: 'fan@example.com',
      customerName: 'Loyal Fan',
      shippingAddress: { street: '123 Main St', city: 'Metropolis', country: 'US' },
      items: [{ variantId: variantM.id, quantity: 2 }], // 2 * 6500 = 13000
      promoCode: 'VIP10', // -1300 = 11700
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: 'checkout-fan-001',
    });
    expect(checkoutRes.status).toBe(201);
    const order = checkoutRes.body;
    expect(order.subtotalCents).toBe(13000);
    expect(order.discountCents).toBe(1300);
    expect(order.totalCents).toBe(11700);
    expect(order.status).toBe('PENDING');
    expect(order.paymentStatus).toBe('UNPAID');

    // Idempotency: replay identical checkout returns same order without double decrements
    const replayRes = await guest.post('/api/v1/store/checkout', {
      customerEmail: 'fan@example.com',
      customerName: 'Loyal Fan',
      shippingAddress: { street: '123 Main St', city: 'Metropolis', country: 'US' },
      items: [{ variantId: variantM.id, quantity: 2 }],
      promoCode: 'VIP10',
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: 'checkout-fan-001',
    });
    expect(replayRes.status).toBe(201);
    expect(replayRes.body.id).toBe(order.id);

    // Verify stock was decremented by 2 (initial 10 -> 8)
    const updatedStore = await guest.get('/api/v1/store/products?search=Tour');
    const currentM = updatedStore.body.items[0].variants.find((v: any) => v.id === variantM.id);
    expect(currentM.stock).toBe(8);

    // Invariant: Stock cannot go negative
    const stockOverdraw = await admin.post(`/api/v1/products/variants/${variantM.id}/adjust-stock`, {
      quantity: -100,
      reason: 'Trying to overdraw',
    });
    expect(stockOverdraw.status).toBe(409);

    // 7. Admin manages order payment and transition
    // Illegal transition: PENDING directly to DELIVERED is rejected
    const badTransition = await admin.patch(`/api/v1/orders/${order.id}/status`, {
      status: 'DELIVERED',
    });
    expect(badTransition.status).toBe(409);

    // Record offline payment
    const paymentRes = await admin.post(`/api/v1/orders/${order.id}/payments`, {
      amountCents: 11700,
      paymentMethod: 'CASH_ON_DELIVERY',
      reference: 'COD-CASH-REC-01',
    });
    expect(paymentRes.status).toBe(200);
    expect(paymentRes.body.paidCents).toBe(11700);
    expect(paymentRes.body.paymentStatus).toBe('PAID');
    expect(paymentRes.body.status).toBe('PAID');

    // Create Shipment -> Status becomes FULFILLED
    const shipRes = await admin.post(`/api/v1/orders/${order.id}/shipments`, {
      carrier: 'DHL Express',
      trackingNumber: 'DHL987654321',
    });
    expect(shipRes.status).toBe(200);
    expect(shipRes.body.status).toBe('FULFILLED');

    // Deliver order
    const deliverRes = await admin.patch(`/api/v1/orders/${order.id}/status`, {
      status: 'DELIVERED',
    });
    expect(deliverRes.status).toBe(200);
    expect(deliverRes.body.status).toBe('DELIVERED');

    // 8. Return & Refund with Invariant: Refund cannot exceed paid amount
    const excessiveRefund = await admin.post(`/api/v1/orders/${order.id}/refund`, {
      amountCents: 999999,
      reason: 'Too generous',
    });
    expect(excessiveRefund.status).toBe(409);

    // Valid partial refund
    const refundRes = await admin.post(`/api/v1/orders/${order.id}/refund`, {
      amountCents: 5000,
      reason: 'Customer courtesy refund',
    });
    expect(refundRes.status).toBe(200);
    expect(refundRes.body.refundedCents).toBe(5000);
    expect(refundRes.body.paymentStatus).toBe('PARTIALLY_REFUNDED');

    // Return request & Restock
    const returnReqRes = await admin.post(`/api/v1/orders/${order.id}/returns`, {
      reason: 'Size exchange requested',
      restockResellable: true,
    });
    expect(returnReqRes.status).toBe(200);
    const returnId = returnReqRes.body.returns[0].id;

    const decideReturnRes = await admin.patch(`/api/v1/orders/${order.id}/returns/${returnId}`, {
      status: 'RESTOCKED',
      decisionNotes: 'Item in perfect condition, restocked to inventory',
    });
    expect(decideReturnRes.status).toBe(200);

    // Verify stock restored (8 + 2 = 10)
    const restoredStore = await guest.get('/api/v1/store/products?search=Tour');
    const restoredM = restoredStore.body.items[0].variants.find((v: any) => v.id === variantM.id);
    expect(restoredM.stock).toBe(10);

    // 9. Invoices & Partial Payments
    const invRes = await admin.post('/api/v1/earnings/invoices', {
      invoiceNumber: `INV-2026-${Date.now()}`,
      clientName: 'Acme Brands Corp',
      clientEmail: 'billing@acmebrands.com',
      dueDate: new Date(Date.now() + 86400000 * 30).toISOString(),
      subtotalCents: 500000, // $5,000.00
      taxCents: 50000,       // $500.00
      milestones: [
        { title: 'Initial deposit', amountCents: 275000, dueDate: new Date().toISOString() },
        { title: 'Completion payment', amountCents: 275000, dueDate: new Date(Date.now() + 86400000 * 15).toISOString() },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoice = invRes.body;
    expect(invoice.totalCents).toBe(550000);
    expect(invoice.status).toBe('ISSUED');

    // Partial payment #1: $2,750
    const partPayRes = await admin.post(`/api/v1/earnings/invoices/${invoice.id}/payments`, {
      amountCents: 275000,
      paymentMethod: 'MANUAL_BANK_TRANSFER',
      reference: 'WIRE-ACME-001',
      source: 'MANUAL',
    });
    expect(partPayRes.status).toBe(200);
    expect(partPayRes.body.paidCents).toBe(275000);
    expect(partPayRes.body.status).toBe('PARTIALLY_PAID');

    // Remaining payment #2: $2,750 -> invoice reaches PAID
    const fullPayRes = await admin.post(`/api/v1/earnings/invoices/${invoice.id}/payments`, {
      amountCents: 275000,
      paymentMethod: 'MANUAL_BANK_TRANSFER',
      reference: 'WIRE-ACME-002',
      source: 'MANUAL',
    });
    expect(fullPayRes.status).toBe(200);
    expect(fullPayRes.body.paidCents).toBe(550000);
    expect(fullPayRes.body.status).toBe('PAID');

    // 10. Check Earnings Summary & Provenance Tags
    const earningsRes = await admin.get('/api/v1/earnings/summary');
    expect(earningsRes.status).toBe(200);
    expect(earningsRes.body.totalEarnedCents).toBeGreaterThanOrEqual(550000);
    expect(earningsRes.body.totalOrdersRevenueCents).toBe(11700);

    const entriesRes = await admin.get('/api/v1/earnings/entries');
    expect(entriesRes.status).toBe(200);
    expect(entriesRes.body.items.length).toBeGreaterThan(0);
    expect(entriesRes.body.items.every((e: any) => e.source === 'MANUAL' || e.source === 'SYNCED')).toBe(true);
  },
  60_000,
);
});
