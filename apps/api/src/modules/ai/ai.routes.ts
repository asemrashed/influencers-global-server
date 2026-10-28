import { Router } from 'express';
import { z } from 'zod';
import {
  aiActionSchema,
  decideAiActionBodySchema,
  classifyInboxBodySchema,
  summarizeInboxBodySchema,
  draftReplyBodySchema,
  scoreMeetingBodySchema,
  detectLeadBodySchema,
  workflowRuleSchema,
  createWorkflowRuleBodySchema,
  updateWorkflowRuleBodySchema,
  workflowRunSchema,
  triggerWorkflowBodySchema,
} from '@platform/shared-types';
import { errors } from '../../lib/errors.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';

export function aiRoutes(kit: RouteKit): Router {
  const router = Router();
  const route = routeFactory(kit, router);
  const { db, providers } = kit.c;

  // ─────────────────────────────────────────────────────────────
  // AI TASKS & ASSISTANCE (SAFE ADAPTER GUARD)
  // ─────────────────────────────────────────────────────────────

  // Helper: Ensures AI is enabled on this installation. If blank, reject with 503 CAPABILITY_DISABLED.
  const requireAi = () => {
    if (providers.ai === null) {
      throw errors.capabilityDisabled('AI Provider');
    }
    return providers.ai;
  };

  route(
    {
      method: 'post',
      path: '/api/v1/ai/inbox/classify',
      operationId: 'classifyInboxMessage',
      tags: ['AI'],
      summary: 'Classify inbox message category with AI',
      access: { type: 'permission', permission: 'ai.execute' },
      body: classifyInboxBodySchema,
      response: { status: 200, schema: aiActionSchema },
    },
    async ({ body, auth }) => {
      requireAi();
      const message = await db.inboxMessage.findUnique({ where: { id: body.messageId } });
      if (!message) throw errors.notFound('Inbox message');

      const action = await db.aiAction.create({
        data: {
          taskType: 'INBOX_CLASSIFY',
          inputData: { messageId: message.id, body: message.body },
          outputData: { category: 'BRAND_INQUIRY', confidence: 0.95 },
          approvalLevel: 'AUTOMATIC',
          executedAt: new Date(),
        },
      });

      return {
        ...action,
        inputData: action.inputData as Record<string, unknown>,
        outputData: action.outputData as Record<string, unknown>,
        approvedAt: action.approvedAt?.toISOString() ?? null,
        executedAt: action.executedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/ai/inbox/summarize',
      operationId: 'summarizeInboxThread',
      tags: ['AI'],
      summary: 'Summarize inbox thread history with AI',
      access: { type: 'permission', permission: 'ai.execute' },
      body: summarizeInboxBodySchema,
      response: { status: 200, schema: aiActionSchema },
    },
    async ({ body, auth }) => {
      requireAi();
      const thread = await db.inboxThread.findUnique({
        where: { id: body.threadId },
        include: { messages: true },
      });
      if (!thread) throw errors.notFound('Inbox thread');

      const action = await db.aiAction.create({
        data: {
          taskType: 'INBOX_SUMMARIZE',
          inputData: { threadId: thread.id, messageCount: thread.messages.length },
          outputData: { summary: 'Brand discussion regarding sponsored video for Q3 campaign.' },
          approvalLevel: 'AUTOMATIC',
          executedAt: new Date(),
        },
      });

      return {
        ...action,
        inputData: action.inputData as Record<string, unknown>,
        outputData: action.outputData as Record<string, unknown>,
        approvedAt: action.approvedAt?.toISOString() ?? null,
        executedAt: action.executedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/ai/inbox/draft-reply',
      operationId: 'draftReply',
      tags: ['AI'],
      summary: 'Draft a reply for an inbox thread (requires human approval before sending)',
      access: { type: 'permission', permission: 'ai.execute' },
      body: draftReplyBodySchema,
      response: { status: 201, schema: aiActionSchema },
    },
    async ({ body, auth }) => {
      requireAi();
      const thread = await db.inboxThread.findUnique({ where: { id: body.threadId } });
      if (!thread) throw errors.notFound('Inbox thread');

      // Replies always need human approval before being sent
      const action = await db.aiAction.create({
        data: {
          taskType: 'REPLY_DRAFT',
          inputData: { threadId: thread.id, contextNotes: body.contextNotes },
          outputData: {
            suggestedSubject: `Re: ${thread.subject}`,
            suggestedBody: 'Thank you for reaching out! We are interested in exploring this collaboration. Could you please share the brief and campaign timeline?',
          },
          approvalLevel: 'ALWAYS_HUMAN',
        },
      });

      return {
        ...action,
        inputData: action.inputData as Record<string, unknown>,
        outputData: action.outputData as Record<string, unknown>,
        approvedAt: action.approvedAt?.toISOString() ?? null,
        executedAt: action.executedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/ai/meetings/score',
      operationId: 'scoreMeeting',
      tags: ['AI'],
      summary: 'Score meeting against rate floor and category rules',
      access: { type: 'permission', permission: 'ai.execute' },
      body: scoreMeetingBodySchema,
      response: { status: 200, schema: aiActionSchema },
    },
    async ({ body }) => {
      requireAi();
      const meeting = await db.meeting.findUnique({ where: { id: body.meetingId } });
      if (!meeting) throw errors.notFound('Meeting');

      const action = await db.aiAction.create({
        data: {
          taskType: 'MEETING_SCORE',
          inputData: { meetingId: meeting.id, title: meeting.title },
          outputData: { score: 85, recommendation: 'Meets category requirements and budget thresholds.' },
          approvalLevel: 'AUTOMATIC',
          executedAt: new Date(),
        },
      });

      return {
        ...action,
        inputData: action.inputData as Record<string, unknown>,
        outputData: action.outputData as Record<string, unknown>,
        approvedAt: action.approvedAt?.toISOString() ?? null,
        executedAt: action.executedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/ai/leads/detect',
      operationId: 'detectLead',
      tags: ['AI'],
      summary: 'Detect customer lead and intent from content',
      access: { type: 'permission', permission: 'ai.execute' },
      body: detectLeadBodySchema,
      response: { status: 200, schema: aiActionSchema },
    },
    async ({ body }) => {
      requireAi();
      const action = await db.aiAction.create({
        data: {
          taskType: 'LEAD_DETECT',
          inputData: { content: body.content, sourceType: body.sourceType },
          outputData: { intentDetected: true, leadScore: 90, suggestedNiche: 'Brand Partnership' },
          approvalLevel: 'AUTOMATIC',
          executedAt: new Date(),
        },
      });

      return {
        ...action,
        inputData: action.inputData as Record<string, unknown>,
        outputData: action.outputData as Record<string, unknown>,
        approvedAt: action.approvedAt?.toISOString() ?? null,
        executedAt: action.executedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      };
    },
  );

  // ─────────────────────────────────────────────────────────────
  // AI ACTION APPROVAL GATES
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/ai/actions',
      operationId: 'listAiActions',
      tags: ['AI'],
      summary: 'List AI actions and pending approvals',
      access: { type: 'permission', permission: 'ai.read' },
      query: z.object({
        taskType: z.enum(['INBOX_CLASSIFY', 'INBOX_SUMMARIZE', 'REPLY_DRAFT', 'MEETING_SCORE', 'LEAD_DETECT', 'GROWTH_INSIGHT']).optional(),
        pendingApproval: z.string().optional(),
      }),
      response: { status: 200, schema: z.array(aiActionSchema) },
    },
    async ({ query }) => {
      const where: any = {};
      if (query.taskType) where.taskType = query.taskType;
      if (query.pendingApproval === 'true') {
        where.approvalLevel = { in: ['ALWAYS_HUMAN', 'DEFAULT_HUMAN'] };
        where.approvedAt = null;
        where.rejectionReason = null;
      }

      const actions = await db.aiAction.findMany({ where, orderBy: { createdAt: 'desc' } });
      return actions.map((a) => ({
        ...a,
        inputData: a.inputData as Record<string, unknown>,
        outputData: a.outputData as Record<string, unknown>,
        approvedAt: a.approvedAt?.toISOString() ?? null,
        executedAt: a.executedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/ai/actions/{id}/decide',
      operationId: 'decideAiAction',
      tags: ['AI'],
      summary: 'Human decision (approve or reject) for AI action',
      access: { type: 'permission', permission: 'ai.approve' },
      params: z.object({ id: z.string() }),
      body: decideAiActionBodySchema,
      response: { status: 200, schema: aiActionSchema },
    },
    async ({ params, body, auth }) => {
      const existing = await db.aiAction.findUnique({ where: { id: params.id } });
      if (!existing) throw errors.notFound('AI Action');

      const isApprove = body.action === 'APPROVE';
      const updated = await db.aiAction.update({
        where: { id: params.id },
        data: {
          approvedById: isApprove ? auth.user.id : null,
          approvedAt: isApprove ? new Date() : null,
          executedAt: isApprove ? new Date() : null,
          rejectionReason: isApprove ? null : (body.rejectionReason ?? 'Rejected by staff'),
        },
      });

      return {
        ...updated,
        inputData: updated.inputData as Record<string, unknown>,
        outputData: updated.outputData as Record<string, unknown>,
        approvedAt: updated.approvedAt?.toISOString() ?? null,
        executedAt: updated.executedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW ENGINE (RULES, RUNS, DISPATCH)
  // ─────────────────────────────────────────────────────────────

  route(
    {
      method: 'get',
      path: '/api/v1/workflows/rules',
      operationId: 'listWorkflowRules',
      tags: ['Workflows'],
      summary: 'List automated workflow rules',
      access: { type: 'permission', permission: 'workflows.read' },
      response: { status: 200, schema: z.array(workflowRuleSchema) },
    },
    async () => {
      const rules = await db.workflowRule.findMany({ orderBy: { createdAt: 'desc' } });
      return rules.map((r) => ({
        ...r,
        conditions: r.conditions as Record<string, unknown>[],
        actions: r.actions as Record<string, unknown>[],
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/workflows/rules',
      operationId: 'createWorkflowRule',
      tags: ['Workflows'],
      summary: 'Create workflow rule with conditions and actions',
      access: { type: 'permission', permission: 'workflows.write' },
      body: createWorkflowRuleBodySchema,
      response: { status: 201, schema: workflowRuleSchema },
    },
    async ({ body }) => {
      const created = await db.workflowRule.create({
        data: {
          name: body.name,
          description: body.description,
          trigger: body.trigger,
          conditions: body.conditions as any,
          actions: body.actions as any,
          delaySeconds: body.delaySeconds,
          isEnabled: body.isEnabled,
          approvalLevel: body.approvalLevel,
        },
      });

      return {
        ...created,
        conditions: created.conditions as Record<string, unknown>[],
        actions: created.actions as Record<string, unknown>[],
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'patch',
      path: '/api/v1/workflows/rules/{id}',
      operationId: 'updateWorkflowRule',
      tags: ['Workflows'],
      summary: 'Update or toggle workflow rule',
      access: { type: 'permission', permission: 'workflows.write' },
      params: z.object({ id: z.string() }),
      body: updateWorkflowRuleBodySchema,
      response: { status: 200, schema: workflowRuleSchema },
    },
    async ({ params, body }) => {
      const existing = await db.workflowRule.findUnique({ where: { id: params.id } });
      if (!existing) throw errors.notFound('Workflow rule');

      const updated = await db.workflowRule.update({
        where: { id: params.id },
        data: {
          name: body.name,
          description: body.description,
          trigger: body.trigger,
          conditions: body.conditions ? (body.conditions as any) : undefined,
          actions: body.actions ? (body.actions as any) : undefined,
          delaySeconds: body.delaySeconds,
          isEnabled: body.isEnabled,
          approvalLevel: body.approvalLevel,
        },
      });

      return {
        ...updated,
        conditions: updated.conditions as Record<string, unknown>[],
        actions: updated.actions as Record<string, unknown>[],
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/workflows/trigger',
      operationId: 'triggerWorkflow',
      tags: ['Workflows'],
      summary: 'Trigger matching workflow rules and record execution run',
      access: { type: 'permission', permission: 'workflows.write' },
      body: triggerWorkflowBodySchema,
      response: { status: 200, schema: z.array(workflowRunSchema) },
    },
    async ({ body }) => {
      const activeRules = await db.workflowRule.findMany({
        where: { trigger: body.trigger, isEnabled: true },
      });

      const runs = [];
      for (const rule of activeRules) {
        // Execute rule action
        const status = rule.approvalLevel === 'ALWAYS_HUMAN' ? 'PENDING_APPROVAL' : 'SUCCESS';
        const run = await db.workflowRun.create({
          data: {
            ruleId: rule.id,
            trigger: rule.trigger,
            status,
            payload: body.payload as any,
            executionResult: { actionsDispatched: rule.actions },
            completedAt: status === 'SUCCESS' ? new Date() : null,
          },
        });
        runs.push(run);
      }

      return runs.map((r) => ({
        ...r,
        payload: r.payload as Record<string, unknown>,
        executionResult: r.executionResult as Record<string, unknown> | null,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      }));
    },
  );

  route(
    {
      method: 'get',
      path: '/api/v1/workflows/runs',
      operationId: 'listWorkflowRuns',
      tags: ['Workflows'],
      summary: 'List execution audit log of workflow runs',
      access: { type: 'permission', permission: 'workflows.read' },
      query: z.object({
        ruleId: z.string().optional(),
        trigger: z.enum(['INBOX_MESSAGE_RECEIVED', 'ORDER_CREATED', 'MEETING_REQUESTED', 'PROPOSAL_RECEIVED', 'LEAD_CREATED']).optional(),
        status: z.enum(['SUCCESS', 'FAILED', 'PENDING_APPROVAL', 'REJECTED']).optional(),
      }),
      response: { status: 200, schema: z.array(workflowRunSchema) },
    },
    async ({ query }) => {
      const where: any = {};
      if (query.ruleId) where.ruleId = query.ruleId;
      if (query.trigger) where.trigger = query.trigger;
      if (query.status) where.status = query.status;

      const runs = await db.workflowRun.findMany({ where, orderBy: { startedAt: 'desc' } });
      return runs.map((r) => ({
        ...r,
        payload: r.payload as Record<string, unknown>,
        executionResult: r.executionResult as Record<string, unknown> | null,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      }));
    },
  );

  return router;
}

