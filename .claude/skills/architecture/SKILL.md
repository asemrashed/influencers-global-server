---
name: architecture
description: Use when deciding module boundaries, monorepo layout, where code lives, or when to extract a package. Also for choosing the simplest architecture for a project.
---

# Architecture Rules

## Layout mode (choose per project, record in `CLAUDE.md`)
- **monorepo** — when there are 2+ deployable apps (e.g. web + api) or code shared across apps. Modular: `/apps/*` (deployable), `/packages/*` (shared, not deployable alone).
- **single-app** — one deployable (e.g. a small site, or Next.js alone with route handlers). Mapping: `/packages/ui` → `src/components/ui`, `/packages/shared-types` → `src/shared`, `/packages/config` → `src/config`. Same one-way dependency rule applies between folders.
- Backend-first projects: the monorepo holds `apps/api` plus packages; UIs live in separate repos and consume `packages/api-client`.
- Start single-app if unsure; split into a monorepo only when a second app or consumer appears.

## Monorepo rules
- Package manager: **npm** (npm workspaces) — do not use pnpm or yarn. Root `package.json` declares `"workspaces": ["apps/*", "packages/*"]` and holds dev tooling only (lint, TypeScript, formatter); each app/package has its OWN `package.json` declaring its own dependencies. Internal packages are referenced by name with version `"*"` (npm has no `workspace:*` protocol). One hoisted `node_modules` and ONE `package-lock.json`, both at the root; commit the lockfile.
- Run per-app commands with `npm run <script> -w apps/api` (or `--workspace`); install with `npm install`, and use `npm ci` in CI/deploy.
- Each app deploys independently from the same repo (e.g. web → Vercel/static host, api → VPS/container). Deploy pipelines build only what changed (path filters / `-w <workspace>`); an app must never import from another app.
- Shared packages must be buildable/consumable without Node-only or secret-bearing code leaking into the web bundle (`shared-types` stays pure Zod/types).
- Dependency direction is one-way: apps depend on packages, packages NEVER depend on apps.
- Each `/apps/api` module follows route → controller → service → repository (Prisma) layering. Controllers stay thin; business logic lives in services.

## Module boundaries
- Group backend code by domain (feature folder), not by technical layer alone — e.g. `/modules/billing/{routes,service,repository}.ts`, not one giant `/services` folder.
- Cross-domain calls go through the other domain's service interface, never straight into its repository/DB tables.
- If two domains need the same entity, decide ownership explicitly (see `architect` agent) instead of duplicating the model.

## When to extract a package
- Used by 2+ apps → promote to `/packages` (monorepo mode). In single-app mode, share via the shared folders instead.
- Used by 1 app only → keep it local until a second consumer appears.

## Contract-first
- Define the Zod schema / DTO for a new endpoint or shared entity BEFORE implementing it. Backend and frontend both consume the same definition (see `api-contract`).

## Scope discipline
- A project's `CLAUDE.md` should declare an explicit "Out of Scope" list. The `architect` agent rejects work against that list rather than silently allowing scope creep — this is what keeps token spend bounded as the project grows.

## Right-size it
- Default to the simplest structure that meets requirements. Add a separate API, package, queue or cache only when a stated requirement needs it. Record why in `CLAUDE.md`.
