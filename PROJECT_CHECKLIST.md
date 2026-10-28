# PROJECT_CHECKLIST — Influencer Management Platform

Run at the end of each phase. Tick ONLY what was verified (command run, test passed, behavior observed). Delete rows for capabilities not yet built.

## Config & providers
- [ ] App refuses to boot with missing/invalid env (try it).
- [ ] `.env.example` matches the Zod schema; no secret in any client-exposed var.
- [ ] Each enabled provider works via its adapter; each disabled capability's endpoints are rejected server-side (AI, email, payment).
- [ ] `PAYMENT_PROVIDER` and `AI_PROVIDER` are blank unless the team chose one.
- [ ] A disabled module toggle makes its routes reject (verified by a request, not by hiding anything).

## Security & authorization
- [ ] Every route has an explicit access policy; no unintended public routes.
- [ ] Per new route: 401 unauthenticated, 403 wrong permission, 403/404 other user's resource ID.
- [ ] Manager scope: a Manager cannot read or change records outside their assignment.
- [ ] Custom role created by Super Admin takes effect on the user's next request; last Super Admin cannot be removed; nobody can grant a permission they lack.
- [ ] Uploads validated (size, type, content); private files served by short-lived signed URLs only.
- [ ] No secrets/PII in logs; social/email tokens encrypted at rest; webhooks signature-verified.
- [ ] Public forms and checkout rate-limited and bot-protected.
- [ ] CORS allows only listed origins; a request from another origin is rejected; CSRF enforced on cookie-session writes.
- [ ] OpenAPI spec and `api-client` contain no secrets or internal-only fields.
- [ ] AI: inbound text never treated as instructions; approval-required actions cannot run without approval; AI actions logged.

## Standalone isolation
- [ ] No tenant column, shared service or cross-client call introduced.
- [ ] Deploy script touches only the client named in its config; rollback of one client leaves others untouched.
- [ ] Client-specific code lives under `clients/<name>/` only; a core update does not overwrite it, data, config or secrets.

## Reliability & data
- [ ] Multi-step writes are transactional; retried/webhook/job handlers proven idempotent (replay test).
- [ ] Order state machine rejects illegal transitions; stock cannot go negative; refunds cannot exceed the paid amount.
- [ ] Failed social sync shows a stale marker and manual fallback; no fabricated numbers.
- [ ] Manual and synced figures are visibly distinguished (`source` tag).
- [ ] Migrations reviewed; backup taken before destructive ones.

## Quality
- [ ] Lint, typecheck, tests, build all green.
- [ ] List endpoints paginated and indexed; no N+1 on new queries.
- [ ] Critical flows tested (happy path + failure + invalid input).
- [ ] Every new endpoint is in OpenAPI with its access policy and error codes; `api-client` regenerated; docs render at `/docs`.
- [ ] API change is backward-compatible within `/api/v1`; shared-types and generated client updated; the module's flow script passes; demo seed updated.

## Deploy (if releasing)
- [ ] `/health` and `/ready` respond; rollback path noted.
- [ ] Release tagged; changelog written; client's running tag recorded.
- [ ] Backup restore verified at least once for this client.
