# Influencer Platform: Backend

One complete, UI-free backend per influencer. Each client gets a copy of this repo at a release tag, its own database and domain, and its own separate UI built on the generated typed client. Not SaaS, not multi-tenant: there is no tenant column anywhere.

```
apps/api               Express 5 + Prisma 7 + PostgreSQL API (the product)
packages/shared-types  Zod contracts shared by the API and every UI (pure types, no secrets)
packages/config        env schema (fail-fast) and client-config schema
packages/api-client    typed client, GENERATED from the API's OpenAPI spec
tools/deploy           per-client deploy script (dry run by default)
clients/<name>/        per-client config and backend extensions
.claude/, *.md         project rules and plan (start with CLAUDE.md, MASTER_PLAN.md)
```

## Quick start

Needs Node 22+ and PostgreSQL 16.

```bash
npm ci
cp apps/api/.env.example apps/api/.env      # set DB_PROVIDER + its URL, APP_ENCRYPTION_KEY (openssl rand -base64 32), SUPER_ADMIN_EMAIL
npm run db:generate                          # Prisma client
npm run db:migrate                           # apply migrations
npm run seed                                 # roles, permissions, and a Super Admin invitation link (printed once)
npm run seed:demo                            # optional sample users; never in production
npm run dev                                  # http://localhost:4000, docs at /docs
```

## Choosing providers (all from `apps/api/.env`)

Change the provider name and fill in that provider's credentials; no code changes. A selected provider with missing credentials stops the app at boot with a message naming the variable. Credentials of providers you are not using are ignored.

| Capability | Variable | Values | Credentials needed |
|---|---|---|---|
| Database | `DB_PROVIDER` | `neon`, `mydb`, `local` | `NEON_DATABASE_URL`, `MYDB_DATABASE_URL`, or `LOCAL_DATABASE_URL` (blank `DB_PROVIDER` = plain `DATABASE_URL`) |
| Storage | `STORAGE_PROVIDER` | `cloudinary` (default), `s3`, `local` (dev), blank = off | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`, or `S3_BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY` (+ `S3_ENDPOINT` for R2, MinIO, etc.) |
| Email | `EMAIL_PROVIDER` | `smtp`, `console` (dev), blank = off | `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` |

Switching database or storage does **not** move existing data or files; migrate, verify, then cut over (see the `deployment` skill). Migrations (`npm run db:migrate`) use the same provider selection, so run `npm run build` once first (the Prisma CLI reads `@platform/config`). For Neon, use the direct host rather than the `-pooler` one so migrations and the job queue work.

The seed prints an invitation link. Accept it (`POST /api/v1/auth/invitations/accept`), then Super Admin and Admin accounts must enrol two-factor on first sign-in.

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | build, then API tests against a real PostgreSQL (`TEST_DATABASE_URL`, default `localhost:5433/p6_test`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript across all workspaces |
| `npm run client:generate` | regenerate `apps/api/openapi.json` and `packages/api-client/src/schema.ts` after any route change |
| `npm run deploy -- clients/<name>/client.config.json` | print the deploy plan; add `--apply` to run it |

## How a UI talks to the API

- Cookie session (httpOnly, SameSite=Lax) plus an `X-CSRF-Token` header on every state-changing request. The generated client does both. Serve UI and API under the same registrable domain and list the UI origin in `CORS_ORIGINS`.
- `GET /api/v1/me` returns the user, effective permissions with scopes, enabled modules and the CSRF token. Use it to shape navigation; the server enforces everything.
- Errors are always `{ code, message, details?, requestId }`. Branch on `code`.
- Lists use `?limit=&cursor=` and return `{ items, nextCursor? }`.

```ts
import { createApiClient } from '@platform/api-client';
const api = createApiClient({ baseUrl: 'https://api.client.com' });
await api.POST('/api/v1/auth/login', { body: { email, password } });
const { data } = await api.GET('/api/v1/me');
```

## Database migrations

`apps/api/prisma/migrations/20261026000000_init` was generated from `schema.prisma` in an environment where Prisma's migration engine could not run, then applied and exercised by the full test suite on PostgreSQL 16. The CI job "Migrations match schema.prisma" runs `prisma migrate diff` to prove there is no drift. If it ever reports a difference, fix it with `npx prisma migrate dev --name fix_init` on a developer machine before any client database exists. After that, all schema changes go through `prisma migrate dev` as usual.
