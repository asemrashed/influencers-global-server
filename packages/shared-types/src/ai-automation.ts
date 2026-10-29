import { z } from 'zod';
import { emailSchema, plainText } from './common.js';

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
  rejectionReason: plainText(1, 1000).optional(),
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
  contextNotes: plainText(1, 2000).optional(),
});

export const scoreMeetingBodySchema = z.object({
  meetingId: z.string(),
});

export const detectLeadBodySchema = z.object({
  sourceType: z.enum(['INBOX_MESSAGE', 'COMMENT', 'DIRECT_INQUIRY']),
  content: z.string().min(1).max(10_000),
  contactEmail: emailSchema.optional(),
  contactName: plainText(1, 120).optional(),
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

/**
 * The ONLY actions a workflow can perform. Anything not listed here cannot be saved, so a rule can never
 * claim to do something the server cannot do. Text is fixed in the rule: inbound content is never templated
 * into an email, so a stranger's message cannot steer what the system sends.
 */
export const workflowActionSchema = z
  .object({
    type: z.literal('SEND_EMAIL'),
    to: emailSchema.optional().describe('A fixed recipient'),
    toPayloadField: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/)
      .optional()
      .describe('Or: the name of a payload field that holds the recipient address, e.g. customerEmail'),
    subject: plainText(1, 200),
    text: plainText(1, 5000),
  })
  .refine((a) => Boolean(a.to) !== Boolean(a.toPayloadField), 'Provide exactly one of "to" or "toPayloadField"')
  .meta({ id: 'WorkflowAction' });
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const workflowConditionSchema = z
  .object({
    field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
  })
  .meta({ id: 'WorkflowCondition' });
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

export const createWorkflowRuleBodySchema = z.object({
  name: plainText(1, 120),
  description: plainText(1, 1000).optional(),
  trigger: workflowTriggerSchema,
  conditions: z.array(workflowConditionSchema).max(10).default([]),
  actions: z.array(workflowActionSchema).min(1).max(5),
  delaySeconds: z.number().int().min(0).max(30 * 24 * 3600).default(0),
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

export const decideWorkflowRunBodySchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reason: plainText(1, 1000).optional(),
});
export type DecideWorkflowRunBody = z.infer<typeof decideWorkflowRunBodySchema>;

export const triggerWorkflowBodySchema = z.object({
  trigger: workflowTriggerSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type TriggerWorkflowBody = z.infer<typeof triggerWorkflowBodySchema>;

