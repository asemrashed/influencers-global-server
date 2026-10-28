---
name: reliability
description: Use when writing multi-step writes, webhooks, retries, background jobs, or external calls: transactions, idempotency, timeouts, degradation.
---

# Reliability Rules

## Data integrity
- Multi-step writes that must succeed or fail together run in ONE database transaction. Never leave partial state.
- Enforce invariants in the DB too (unique constraints, FKs, CHECKs) — not only in application code.
- Concurrent updates to the same record: use optimistic locking (version column) or row locks where lost updates matter (balances, stock, seats).

## Idempotency
- Any endpoint/handler that can be retried or delivered twice (webhooks, payments, job handlers, "submit" buttons) must be idempotent: accept an idempotency key or dedupe on a unique external ID, and return the original result on replay.

## External calls
- Every outbound call has a timeout. Retry only idempotent calls, with exponential backoff + jitter and a max attempts cap.
- Never retry validation/4xx failures. Surface a typed `AppError` when retries are exhausted.
- Failed async work (jobs) goes to a dead-letter/failed state that is visible and replayable — never silently dropped.

## Graceful degradation
- Optional dependencies (cache, notifications) failing must not take down core flows: log, skip or queue, continue. Required dependencies (DB, auth) fail fast with a clear error.
- Do NOT silently fall back to a different provider than configured (data would land in the wrong place) — fail loudly instead.

## Lifecycle
- Handle SIGTERM: stop accepting requests, finish in-flight ones, close DB/Redis connections.
