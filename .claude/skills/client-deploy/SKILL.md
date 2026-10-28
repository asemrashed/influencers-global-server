---
name: client-deploy
description: Use when setting up a client deployment, per-client config, releases, updates, rollback, client-specific features, or moving files from Cloudinary to S3.
---

# Client Deployment & Updates (standalone installs, Hostinger VPS)

Each client runs a tagged release of the core on its own Hostinger VPS, with its own domain, env, database, storage and secrets. Nothing runs shared between clients.

## Per-client config
- One config file per client (`clients/<name>/client.config.*`, no secrets in it): domain, API release tag, enabled modules, providers chosen, allowed UI origins (CORS), backup target, and a pointer to the client's UI repo and tag. The deploy script reads it and can only touch that client.
- Secrets live in that client's server env or the host's secret store, never in the repo.

## Releases
- The core is versioned with tags and a changelog. Record each client's running tag.
- The API is backward-compatible within `/api/v1`; breaking changes need a new version and a migration note.
- Database migrations follow `deployment`: expand, migrate, contract; verified backup before anything destructive.

## Client-specific features
- Live only in `clients/<name>/`, plugged in through documented extension points (routes, module toggles, jobs). Never edit core files for one client.
- If a second client wants the same thing, promote it into core behind a module toggle, then delete the client copy.
- Update safety: a core update must not overwrite `clients/<name>/`, data, config or secrets. Test this on staging before every rollout.

## Rollout
1. Tag, deploy to a staging copy, run the smoke test.
2. Deploy clients one at a time, least critical first.
3. A failed client rolls back alone (previous tag + backward-compatible schema); others are untouched.

## Hostinger VPS setup (standard practice; confirm plan size and OS image with Hostinger)
- Nginx reverse proxy with Let's Encrypt certificates; the API as a systemd or PM2 service; PostgreSQL on the same server for small clients. The client's UI (static or Node, from its own repo) is served from a sibling subdomain.
- Firewall allows only web traffic and key-based SSH; automatic security updates; run services as non-root.
- Start with at least 4 GB RAM as an assumption, then confirm with a load test.
- Nightly encrypted DB dumps copied off the server to S3; a restore drill is done and recorded before go-live.
- Docker is optional, not required.

## File storage move (Cloudinary now, S3 main target)
- Files are stored under provider-neutral keys with metadata in `StoredFile`, so moving is copy → verify counts and checksums → switch `STORAGE_PROVIDER` → keep the old copy until verified. Never flip the env var on live data.

## Handover checklist
Domain and DNS, VPS account, database, storage, email sender domain, social developer apps or authorization, AI key if used, Super Admin created with 2FA, roles reviewed, backup and restore verified, admin guide delivered, maintenance and update schedule agreed.

## New influencer from the finished backend
1. Copy or fork the core at a release tag into the client's own repo/folder. Create `clients/<name>/client.config.*` (domain, modules, providers, allowed origins). No tenant column, no shared service.
2. Fresh database, own env and secrets, own storage. Run migrations, then the REQUIRED seed only (roles, permissions, Super Admin invite). Never run the demo seed in production.
3. The client's UI is a separate repo built on `packages/api-client` at that API tag. UI and API deploy and roll back independently.
4. Serve UI and API under the same registrable domain (e.g. `app.client.com` and `api.client.com`) so SameSite cookie sessions work; list the UI origin in `CORS_ORIGINS`. Anything else needs an explicit security decision.
