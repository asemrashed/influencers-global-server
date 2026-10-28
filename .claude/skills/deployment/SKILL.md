---
name: deployment
description: Use when setting up CI/CD, health checks, production migrations, backups, provider/DB switching, or rollback.
---

# Deployment & Operations

## Pipeline
- CI: `npm ci` → lint → typecheck → test → build → `npm audit`. Deploy only from a green main.
- Same build artifact promoted across environments; config differs only by env vars (see `env`).

## Multi-app deploys
- In a monorepo, each app has its own pipeline/build target, env and release; deploy only affected apps. The API deploys (and migrates) BEFORE a web release that depends on new API behavior; keep the API backward-compatible for one release.

## Runtime
- `/health` (liveness) and `/ready` (DB/Redis reachable) endpoints; no secrets or version internals in the response.
- Graceful shutdown (see `reliability`). Run as non-root; pin dependency versions and base images.
- Set `NODE_ENV=production`, disable debug/verbose errors, enable HTTPS-only + secure cookies.

## Database changes
- Migrations run as a deploy step (`prisma migrate deploy`), never `migrate dev`/`db push` in production.
- Before any destructive or hard-to-reverse migration (drop/rename column, type change, data backfill): take a verified backup, and prefer expand → migrate → contract across two releases.
- Large backfills run as batched jobs, not inside the migration transaction.

## Backups & recovery
- Automated DB backups with a stated retention; uploaded files backed up or stored on versioned storage.
- A backup is untested until restored: do a restore drill and record RPO/RTO in the project's `CLAUDE.md`.
- Switching DB host or storage provider is a migration project: dump/copy → verify counts/checksums → cut over → keep old copy until verified. Never flip the env var on live data.

## Release & rollback
- Every release has a rollback path (previous artifact + backward-compatible schema). Note irreversible steps in the release notes.
- Monitor after deploy: error rate, latency, failed jobs. Alert on health-check failure.
