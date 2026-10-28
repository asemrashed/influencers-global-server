---
name: env
description: Use when adding env vars, config validation, provider factories, or enabling/disabling optional capabilities (storage, cache, email/SMS, payments, audit log, device limits).
---

# Env & Config Rules

## Validation
- All env vars validated with Zod at process boot. Invalid/missing required var → the app refuses to start (fail fast, not fail silently at request time).
- Keep a `.env.example` in sync with every var the schema requires.
- Never commit a real `.env` file.

## File layout (where env lives)
- **Each deployable owns its env file**: `apps/api/.env` (and, only if a UI ever lives in this repo, that app's own file). Never one shared root `.env` for all apps — they deploy separately and need different secrets.
- **Secrets (DB URL, payment/provider keys, session secret) exist only in the API's env.** A separate UI repo gets only public values (its API base URL).
- Commit a `.env.example` per app; never commit real `.env*`. In production, values come from the platform's secret store.
- The Zod schema lives in `/packages/config` and is composed into `apiEnv`; any future UI app composes its own `webEnv` and never requires API secrets.

## Provider factory pattern
- Any swappable external dependency (storage, cache, mail, payments, etc.) is resolved once at boot from an env var, behind a small factory function returning a common interface:
  ```
  const storage = createStorageProvider(env.STORAGE_PROVIDER) // -> StorageProvider
  ```
- Call sites depend on the interface, never on the concrete provider or its SDK.
- Adding a new provider = one new factory branch + implementing the interface — no changes anywhere else.

## Config values
- Numeric/boolean limits (rate limits, quotas, feature flags) belong in env or a settings table, not hardcoded in business logic, if they're plausibly different per deployment or need runtime changes.

## Optional capabilities contract
Each is OFF/blank by default. Enable only if the project's requirements need it (see Requirements Intake in `GLOBAL.md`).

| Capability | Env | Notes |
|---|---|---|
| File storage | `STORAGE_PROVIDER` = `local`/`s3`/`r2`/`cloudinary`/… | see `storage` |
| Cache | `REDIS_ENABLED`, `REDIS_URL` | app must work without it (see `caching`) |
| Background jobs | `JOBS_ENABLED` | see `reliability` |
| Email / SMS | `EMAIL_PROVIDER`, `SMS_PROVIDER` | blank = channel off; see `notifications` |
| Payments | `PAYMENT_PROVIDER` | **blank until the user chooses**; see `payments` |
| Audit log | `AUDIT_LOG_ENABLED` | see `audit-log` |
| Device limits | `DEVICE_LIMIT_ENABLED` | per-role limits are project config, see `auth-rbac-matrix` |
| CORS | `CORS_ORIGINS` | explicit allowlist of UI origins; no wildcard with credentials |
| API docs | `API_DOCS_ENABLED` | OpenAPI UI at `/docs`; off in production by default |

## Rules for these flags
- Zod enum per provider var (reject unknown names). Provider selected → its required credentials become required (`superRefine`); provider blank → its credentials must be absent/ignored.
- Distinguish optional infra (Redis, jobs: off → degrade gracefully) from capabilities (payments, required-delivery notifications: off → operations rejected, never faked).
- Changing `DATABASE_URL` or `STORAGE_PROVIDER` does NOT move existing data (see `deployment`).
- Disabled means disabled **on the server** (routes/handlers/jobs not registered or reject), not merely hidden by a UI.
- Never silently fall back to another provider when the configured one fails — fail loudly.
- Database: `DATABASE_URL` is the only DB switch (Postgres + Prisma) — do not add a redundant `DATABASE_PROVIDER` unless provider-specific behavior is needed. Moving host (Neon ↔ self-hosted ↔ VPS-local) requires the migrate → verify → cut-over procedure in `deployment`; changing the URL alone moves no data.
- Secrets never use a client-exposed prefix (`NEXT_PUBLIC_*`, `VITE_*`) in any UI repo. Public config only.
- Environment variables configure behavior; they NEVER grant permissions or define roles.
