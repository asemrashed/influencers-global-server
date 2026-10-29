import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
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
  decideWorkflowRunBodySchema,
  pageOf,
  paginationQuerySchema,
} from '@platform/shared-types';
import { errors } from '../../lib/errors.js';
import { pageArgs, toPage } from '../../lib/pagination.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import { completeRun, fireWorkflows } from './workflows.service.js';

export function aiRoutes(kit: RouteKit): Router {
  const router = Router();
  const route = routeFactory(kit, router);
  const { db, providers } = kit.c;

  // ─────────────────────────────────────────────────────────────
  // AI TASKS & ASSISTANCE (SAFE ADAPTER GUARD)
  // ─────────────────────────────────────────────────────────────

  const actionDto = (a: Awaited<ReturnType<typeof db.aiAction.findUniqueOrThrow>>) => ({
    ...a,
    inputData: a.inputData as Record<string, unknown>,
    outputData: a.outputData as Record<string, unknown>,
    approvedAt: a.approvedAt?.toISOString() ?? null,
    executedAt: a.executedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  });

  const runDto = (r: Awaited<ReturnType<typeof db.workflowRun.findUniqueOrThrow>>) => ({
    ...r,
    payload: r.payload as Record<string, unknown>,
    executionResult: r.executionResult as Record<string, unknown> | null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  });

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
    async ({ body }) => {
      const ai = requireAi();
      const message = await db.inboxMessage.findUnique({ where: { id: body.messageId } });
      if (!message) throw errors.notFound('Inbox message');
      // The message is untrusted data: the provider only ever receives it as content to classify.
      const output = await ai.classifyMessage({ body: message.body });
      return actionDto(
        await db.aiAction.create({
          data: { taskType: 'INBOX_CLASSIFY', inputData: { messageId: message.id }, outputData: output, approvalLevel: 'AUTOMATIC', executedAt: new Date() },
        }),
      );
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
    async ({ body }) => {
      const ai = requireAi();
      const thread = await db.inboxThread.findUnique({ where: { id: body.threadId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } } });
      if (!thread) throw errors.notFound('Inbox thread');
      const output = await ai.summarizeThread({ messages: thread.messages.map((m) => ({ from: m.isFromStaff ? 'staff' : 'sender', body: m.body })) });
      return actionDto(
        await db.aiAction.create({
          data: { taskType: 'INBOX_SUMMARIZE', inputData: { threadId: thread.id, messageCount: thread.messages.length }, outputData: output, approvalLevel: 'AUTOMATIC', executedAt: new Date() },
        }),
      );
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
    async ({ body }) => {
      const ai = requireAi();
      const thread = await db.inboxThread.findUnique({ where: { id: body.threadId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } } });
      if (!thread) throw errors.notFound('Inbox thread');
      const draft = await ai.draftReply({ subject: thread.subject, messages: thread.messages.map((m) => ({ from: m.isFromStaff ? 'staff' : 'sender', body: m.body })), ...(body.contextNotes ? { notes: body.contextNotes } : {}) });
      // A reply to a real person is ALWAYS held for a human: the level is fixed here, not chosen by the caller or the model.
      return actionDto(
        await db.aiAction.create({
          data: { taskType: 'REPLY_DRAFT', inputData: { threadId: thread.id, contextNotes: body.contextNotes }, outputData: { suggestedSubject: draft.subject, suggestedBody: draft.body }, approvalLevel: 'ALWAYS_HUMAN' },
        }),
      );
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
      const ai = requireAi();
      const meeting = await db.meeting.findUnique({ where: { id: body.meetingId } });
      if (!meeting) throw errors.notFound('Meeting');
      const output = await ai.scoreMeeting({ title: meeting.title, ...(meeting.description ? { description: meeting.description } : {}) });
      return actionDto(
        await db.aiAction.create({
          data: { taskType: 'MEETING_SCORE', inputData: { meetingId: meeting.id, title: meeting.title }, outputData: output, approvalLevel: 'AUTOMATIC', executedAt: new Date() },
        }),
      );
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
      const ai = requireAi();
      const output = await ai.detectLead({ content: body.content, sourceType: body.sourceType });
      return actionDto(
        await db.aiAction.create({
          data: { taskType: 'LEAD_DETECT', inputData: { content: body.content, sourceType: body.sourceType }, outputData: output, approvalLevel: 'AUTOMATIC', executedAt: new Date() },
        }),
      );
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
      query: paginationQuerySchema.extend({
        taskType: z.enum(['INBOX_CLASSIFY', 'INBOX_SUMMARIZE', 'REPLY_DRAFT', 'MEETING_SCORE', 'LEAD_DETECT', 'GROWTH_INSIGHT']).optional(),
        pendingApproval: z.enum(['true', 'false']).optional(),
      }),
      response: { status: 200, schema: pageOf(aiActionSchema, 'AiActionPage') },
    },
    async ({ query }) => {
      const where: Prisma.AiActionWhereInput = {};
      if (query.taskType) where.taskType = query.taskType;
      if (query.pendingApproval === 'true') {
        where.approvalLevel = { in: ['ALWAYS_HUMAN', 'DEFAULT_HUMAN'] };
        where.approvedAt = null;
        where.rejectionReason = null;
      }

      const actions = await db.aiAction.findMany({ where, ...pageArgs(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return toPage(actions, query.limit, actionDto);
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
      if (existing.approvalLevel === 'AUTOMATIC') throw errors.conflict('This action ran automatically and has nothing to approve');
      const isApprove = body.action === 'APPROVE';
      // Decide once: compare-and-set on "still undecided", so an approval cannot be flipped or repeated.
      const decided = await db.aiAction.updateMany({
        where: { id: existing.id, approvedAt: null, rejectionReason: null },
        data: isApprove
          ? { approvedById: auth.user.id, approvedAt: new Date() }
          : { rejectionReason: body.rejectionReason ?? 'Rejected by staff' },
      });
      if (decided.count === 0) throw errors.conflict('This action has already been decided');
      // Approval records the human decision only. `executedAt` stays empty: nothing was sent or changed by approving.
      return actionDto(await db.aiAction.findUniqueOrThrow({ where: { id: existing.id } }));
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
          conditions: body.conditions,
          actions: body.actions,
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
          conditions: body.conditions ? body.conditions : undefined,
          actions: body.actions ? body.actions : undefined,
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
      const runs = await fireWorkflows(kit.c, body.trigger, body.payload);
      return runs.map(runDto);
    },
  );

  route(
    {
      method: 'post',
      path: '/api/v1/workflows/runs/{id}/decide',
      operationId: 'decideWorkflowRun',
      tags: ['Workflows'],
      summary: 'Approve (and execute) or reject a workflow run that is waiting for a human',
      access: { type: 'permission', permission: 'workflows.write' },
      params: z.object({ id: z.string() }),
      body: decideWorkflowRunBodySchema,
      response: { status: 200, schema: workflowRunSchema },
      errors: ['CONFLICT', 'NOT_FOUND'],
    },
    async ({ params, body }) => {
      const run = await db.workflowRun.findUnique({ where: { id: params.id } });
      if (!run) throw errors.notFound('Workflow run');
      if (run.status !== 'PENDING_APPROVAL') throw errors.conflict(`This run is already ${run.status.toLowerCase().replace('_', ' ')}`);
      if (body.action === 'REJECT') {
        const rejected = await db.workflowRun.updateMany({
          where: { id: run.id, status: 'PENDING_APPROVAL' },
          data: { status: 'REJECTED', errorMessage: body.reason ?? 'Rejected by staff', completedAt: new Date() },
        });
        if (rejected.count === 0) throw errors.conflict('This run was decided by someone else');
        return runDto(await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } }));
      }
      return runDto(await completeRun(kit.c, run));
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
      query: paginationQuerySchema.extend({
        ruleId: z.string().max(100).optional(),
        trigger: z.enum(['INBOX_MESSAGE_RECEIVED', 'ORDER_CREATED', 'MEETING_REQUESTED', 'PROPOSAL_RECEIVED', 'LEAD_CREATED']).optional(),
        status: z.enum(['SUCCESS', 'FAILED', 'PENDING_APPROVAL', 'REJECTED']).optional(),
      }),
      response: { status: 200, schema: pageOf(workflowRunSchema, 'WorkflowRunPage') },
    },
    async ({ query }) => {
      const where: Prisma.WorkflowRunWhereInput = {};
      if (query.ruleId) where.ruleId = query.ruleId;
      if (query.trigger) where.trigger = query.trigger;
      if (query.status) where.status = query.status;

      const runs = await db.workflowRun.findMany({ where, ...pageArgs(query), orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] });
      return toPage(runs, query.limit, runDto);
    },
  );

  return router;
}

