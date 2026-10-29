import { emailSchema, workflowActionSchema, workflowConditionSchema, type WorkflowCondition, type WorkflowTrigger } from '@platform/shared-types';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Container } from '../../container.js';
import { emailSendJob } from '../../jobs/jobs.js';

type Payload = Record<string, unknown>;

/** True when EVERY condition holds for the payload. No conditions = always. */
export function conditionsMatch(conditions: WorkflowCondition[], payload: Payload): boolean {
  return conditions.every((c) => {
    const actual = payload[c.field];
    switch (c.operator) {
      case 'eq': return actual === c.value;
      case 'neq': return actual !== c.value;
      case 'contains': return typeof actual === 'string' && typeof c.value === 'string' && actual.toLowerCase().includes(c.value.toLowerCase());
      default: {
        if (typeof actual !== 'number' || typeof c.value !== 'number') return false;
        return c.operator === 'gt' ? actual > c.value : c.operator === 'gte' ? actual >= c.value : c.operator === 'lt' ? actual < c.value : actual <= c.value;
      }
    }
  });
}

interface Outcome {
  status: 'SUCCESS' | 'FAILED';
  executionResult: Prisma.InputJsonValue;
  errorMessage?: string;
}

/**
 * Performs a rule's actions for real. A run is SUCCESS only when every action was actually handed to the
 * job queue; anything else is FAILED with the reason, never a pretend success.
 */
async function execute(c: Container, runId: string, rule: { actions: unknown; delaySeconds: number }, payload: Payload): Promise<Outcome> {
  const actions = workflowActionSchema.array().safeParse(rule.actions);
  if (!actions.success) return { status: 'FAILED', executionResult: {}, errorMessage: 'The rule contains an action this server cannot perform' };
  const queued: string[] = [];
  for (const [i, action] of actions.data.entries()) {
    if (!c.providers.email) return { status: 'FAILED', executionResult: { queued }, errorMessage: 'Email is not configured on this installation' };
    if (!c.jobs.enabled) return { status: 'FAILED', executionResult: { queued }, errorMessage: 'Background jobs are switched off, so nothing can be sent' };
    const to = action.to ?? emailSchema.safeParse(payload[action.toPayloadField ?? '']).data;
    if (!to) return { status: 'FAILED', executionResult: { queued }, errorMessage: `Payload field "${action.toPayloadField}" does not hold a valid email address` };
    // dedupeKey makes a repeated approval or retry collapse into the same job: the email is sent once.
    await c.jobs.enqueue(emailSendJob, { to, subject: action.subject, text: action.text }, { dedupeKey: `wf:${runId}:${i}`, startAfterSeconds: rule.delaySeconds });
    queued.push(`SEND_EMAIL:${i}`);
  }
  return { status: 'SUCCESS', executionResult: { queued } };
}

/** Finishes a run: executes it and records the real outcome. */
export async function completeRun(c: Container, run: { id: string; ruleId: string; payload: unknown }) {
  const rule = await c.db.workflowRule.findUniqueOrThrow({ where: { id: run.ruleId } });
  const outcome = await execute(c, run.id, rule, run.payload as Payload);
  return c.db.workflowRun.update({
    where: { id: run.id },
    data: { status: outcome.status, executionResult: outcome.executionResult, errorMessage: outcome.errorMessage ?? null, completedAt: new Date() },
  });
}

/**
 * Fires every enabled rule for a trigger. AUTOMATIC rules run now; the others wait as PENDING_APPROVAL until a
 * human decides. Rules whose conditions do not match leave no run at all.
 */
export async function fireWorkflows(c: Container, trigger: WorkflowTrigger, payload: Payload) {
  const rules = await c.db.workflowRule.findMany({ where: { trigger, isEnabled: true }, orderBy: { createdAt: 'asc' } });
  const runs = [];
  for (const rule of rules) {
    const conditions = workflowConditionSchema.array().safeParse(rule.conditions);
    if (!conditions.success || !conditionsMatch(conditions.data, payload)) continue;
    const run = await c.db.workflowRun.create({
      data: { ruleId: rule.id, trigger, payload: payload as Prisma.InputJsonValue, status: 'PENDING_APPROVAL' },
    });
    runs.push(rule.approvalLevel === 'AUTOMATIC' ? await completeRun(c, run) : run);
  }
  return runs;
}

/** For events raised inside other requests (an order, an inquiry): a workflow problem must never fail the customer's request. */
export async function fireWorkflowsSafely(c: Container, trigger: WorkflowTrigger, payload: Payload): Promise<void> {
  try {
    await fireWorkflows(c, trigger, payload);
  } catch (err) {
    c.logger.error({ err, trigger }, 'workflow dispatch failed');
  }
}
