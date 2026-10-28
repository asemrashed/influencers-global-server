import { z } from 'zod';
import { pageOf, paginationQuerySchema } from './common.js';

export const approvalLevelSchema = z.enum(['ALWAYS_HUMAN', 'DEFAULT_HUMAN', 'AUTOMATIC']);
export type ApprovalLevel = z.infer<typeof approvalLevelSchema>;

export const workflowTriggerSchema = z.enum([
  'INBOX_MESSAGE_RECEIVED',
  'ORDER_CREATED',
  'MEETING_REQUESTED',
  'PROPOSAL_RECEIVED',
  'LEAD_CREATED',
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

export const workflowRunStatusSchema = z.enum([
  'SUCCESS',
  'FAILED',
  'PENDING_APPROVAL',
  'REJECTED',
]);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const aiTaskTypeSchema = z.enum([
  'INBOX_CLASSIFY',
  'INBOX_SUMMARIZE',
  'REPLY_DRAFT',
  'MEETING_SCORE',
  'LEAD_DETECT',
  'GROWTH_INSIGHT',
]);
export type AiTaskType = z.infer<typeof aiTaskTypeSchema>;

// AI Action DTOs
export const aiActionSchema = z.object({
  id: z.string(),
  taskType: aiTaskTypeSchema,
  inputData: z.record(z.string(), z.unknown()),
  outputData: z.record(z.string(), z.unknown()),
  approvalLevel: approvalLevelSchema,
  approvedById: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  executedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiAction = z.infer<typeof aiActionSchema>;

export const decideAiActionBodySchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional(),
});
export type DecideAiActionBody = z.infer<typeof decideAiActionBodySchema>;

// AI Task Execution Bodies
export const classifyInboxBodySchema = z.object({
  messageId: z.string(),
});

export const summarizeInboxBodySchema = z.object({
  threadId: z.string(),
});

export const draftReplyBodySchema = z.object({
  threadId: z.string(),
  contextNotes: z.string().optional(),
});

export const scoreMeetingBodySchema = z.object({
  meetingId: z.string(),
});

export const detectLeadBodySchema = z.object({
  sourceType: z.enum(['INBOX_MESSAGE', 'COMMENT', 'DIRECT_INQUIRY']),
  content: z.string().min(1),
  contactEmail: z.string().email().optional(),
  contactName: z.string().optional(),
});

// Workflow Rules & Runs
export const workflowRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trigger: workflowTriggerSchema,
  conditions: z.array(z.record(z.string(), z.unknown())),
  actions: z.array(z.record(z.string(), z.unknown())),
  delaySeconds: z.number().int(),
  isEnabled: z.boolean(),
  approvalLevel: approvalLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRule = z.infer<typeof workflowRuleSchema>;

export const createWorkflowRuleBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: workflowTriggerSchema,
  conditions: z.array(z.record(z.string(), z.unknown())).default([]),
  actions: z.array(z.record(z.string(), z.unknown())).min(1),
  delaySeconds: z.number().int().nonnegative().default(0),
  isEnabled: z.boolean().default(true),
  approvalLevel: approvalLevelSchema.default('ALWAYS_HUMAN'),
});
export type CreateWorkflowRuleBody = z.infer<typeof createWorkflowRuleBodySchema>;

export const updateWorkflowRuleBodySchema = createWorkflowRuleBodySchema.partial();
export type UpdateWorkflowRuleBody = z.infer<typeof updateWorkflowRuleBodySchema>;

export const workflowRunSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  trigger: workflowTriggerSchema,
  status: workflowRunStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  executionResult: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  retriesCount: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const triggerWorkflowBodySchema = z.object({
  trigger: workflowTriggerSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type TriggerWorkflowBody = z.infer<typeof triggerWorkflowBodySchema>;

// ─────────────────────────────────────────────────────────────
// PAGINATED SCHEMAS & LIST QUERIES
// ─────────────────────────────────────────────────────────────

export const aiActionListQuerySchema = paginationQuerySchema.extend({
  taskType: aiTaskTypeSchema.optional(),
  pendingApproval: z.string().optional(),
});
export type AiActionListQuery = z.infer<typeof aiActionListQuerySchema>;
export const aiActionPageSchema = pageOf(aiActionSchema, 'AiActionPage');
export type AiActionPage = z.infer<typeof aiActionPageSchema>;

export const workflowRunListQuerySchema = paginationQuerySchema.extend({
  ruleId: z.string().optional(),
  trigger: workflowTriggerSchema.optional(),
  status: workflowRunStatusSchema.optional(),
});
export type WorkflowRunListQuery = z.infer<typeof workflowRunListQuerySchema>;
export const workflowRunPageSchema = pageOf(workflowRunSchema, 'WorkflowRunPage');
export type WorkflowRunPage = z.infer<typeof workflowRunPageSchema>;

