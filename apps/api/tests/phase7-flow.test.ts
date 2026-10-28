import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 180_000);

afterAll(async () => {
  if (t) await t.close();
});

describe('Phase 7 E2E Flow — AI & Automation', () => {
  it(
    'verifies AI capability guard, draft reply approval gate, and workflow execution engine',
    async () => {
      // 1. Admin signs in
      const { client: admin } = await signInWithTwoFactor(t, 'admin_ai@example.test', 'admin');

      // 2. Invariant Check: AI provider is unset (AI capability is OFF) -> AI routes reject with 503
      // Create an inbox thread via public inquiry
      const inquiryRes = await admin.post('/api/v1/public/inquiries', {
        name: 'Brand Rep',
        email: 'brand@acme.test',
        brandName: 'Acme Brand',
        subject: 'Brand Collaboration Q4',
        message: 'We would love to sponsor your upcoming holiday video.',
      });
      expect(inquiryRes.status).toBe(201);

      const threadsList = await admin.get('/api/v1/inbox/threads');
      expect(threadsList.status).toBe(200);
      const threadId = threadsList.body.items[0].id;

      // Classify route must reject with 503 CAPABILITY_DISABLED because AI_PROVIDER is blank
      const classifyRes = await admin.post('/api/v1/ai/inbox/summarize', {
        threadId,
      });
      expect(classifyRes.status).toBe(503);
      expect(classifyRes.body.code).toBe('CAPABILITY_DISABLED');

      const draftRes = await admin.post('/api/v1/ai/inbox/draft-reply', {
        threadId,
        contextNotes: 'Offer standard rate card',
      });
      expect(draftRes.status).toBe(503);
      expect(draftRes.body.code).toBe('CAPABILITY_DISABLED');

      // 3. Human Approval Gate Invariant:
      // When an action is recorded in AiAction, drafts must stay in human approval level
      const dummyAction = await t.c.db.aiAction.create({
        data: {
          taskType: 'REPLY_DRAFT',
          inputData: { threadId, contextNotes: 'Offer rate card' },
          outputData: {
            suggestedSubject: 'Re: Brand Collaboration Q4',
            suggestedBody: 'Thank you for reaching out! Our holiday rate card is attached.',
          },
          approvalLevel: 'ALWAYS_HUMAN',
        },
      });
      expect(dummyAction.approvalLevel).toBe('ALWAYS_HUMAN');
      expect(dummyAction.approvedAt).toBeNull();

      // List pending approval actions
      const pendingListRes = await admin.get('/api/v1/ai/actions?pendingApproval=true');
      expect(pendingListRes.status).toBe(200);
      expect(pendingListRes.body.some((a: any) => a.id === dummyAction.id)).toBe(true);

      // Human review: Reject action
      const rejectRes = await admin.post(`/api/v1/ai/actions/${dummyAction.id}/decide`, {
        action: 'REJECT',
        rejectionReason: 'Needs customized pricing for holiday package',
      });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.rejectionReason).toBe('Needs customized pricing for holiday package');
      expect(rejectRes.body.approvedAt).toBeNull();

      // Human review: Create another action and Approve it
      const approveAction = await t.c.db.aiAction.create({
        data: {
          taskType: 'REPLY_DRAFT',
          inputData: { threadId },
          outputData: {
            suggestedSubject: 'Re: Brand Collaboration Q4',
            suggestedBody: 'Approved custom reply for holiday package.',
          },
          approvalLevel: 'ALWAYS_HUMAN',
        },
      });

      const approveRes = await admin.post(`/api/v1/ai/actions/${approveAction.id}/decide`, {
        action: 'APPROVE',
      });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.approvedAt).not.toBeNull();
      expect(approveRes.body.approvedById).not.toBeNull();

      // 4. Workflow Rules Engine
      // Create automated workflow rule: on ORDER_CREATED -> send notification
      const ruleRes = await admin.post('/api/v1/workflows/rules', {
        name: 'Order Confirmation Notification',
        description: 'Notify creator team when an order is placed',
        trigger: 'ORDER_CREATED',
        conditions: [{ field: 'totalCents', operator: 'gt', value: 0 }],
        actions: [{ type: 'INTERNAL_NOTIFICATION', message: 'New merchandise order placed!' }],
        delaySeconds: 0,
        isEnabled: true,
        approvalLevel: 'AUTOMATIC',
      });
      expect(ruleRes.status).toBe(201);
      const rule = ruleRes.body;
      expect(rule.trigger).toBe('ORDER_CREATED');

      // Trigger workflow engine with ORDER_CREATED event
      const triggerRes = await admin.post('/api/v1/workflows/trigger', {
        trigger: 'ORDER_CREATED',
        payload: {
          orderNumber: 'ORD-TEST-999',
          totalCents: 15000,
          customerEmail: 'fan@example.test',
        },
      });
      expect(triggerRes.status).toBe(200);
      expect(triggerRes.body.length).toBeGreaterThan(0);
      const executedRun = triggerRes.body.find((r: any) => r.ruleId === rule.id);
      expect(executedRun).toBeDefined();
      expect(executedRun.status).toBe('SUCCESS');
      expect(executedRun.completedAt).not.toBeNull();

      // Verify execution run appears in audit log
      const runsListRes = await admin.get(`/api/v1/workflows/runs?ruleId=${rule.id}`);
      expect(runsListRes.status).toBe(200);
      expect(runsListRes.body.length).toBeGreaterThan(0);
      expect(runsListRes.body[0].status).toBe('SUCCESS');
    },
    60_000,
  );
});

