---
name: caching
description: Use when adding Redis or server caching, cache invalidation, or HTTP cache headers. (Client-side TanStack Query keys belong to the UI repos.)
---

# Caching Rules

## Client (TanStack Query) — applies in UI repos only, not in this backend repo
- TanStack Query is the single source of truth for server data on the client — no parallel local copies in component state.
- Query key convention (pick one, document it in the project's `CLAUDE.md`, then never deviate):
  `[domain, resource, id?, filters?]` — e.g. `['billing', 'invoices', invoiceId]`, `['billing', 'invoices', 'list', {status}]`.
- A mutation invalidates every query key it affects — write the invalidation list explicitly in the mutation, don't rely on broad wildcard invalidation as a default.

## Server (Redis)
- Redis is optional (`REDIS_ENABLED`); app must stay correct without it. Fix slow queries/indexes first (see `performance`).
- Cache hot, frequently-read, rarely-changed data: permissions, config, lookup tables.
- Cache expensive aggregate/report queries for a short TTL (5–15 min) rather than recomputing per request.
- Cache keys are namespaced by domain, mirroring the query-key convention, so invalidation is predictable.
- Never cache per-user sensitive data under a shared/global key.

## HTTP
- Static assets: long cache + hashed filenames (cache-bust via filename, not headers).
- Authenticated API responses: no shared/public caching.
