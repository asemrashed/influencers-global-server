import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiProvider } from '../src/providers/index.js';
import { Client, createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

const SCHEMA = 'pgboss_test';
let t: TestApp;
let admin: Client;

const calls: string[] = [];
const fakeAi: AiProvider = {
  name: 'fake',
  classifyMessage: async (i) => (calls.push(`classify:${i.body}`), { category: 'SPAM', confidence: 0.2 }),
  summarizeThread: async (i) => (calls.push('summarize'), { summary: `${i.messages.length} message(s)` }),
  draftReply: async (i) => (calls.push('draft'), { subject: `Re: ${i.subject}`, body: 'Model-written draft' }),
  scoreMeeting: async () => ({ score: 12, recommendation: 'Below the rate floor' }),
  detectLead: async () => ({ intentDetected: false, leadScore: 3 }),
};

beforeAll(async () => {
  t = await createTestApp(
    { JOBS_ENABLED: 'true', EMAIL_PROVIDER: 'console', EMAIL_FROM: 'no-reply@example.test' },
    { jobsSchema: SCHEMA, providers: { ai: fakeAi } },
  );
  await t.c.jobs.start();
  admin = (await signInWithTwoFactor(t, 'wf-admin@example.test', 'admin')).client;
}, 90_000);
afterAll(async () => {
  await t.close();
});

const queued = async () =>
  (await t.c.db.$queryRawUnsafe<{ data: { to: string; subject: string }; start_after: Date }[]>(`SELECT data, start_after FROM ${SCHEMA}.job WHERE name = 'email.send' ORDER BY created_on`));

const rule = (over: Record<string, unknown> = {}) =>
  admin.post('/api/v1/workflows/rules', {
    name: 'Confirm', trigger: 'ORDER_CREATED', approvalLevel: 'AUTOMATIC',
    actions: [{ type: 'SEND_EMAIL', toPayloadField: 'customerEmail', subject: 'Thanks', text: 'Got it.' }], ...over,
  });

describe('AI routes use the provider and nothing else', () => {
  it('returns what the provider produced, never canned values, and drafts always wait for a human', async () => {
    await new Client(t.app).post('/api/v1/public/inquiries', { name: 'Brand', email: 'b@acme.test', subject: 'Collab', message: 'Hello there' });
    const thread = (await admin.get('/api/v1/inbox/threads')).body.items[0];
    const message = await t.c.db.inboxMessage.findFirstOrThrow({ where: { threadId: thread.id } });

    const classify = await admin.post('/api/v1/ai/inbox/classify', { messageId: message.id });
    expect(classify.body.outputData).toEqual({ category: 'SPAM', confidence: 0.2 });
    expect((await admin.post('/api/v1/ai/inbox/summarize', { threadId: thread.id })).body.outputData).toEqual({ summary: '1 message(s)' });
    const draft = await admin.post('/api/v1/ai/inbox/draft-reply', { threadId: thread.id });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ approvalLevel: 'ALWAYS_HUMAN', approvedAt: null, executedAt: null, outputData: { suggestedBody: 'Model-written draft' } });
    expect(calls).toContain('classify:Hello there');

    // approving records the decision; it does not pretend anything was sent, and it can only happen once
    const approved = await admin.post(`/api/v1/ai/actions/${draft.body.id}/decide`, { action: 'APPROVE' });
    expect(approved.status).toBe(200);
    expect(approved.body.executedAt).toBeNull();
    expect((await admin.post(`/api/v1/ai/actions/${draft.body.id}/decide`, { action: 'REJECT' })).status).toBe(409);
    expect((await admin.post(`/api/v1/ai/actions/${classify.body.id}/decide`, { action: 'APPROVE' })).status).toBe(409); // automatic: nothing to approve
  });
});

describe('workflow engine really acts', () => {
  it('an AUTOMATIC rule queues the email to the address in the payload, honoring conditions and delay', async () => {
    expect((await rule({ conditions: [{ field: 'totalCents', operator: 'gte', value: 1000 }], delaySeconds: 3600 })).status).toBe(201);
    const small = await admin.post('/api/v1/workflows/trigger', { trigger: 'ORDER_CREATED', payload: { totalCents: 500, customerEmail: 'small@example.test' } });
    expect(small.body).toEqual([]); // condition not met: no run at all
    const big = await admin.post('/api/v1/workflows/trigger', { trigger: 'ORDER_CREATED', payload: { totalCents: 5000, customerEmail: 'big@example.test' } });
    expect(big.body[0]).toMatchObject({ status: 'SUCCESS', executionResult: { queued: ['SEND_EMAIL:0'] } });
    const jobs = await queued();
    const job = jobs.find((j) => j.data.to === 'big@example.test')!;
    expect(job.data.subject).toBe('Thanks');
    expect(job.start_after.getTime()).toBeGreaterThan(Date.now() + 3_000_000); // delayed ~1h
    expect(jobs.some((j) => j.data.to === 'small@example.test')).toBe(false);
  });

  it('a missing or malformed recipient FAILS the run instead of reporting success', async () => {
    const run = await admin.post('/api/v1/workflows/trigger', { trigger: 'ORDER_CREATED', payload: { totalCents: 9000, customerEmail: 'not-an-email' } });
    expect(run.body[0]).toMatchObject({ status: 'FAILED' });
    expect(run.body[0].errorMessage).toMatch(/valid email/);
  });

  it('a human-approval rule waits, sends nothing until approved, and can be decided only once', async () => {
    await admin.patch(`/api/v1/workflows/rules/${(await admin.get('/api/v1/workflows/rules')).body[0].id}`, { isEnabled: false });
    for (const r of (await admin.get('/api/v1/workflows/rules')).body) await admin.patch(`/api/v1/workflows/rules/${r.id}`, { isEnabled: false });
    await rule({ name: 'Needs OK', trigger: 'LEAD_CREATED', approvalLevel: 'ALWAYS_HUMAN' });
    const before = (await queued()).length;
    const pending = (await admin.post('/api/v1/workflows/trigger', { trigger: 'LEAD_CREATED', payload: { customerEmail: 'lead@example.test' } })).body[0];
    expect(pending.status).toBe('PENDING_APPROVAL');
    expect((await queued()).length).toBe(before);

    const res = await Promise.all([1, 2].map(() => admin.post(`/api/v1/workflows/runs/${pending.id}/decide`, { action: 'APPROVE' })));
    expect(res.map((r) => r.status).sort()).toContain(200);
    expect((await queued()).filter((j) => j.data.to === 'lead@example.test')).toHaveLength(1); // dedupe: sent once even if approved twice
    expect((await admin.post(`/api/v1/workflows/runs/${pending.id}/decide`, { action: 'REJECT' })).status).toBe(409);

    const other = (await admin.post('/api/v1/workflows/trigger', { trigger: 'LEAD_CREATED', payload: { customerEmail: 'l2@example.test' } })).body[0];
    const rejected = await admin.post(`/api/v1/workflows/runs/${other.id}/decide`, { action: 'REJECT', reason: 'no' });
    expect(rejected.body.status).toBe('REJECTED');
    expect((await queued()).some((j) => j.data.to === 'l2@example.test')).toBe(false);
  });

  it('real events fire workflows: a public inquiry and a checkout', async () => {
    for (const r of (await admin.get('/api/v1/workflows/rules')).body) await admin.patch(`/api/v1/workflows/rules/${r.id}`, { isEnabled: false });
    await rule({ name: 'On inquiry', trigger: 'INBOX_MESSAGE_RECEIVED', actions: [{ type: 'SEND_EMAIL', to: 'owner@example.test', subject: 'New inquiry', text: 'Check your inbox.' }] });
    await new Client(t.app).post('/api/v1/public/inquiries', { name: 'X', email: 'x@y.test', subject: 'Hello again', message: 'A new message for you' });
    expect((await queued()).some((j) => j.data.to === 'owner@example.test')).toBe(true);

    await rule({ name: 'On order', trigger: 'ORDER_CREATED' });
    const cat = (await admin.post('/api/v1/products/categories', { slug: 'wf', name: 'WF', sortOrder: 1 })).body;
    const prod = (await admin.post('/api/v1/products', { slug: 'wf-p', name: 'WF', description: 'd', categoryId: cat.id, isActive: true, imageIds: [], variants: [{ sku: 'WF-1', title: 'S', priceCents: 700, stock: 3, isActive: true }] })).body;
    const order = await new Client(t.app).post('/api/v1/store/checkout', { customerEmail: 'shopper@example.test', customerName: 'S', shippingAddress: { street: '1' }, items: [{ variantId: prod.variants[0].id, quantity: 1 }] });
    expect(order.status).toBe(201);
    expect((await queued()).some((j) => j.data.to === 'shopper@example.test')).toBe(true);
  });

  it('a failing workflow never fails the customer\'s order', async () => {
    const spy = vi.spyOn(t.c.db.workflowRule, 'findMany').mockRejectedValueOnce(new Error('db hiccup'));
    const v = (await t.c.db.productVariant.findFirstOrThrow({ where: { sku: 'WF-1' } })).id;
    const order = await new Client(t.app).post('/api/v1/store/checkout', { customerEmail: 'calm@example.test', customerName: 'C', shippingAddress: { street: '1' }, items: [{ variantId: v, quantity: 1 }] });
    spy.mockRestore();
    expect(order.status).toBe(201);
  });

  it('rejects actions the server cannot perform and both-or-neither recipients', async () => {
    for (const actions of [
      [{ type: 'LAUNCH_ROCKET' }],
      [{ type: 'SEND_EMAIL', subject: 's', text: 't' }],
      [{ type: 'SEND_EMAIL', to: 'a@b.test', toPayloadField: 'x', subject: 's', text: 't' }],
      [{ type: 'SEND_EMAIL', toPayloadField: 'a b', subject: 's', text: 't' }],
    ]) expect((await rule({ actions })).status).toBe(400);
  });
});
