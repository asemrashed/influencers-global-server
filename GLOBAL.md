# GLOBAL.md — Universal Foundation Router

This is the project-agnostic base. A project's own `CLAUDE.md` inherits this file
and adds only what's specific to that project (domain, extra stack, out-of-scope list).
Do not put domain logic here — ever.

## Default Stack
Next.js (App Router), Express, Prisma, PostgreSQL, TanStack Query (client cache SoT),
Zustand, shadcn/ui, Zod (shared client+server schemas), DOMPurify, `server-only`,
Helmet, Redis (server cache), pluggable storage provider (env-driven), Workbox (PWA).
This is a starting point, NOT a mandate. Pick the simplest architecture that meets the project's requirements: a small site may need no separate API, monorepo, Redis or PWA. Avoid unneeded services, packages, dependencies and abstractions. Record any delta in the project's `CLAUDE.md`, not here.

## Rules (NEVER skip, any project)
- Zod for ALL input validation (client + server, shared schemas).
- DOMPurify for user-generated HTML wherever it is accepted or rendered (client + server, before DB write). Plain text is escaped, not treated as HTML.
- `server-only` for ANY file touching DB, secrets, or Prisma.
- NEVER send secrets or raw ORM objects to the client — always map to DTO.
- Every route has an EXPLICIT access policy (`public`, `authenticated`, or role/permission-based). Non-public routes get auth + authorization middleware; deliberately public routes (login, health, signature-verified webhooks) are marked as such, never accidental.
- All external integrations (storage, cache, mail, payments, etc.) resolved from env via a provider factory — never hardcoded to one vendor.
- All list endpoints support server-side pagination.
- All shared UI lives in ONE shared location (`/packages/ui` in monorepo mode, `src/components/ui` in single-app mode) — feature code imports it, never owns a copy. Reuse before creating.
- Query keys follow one documented convention project-wide (see `caching`).
- Optional capabilities (payments, email/SMS, Redis, jobs, audit log, device limits, storage) are OFF by default, enabled per project via env, and enforced server-side when off (see `env`). Implement only what the project's requirements, traffic and deployment justify.
- Optional INFRA (Redis, jobs) off → app degrades gracefully. Whole CAPABILITY (payments, notifications needed for OTP) off → its operations are rejected, never faked as success.
- Never silently fall back to a different provider than configured. Roles/permissions live in the project's auth model, never in env vars.
- Treat webhooks, uploads, third-party responses and user content as untrusted input.
- Multi-step writes use transactions; retried/webhook handlers are idempotent (see `reliability`).

## 🧭 Requirements Intake (before building anything non-trivial)
If the project's `CLAUDE.md` Requirements Intake is unfilled, ASK the user (one batched question) about: roles, device limits, payments, storage, database host, email/SMS, Redis, background jobs, audit log, data privacy/retention, required external integrations, and out-of-scope features. Record answers in `CLAUDE.md`; business workflows and acceptance criteria go in `MASTER_PLAN.md`. Do not guess.
**Payments: never assume a gateway.** If needed and unchosen, ask; if not needed, leave it out (see `payments`).

## 📖 Read First (every session)
1. The project's own `CLAUDE.md` (it tells you which parts of this file apply and what's added).
2. `MASTER_PLAN.md` → read the top pointer lines only → jump to the current phase.
3. Never re-read completed phases or unrelated skills.

## 🛠️ Skills
Skills live in `.claude/skills/<name>/SKILL.md` and load by their description. Load only what the current task needs. Optional-capability skills (`notifications`, `audit-log`, `payments`, `pwa-standards`) apply only if the project enabled that capability. Template skills (`auth-rbac-matrix`, `component-registry`, `db-schema`) are filled per project.

## 🤖 Universal Agents
- New page/dashboard BEFORE coding → `ui-architect` (REUSE/EXTEND/CREATE plan)
- Cross-module contracts, scope decisions → `architect`
- New endpoint → `backend-api`
- New component/page → `frontend-ui` (after ui-architect)
- Schema change / migration / index review → `db-migration`
- Auth flows / permission enforcement → `auth-rbac`
- Pre-merge review (duplication, SOLID) → `code-reviewer`
- Security audit (secrets, injection, OWASP) → `security-scanner`
- Tests for changed files → `test-writer`
- CI/CD, env, deploy → `devops`
(Capabilities are skills, not agents. Don't launch several agents for a simple task; inspect existing code before proposing new components or modules.)

## ✅ Project validation
At the end of each phase, run through `PROJECT_CHECKLIST.md` (copied from the template) and tick only what was actually verified.

## 🚫 Never
- Load a skill or agent not needed for the current task.
- Re-read a completed phase.
- Create a component before checking `component-registry`.
- Duplicate a type — import from the shared types package.
- Fork a component per role/variant — parameterize it instead.
- Put project-specific rules in this file — they belong in the project's `CLAUDE.md`.

## 📁 Layout (see `architecture` for rules, `env` for env files)
Layout mode is chosen per project and recorded in `CLAUDE.md`:
- **monorepo** (2+ deployable apps or shared code across apps): `/apps/web`, `/apps/api`, `/packages/{ui,shared-types,config}`. Each app deploys independently.
- **single-app** (one deployable): one app with `src/components/ui`, `src/shared` (schemas/DTOs), `src/config`.
Skills mention monorepo paths; in single-app mode map them as above.
/.claude/agents → scoped agents · /.claude/skills → on-demand knowledge
