---
name: performance
description: Use when adding list endpoints, queries, indexes, heavy pages, or investigating slowness: indexing, N+1, pagination, bundle size.
---

# Performance Rules

## Database
- Index every FK, filter column and sort column used by a list/search query; composite index order = equality columns first, then range/sort.
- No N+1: load relations with `include`/joins or batch by IDs. Check the query count of any new list endpoint.
- Select only needed columns for list views; never return full rows with large text/JSON blobs in lists.
- Prefer cursor pagination for large or fast-growing tables; offset is fine for small admin lists. Cap `limit` server-side (e.g. max 100).
- Slow-looking query? Run `EXPLAIN ANALYZE` before adding cache — fix the query/index first, cache second (see `caching`).
- Long-running work (reports, bulk import/export, emails) goes to a background job, not the request cycle.

## API
- Set a request timeout and a payload size limit on every route.
- Compress responses (gzip/brotli); avoid chatty endpoints — one screen should need few requests.

## Frontend
- Server Components by default; `"use client"` only where interaction needs it.
- Code-split heavy/rarely-used components (dynamic import); lazy-load below-the-fold content and images (`next/image`, explicit dimensions).
- Virtualize lists > ~100 rows. Debounce search inputs. Avoid unnecessary re-renders (stable keys, memo only where measured).
- Budget: check bundle size when adding a dependency; prefer a small util over a large library.

## Proportionality
- Apply targets (Lighthouse, load testing, Redis, horizontal scaling) only when expected traffic, requirements or the deployment environment justify them.

## Verify
- Measure before optimizing (Lighthouse, query logs, profiler). No speculative optimization.
