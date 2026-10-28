---
name: conventions
description: Use when unsure about folder structure, file naming, or import order.
---

# Project Conventions

## Folders
/apps/api, /packages/shared-types, /packages/config, /packages/api-client, /tools/deploy, /clients/<name> (monorepo mode; a UI, when built, is a separate repo)
(a project's `CLAUDE.md` may add more — keep the delta there, not here.)

## Naming
- Files: kebab-case (`student-table.tsx`)
- Components: PascalCase
- Hooks: `useXxx`
- Services: `xxx.service.ts`
- Routes: plural nouns (`/students`, `/invoices`)

## Imports (order)
1. node builtins
2. external packages
3. `@packages/*`
4. `@/apps/*`
5. relative imports
6. styles

## General
- No default exports except framework-required ones (e.g. Next.js pages).
- Path aliases only — no `../../..` chains.
- One component per file (small private helpers may colocate).
