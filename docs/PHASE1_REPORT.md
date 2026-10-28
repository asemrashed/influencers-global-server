# Phase 1 report: Foundation, access and API contract

Checklist run for Phase 1. A box is ticked only where a command or test proved it. Test counts: 75 API tests (8 files) + 4 deploy-plan tests, against a real PostgreSQL 16.

## Delivered
- Monorepo (npm workspaces): `apps/api`, `packages/{shared-types,config,api-client}`, `tools/deploy`, `clients/`. No UI code.
- Express 5 API: auth (login, logout, invitations, password reset and change, TOTP two-factor with recovery codes), RBAC (permission registry synced at boot, custom roles, scopes `all`/`assigned`/`own`), users, invitations, roles, settings, module toggles, audit log, `GET /me`, `/health`, `/ready`.
- 29 documented endpoints, `/docs`, generated `openapi.json` and typed `api-client`.
- pg-boss job queue with dedupe, a cleanup job and an email job. Required seed and demo seed. Deploy script (dry run by default).

## Exit criteria
- [x] Super Admin signs in with 2FA, creates a custom role, assigns permissions, invites a Manager; the Manager is limited by it, and role changes take effect on the very next request (`rbac.test.ts`).
- [x] Every route has an explicit access policy. Unauthenticated access returns 401 on every non-public route; every permission route returns 403 without the permission; the live Express router contains exactly the registered routes (`policy.test.ts`).
- [x] A request from a non-allow-listed origin is rejected (`auth.test.ts`).
- [x] No secrets in the OpenAPI spec or `api-client` (`openapi.test.ts`); no client-exposed env prefixes exist.

## PROJECT_CHECKLIST (Phase 1 rows)
**Config and providers**
- [x] App refuses to boot with missing or invalid env (run by hand: exit code 1, and `env.test.ts`).
- [x] `.env.example` matches the Zod schema (`env.test.ts`).
- [x] Disabled capabilities reject, never fake: email off gives 503 `CAPABILITY_DISABLED`; `AI_PROVIDER` and `PAYMENT_PROVIDER` accept only blank.
- [x] A disabled module toggle makes its route reject with `MODULE_DISABLED`. Verified with a probe route, because no Phase 1 route belongs to a toggleable module yet.

**Security and authorization**
- [x] Per route: 401, 403, out-of-scope record returns 404 (IDOR check on users and invitations).
- [x] Custom role effective on next request; last Super Admin cannot be removed, demoted or disabled (including two concurrent demotions); nobody can grant a permission or wider scope they lack.
- [x] Sessions: hashed at rest, rotated on login and on 2FA completion, ended on revoke, password reset and change. Passwords use argon2id. TOTP secrets are AES-256-GCM encrypted, recovery codes hashed, TOTP replay rejected.
- [x] CSRF token required on all state-changing session requests; rate limits on global and auth routes; Helmet, strict API CSP, `no-store`.
- [x] Raw ORM objects cannot leak: every response is re-parsed through its response schema.
- [ ] Manager `assigned` scope: the scope engine and fail-closed default are unit-tested, but no resource uses `assigned` until Phase 2 adds `ManagerAssignment`. Re-check then.
- [ ] Uploads and signed URLs: no upload endpoints exist yet (Phase 2).
- [ ] "No secrets or PII in logs": redaction is configured and the audit log was checked, but request logs were not audited exhaustively.

**Standalone isolation**
- [x] No tenant column, shared service or cross-client call. The deploy plan only ever targets the one server in a client's config (`plan.test.ts`).

**Reliability and data**
- [x] Multi-step writes use transactions; job enqueue dedupes by key; the cleanup job is safe to run twice.
- [ ] Migrations reviewed; backup taken before destructive ones: the deploy plan includes `pg_dump` before `migrate deploy`, but it has not been executed against a real server.

**Quality**
- [x] Lint, typecheck, build and tests all green; `npm audit`: 0 vulnerabilities.
- [x] List endpoints paginated (cursor), indexed foreign keys.

**Deploy**
- [x] `/health` and `/ready` respond; graceful shutdown on SIGTERM checked by hand.
- [ ] `deploy --apply` on a real Hostinger VPS, release tagging and restore drill: not done (no server available). Planned for Phase 8.

## Known limitations to resolve
1. **Initial migration was generated offline.** Prisma's migration engine could not be downloaded in the build environment, so `20261026000000_init` was produced from the schema by script (following Prisma's naming conventions) and exercised by every test. The CI step "Migrations match schema.prisma" is there to prove no drift; **that CI step itself has not been run**. Confirm it once on a normal machine (see README).
2. In-memory rate limiting suits one API process per client (the planned deployment). It would need a shared store if the API were ever clustered.
3. Email has only a `console` development provider. Invitations and resets work without email (token handed over once); a real provider (SMTP or a service) is chosen when the team decides.
4. Users cannot change their own email, and there is no self-service 2FA disable (an Admin can reset it). Deliberate for Phase 1.

## Added beyond the original Phase 1 list
`PasswordResetToken` table, `roles.read` permission, password-reset and 2FA-reset endpoints for operators, `api-client` auto-CSRF handling.
