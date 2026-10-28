---
name: api-contract
description: Use when defining or changing a request/response shape between frontend and backend, shared DTOs, or Zod contract schemas.
---

# API Contract Rules

## Single source of truth
- All DTOs/request/response shapes live in `/packages/shared-types` as Zod schemas, with TypeScript types inferred from them (`z.infer<...>`).
- Frontend and backend import the SAME schema file — never hand-write a parallel type on either side.

## Shape conventions
- Every endpoint declares a request schema and a response schema, even if trivial.
- Pagination response shape: `{ items, nextCursor?, total? }`.
- Error response shape: `{ code, message, details? }` (see `error-handling-logging`).

## Naming
- JSON fields: camelCase. URL segments: kebab-case. Routes: plural nouns.

## Change discipline
- A breaking change to a shared schema requires updating both consumers in the same PR — the type system will catch drift if you don't skip this.

## Backend-first: the API is the product (any UI can be built on it later)
- Zod schemas also generate the OpenAPI document (e.g. `@asteasolutions/zod-to-openapi`). Every route is registered with its schemas, access policy and error codes, so the spec cannot drift from the code.
- Interactive docs at `/docs` (Scalar or Swagger UI). Controlled by `API_DOCS_ENABLED`; off in production unless the client asks.
- `packages/api-client` is generated from the spec (types + a thin typed fetch wrapper). UI repos depend ONLY on it and `shared-types`. CI fails if the generated client is stale.
- UI-agnostic: no endpoint shaped around one screen or one theme. Return normalized resources plus filters; add aggregate endpoints (dashboard, summaries) as explicit, documented resources.
- `GET /api/v1/me` returns the user, effective permissions with scopes, and enabled modules, so any UI can gate its navigation without extra calls (server still enforces).
- Stable machine-readable error `code`s (never parse `message`); these are part of the contract. Also stable: pagination shape, sort/filter param names, `source` tags, ISO-8601 UTC timestamps, money as integer minor units + currency code.
- Within `/api/v1`: add fields and endpoints freely; never remove, rename or change the meaning of one. A breaking change means `/api/v2` and a migration note.
- Each module ships a headless e2e flow script (see `testing-standards`) acting as the first client of its endpoints.
