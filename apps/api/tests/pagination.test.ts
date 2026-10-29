import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;
beforeAll(async () => {
  t = await createTestApp();
  admin = (await signInWithTwoFactor(t, 'pager@example.test', 'admin')).client;
  const cat = (await admin.post('/api/v1/products/categories', { slug: 'pg', name: 'PG', sortOrder: 1 })).body;
  for (let i = 1; i <= 5; i++) {
    const prod = (await admin.post('/api/v1/products', { slug: `pg-${i}`, name: `Item ${i}`, description: 'd', categoryId: cat.id, isActive: true, imageIds: [], variants: [{ sku: `PG-${i}`, title: 'S', priceCents: 100, stock: 5, isActive: true }] })).body;
    await new Client(t.app).post('/api/v1/store/checkout', { customerEmail: `pg${i}@example.test`, customerName: `P${i}`, shippingAddress: { street: '1' }, items: [{ variantId: prod.variants[0].id, quantity: 1 }] });
  }
}, 90_000);
afterAll(async () => {
  if (t) await t.close();
});

/** Walks every page with a tiny page size and returns all ids in order. */
async function walk(client: Client, path: string, limit = 2): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const res = await client.get(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(limit);
    ids.push(...res.body.items.map((i: { id: string }) => i.id));
    cursor = res.body.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error('pagination did not terminate');
}

describe('list endpoints are cursor-paginated', () => {
  it.each([
    ['/api/v1/orders', 5],
    ['/api/v1/customers', 5],
    ['/api/v1/store/products', 5],
  ])('%s returns every row exactly once across pages', async (path, count) => {
    const ids = await walk(path === '/api/v1/store/products' ? new Client(t.app) : admin, path);
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
  });

  it('the last page has no nextCursor, a full page below the limit never invents one', async () => {
    const res = await admin.get('/api/v1/orders?limit=100');
    expect(res.body.items).toHaveLength(5);
    expect(res.body.nextCursor).toBeUndefined();
  });

  it('refuses unbounded page sizes on every paginated list', async () => {
    for (const path of ['/api/v1/orders', '/api/v1/customers', '/api/v1/earnings/invoices', '/api/v1/earnings/entries', '/api/v1/ai/actions', '/api/v1/workflows/runs', '/api/v1/store/products', '/api/v1/public/portfolio/albums']) {
      expect([path, (await admin.get(`${path}?limit=101`)).status]).toEqual([path, 400]);
      expect([path, (await admin.get(path)).status]).toEqual([path, 200]);
    }
  });

  it('no list route returns a bare array any more, except the small config lists that are bounded by design', async () => {
    const bare = t.routes
      .filter((r) => r.method === 'get' && r.response.schema && (r.response.schema as { _zod?: { def?: { type?: string } } })._zod?.def?.type === 'array')
      .map((r) => r.path)
      .sort();
    expect(bare).toEqual(
      ['/api/v1/public/meetings/slots', '/api/v1/rate-card', '/api/v1/social/accounts', '/api/v1/store/categories', '/api/v1/workflows/rules'].sort(),
    );
  });
});
