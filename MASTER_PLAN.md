# MASTER PLAN — Influencer Management Platform (Backend First)
> Current: Release 1 COMPLETE (Phases 1–8 Delivered)
> Next: Deployment & Pilot Handover (see "After the backend")
> All phases finished, tested, and documented. Read ONLY the current phase.

Scope: ONE complete backend for ONE influencer. No UI is built in this repo. When the backend is done it is copied per influencer, and each client gets its own UI in a separate repo (see "After the backend").
Release 1 = phases 1–8: a finished, tested, documented API deployed on one staging VPS.

## Definition of done (every phase)
1. Endpoints implemented, each with an explicit access policy, Zod schemas and tests (401 / 403 / out-of-scope / invalid input).
2. Registered in OpenAPI; `packages/api-client` regenerated; `/docs` renders it.
3. Module flow script (headless e2e through `api-client`) passes.
4. Permission rows added to `auth-rbac-matrix`; demo seed extended.
5. `PROJECT_CHECKLIST.md` run for the phase; tick only what was verified.

---

## Phase 1 — Foundation, access and API contract ✅ DONE (see docs/PHASE1_REPORT.md)

### Project skeleton
- [x] Monorepo (npm workspaces): `apps/api`, `packages/{shared-types,config,api-client}`, `tools/deploy`, `clients/`
- [x] Env config + Zod validation (`apiEnv`); provider factories for enabled capabilities only (storage, email, AI, payment all blank-safe); `CORS_ORIGINS`, `API_DOCS_ENABLED`
- [x] Prisma schema v1: User, Session, Role, Permission, RolePermission, UserRole, Invitation, Setting, ModuleToggle, AuditLog, StoredFile
- [x] Module folder structure (`modules/<domain>/{routes,controller,service,repository}`) for all planned domains, empty
- [x] Error handling with stable error codes, structured logging, `/health` and `/ready`
- [x] Job queue (pg-boss) wired, idempotent handler pattern

### Users, auth, RBAC
- [x] Auth: login/logout, invitation, password reset, 2FA for Super Admin and Admin
- [x] Permission registry synced to DB at boot; required seed for Super Admin, Admin, Manager from `auth-rbac-matrix`
- [x] `requirePermission` middleware + scope filter (`all` / `assigned` / `own`) in repositories
- [x] `GET /api/v1/me`: user, effective permissions with scopes, enabled modules
- [x] Users, roles and permissions endpoints; last-Super-Admin protection; role and permission changes audited
- [x] Security layer: Helmet, CSRF, CORS allowlist, rate limits, server-side HTML sanitization

### API contract and tooling
- [x] Zod → OpenAPI generation; `/docs`; `packages/api-client` generated; CI fails on a stale client
- [x] Demo seed command (`seed:demo`), separate from the required seed; blocked in production
- [x] Flow-script harness (test DB, `api-client`, helpers) ready for later phases
- [x] Per-client deploy script reading a client config file (`tools/deploy`, see `client-deploy`)

### Exit criteria
- Flow script: a Super Admin signs in (with 2FA), creates a custom role, assigns permissions, invites a Manager, and the Manager is correctly limited by it.
- Every route has an explicit access policy; unauthenticated access to protected routes returns 401; a request from a non-allowlisted origin is rejected.
- No secrets in the OpenAPI spec or `api-client`. `PROJECT_CHECKLIST.md` run for this phase.

---

## Phase 2 — Profile, public API, inbox and support ✅ DONE (see docs/PHASE2_REPORT.md)
- Endpoints for: personal info, bio, niche, portfolio albums, press coverage, media kit, rate card, services, availability, privacy controls; public read endpoints for the profile and portfolio; public collaboration and booking submission; contacts; email adapter with editable templates; unified inbox (threads, messages); in-app notifications with unread counts; support tickets (account, event, payment, campaign, technical) with assignment, status, replies and history
- Acceptance: a brand submits a public form and an Admin sees it in the inbox; public routes validated, rate-limited, bot-protected; a ticket can be assigned, answered and resolved with history kept.

## Phase 3 — Collaboration and meetings ✅ DONE (see docs/PHASE3_REPORT.md)
- Endpoints for: proposals and negotiation with status history (objectives, deliverables, compensation, terms); campaigns and workspaces (briefs, tasks, assets, deadlines); deliverables with submission, feedback, revisions and approval; agreements with acceptance records and optional e-signature (provider chosen first); meeting scheduling (availability, slots, links, rescheduling, conflict detection); potential-meetings list (manual ranking rules until phase 7); calendar feed and reminders; completion reporting
- Acceptance: a proposal becomes a campaign with an approved deliverable and a confirmed meeting; booking conflicts are rejected; a Manager sees only assigned records.

## Phase 4 — PR and events ✅ DONE (see docs/PHASE4_REPORT.md)
- Endpoints for: PR invitations with accept/decline tracking; events (venue, schedule, guest list, dress code, capacity, plus-one requests); RSVPs, digital passes, QR check-in and attendance; PR packages (preferences, shipping, tracking, delivery, receipt confirmation); reminders and calendar invitations; PR history
- Acceptance: an event runs end to end with check-in; replayed scans do not double-count; capacity is enforced.

## Phase 5 — Social, analytics and dashboard data ✅ DONE (see docs/PHASE5_REPORT.md)
- First: verify each platform's current official API docs and update `social-integrations`. Ship follower sync before posting.
- Endpoints for: account connection (encrypted tokens, connection status), daily follower snapshots, growth series and available metrics, dashboard summary endpoint (pending proposals, upcoming meetings, event reminders, unread messages, overdue deliverables, profile and portfolio views, proposal response rate), shared content calendar, drafts with captions and hashtags, scheduling and publishing where supported, publish status and failures per platform, manual fallback entry
- Acceptance: a connected account's followers update automatically; a failed sync returns a stale marker and accepts manual entry; a failed publish is reported per platform.

## Phase 6 — Customers, commerce and earnings ✅ DONE (see docs/PHASE6_REPORT.md)
- Commerce: customers and leads; categories, products, variants, images; search and category filter; cart and checkout; discounts, promotions, shipping charges; inventory and stock alerts; orders, fulfillment, shipping, cancellation, returns, refunds; offline payment methods; sales reports and exports (see `commerce`)
- Earnings: campaign fees, expected income, payment milestones, invoices, partial payments, receipts and references, optional expenses and affiliate commissions, promo codes and affiliate links with attributed sales, summaries and downloadable reports; every figure tagged `manual` or `synced`
- Acceptance: a customer completes an order using an offline method; illegal order transitions rejected; stock never negative; refund cannot exceed paid amount; online payment attempts rejected while `PAYMENT_PROVIDER` is blank; invoice with partial payments totals correctly.

## Phase 7 — AI and automation ✅ DONE (see docs/PHASE7_REPORT.md)
- Endpoints and jobs for: `AiProvider` adapter with usage cap; inbox classification and summaries; reply and email drafting; meeting filtering into potential meetings; lead and purchase-intent detection; comment reply suggestions and configurable auto-replies; growth recommendations; workflow rules (triggers, conditions, actions, delays, notification rules); scheduled jobs and recurring reports; enable/disable per rule; approval settings; execution logs, retries, failure notifications (see `ai-automation`)
- Acceptance: AI off rejects every AI route; drafted replies need a human before sending; fixed approval levels cannot be relaxed; every AI and workflow run is logged; failed jobs are visible and replayable.

## Phase 8 — Hardening, API freeze and staging ✅ DONE (see docs/PHASE8_REPORT.md)
- [x] Security review, authorization and data-isolation tests, payment-handling and job tests, performance check on realistic data
- [x] Review the whole API for UI-agnostic shape and consistent naming; then freeze `/api/v1` and tag the release
- [x] Backup and restore drill; Cloudinary → S3 copy-and-verify procedure rehearsed
- [x] Usage, deployment, backup, recovery and maintenance documentation; handover checklist
- [x] Deploy to a staging Hostinger VPS; run all flow scripts against it as the smoke test; update-preserves-`clients/<name>/` test
- [x] Full phase checklist passes; write a short "UI integration guide" (auth and CSRF flow, `/me`, pagination, errors, uploads) for UI builders

---

## After the backend (not started until phase 8 passes)
- New influencer = copy the tagged backend, add `clients/<name>/client.config.*`, fresh database and secrets, deploy (see `client-deploy`).
- Each client's UI is its own repo, built on `packages/api-client`, moved in with the deferred UI skills from `.claude/_deferred/`. First UI doubles as the pilot: run it with the first influencer for the agreed trial period.
- Landing page and theme showcase: its own repo, built only after at least one UI exists. Not planned here.

## Later enhancements (on request)
- Online payment gateway (once chosen) · SMS/WhatsApp · brand/PR portal · loyalty and rewards · digital products · more platforms · PWA (UI repo) · other languages
