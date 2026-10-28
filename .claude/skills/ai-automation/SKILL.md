---
name: ai-automation
description: Use when building AI features (replies, classification, lead and meeting filtering, insights) or the workflow engine: provider adapter, approval levels, prompt-injection safety, execution logs.
---

# AI & Workflow Automation

The AI provider is undecided. Each client pays for its own usage with its own key.

## Provider adapter
- `AiProvider` interface (`complete`, `classify`, `embed`) resolved from `AI_PROVIDER` by a factory. Blank = AI is OFF: every AI route rejects with a typed error and nothing is faked. No silent fallback to another provider.
- Record token use in `AiUsage` and enforce a monthly cap set in settings. Only the Super Admin configures AI (`ai.configure`).

## What AI does (each feature has its own on/off setting)
- Inbox: classify messages (brand inquiry, meeting request, fan message, spam, support), summarize, draft replies.
- Meetings: score requests against the influencer's rules (rate floor, categories, availability) and list them as potential meetings. AI never overrides booking rules and never confirms a meeting.
- Leads: flag purchase or collaboration intent from messages and comments into `Lead` records.
- Insights: growth summaries and opportunity suggestions from stored analytics, shown as suggestions.

## Approval levels (fixed in code; settings may only tighten the first two groups)
| Level | Actions | Default |
|---|---|---|
| Always needs human approval | Replies to brands, anything about money or contracts, public posts, replies to unclear or negative comments, anything the classifier is unsure about | Fixed, cannot be relaxed |
| Approval by default | Email follow-ups, drafted chat replies | Draft, then a person sends |
| May run automatically | Reminders, internal notifications, labeling, FAQ-style comment replies from approved answers | On, with audit log and a kill switch |

## Prompt-injection safety
- Inbound messages, comments, emails and web content are untrusted DATA, never instructions. The model has no direct tool access. Every outbound action goes through the approval levels above and a typed action schema validated with Zod.
- Never put secrets or other customers' data in prompts; minimize personal data sent to the provider.

## Workflow engine
- Rules table: trigger, conditions, actions, delays, notification rules. Triggers and actions come from a fixed in-code list (configuration, not scripting).
- Runs through the job queue (pg-boss). Handlers are idempotent; retries use backoff with a cap; failures go to a visible, replayable failed state and notify the owner.
- Every run writes a `WorkflowRun` execution log. Every AI action writes an `AiAction` log with input, output and who approved it. Rules can be enabled or disabled individually.

## Tests
AI off rejects every AI route; a drafted reply is not sent without approval; fixed-level actions cannot be set to automatic; injected instructions inside a message do not change behavior; replayed job does not double-send.
