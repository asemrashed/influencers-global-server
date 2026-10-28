---
name: ui-component-library
description: Use when organizing shared UI in /packages/ui or deciding component structure and layering.
---

# UI Component Library Organization

## Three tiers
1. **Primitives** — shadcn base components. Never modified, never forked.
2. **Composites** — generic, domain-agnostic building blocks made from primitives (DataTable, FormModal, StatCard). Live in `/packages/ui`.
3. **Feature components** — specific to one app/feature, built from composites. Live under `/apps/*`, promoted to `/packages/ui` once a second consumer needs them (see `reusable-components`).

## Role-based conditional rendering (canonical pattern)
❌ NEVER: separate components per role (`AdminStudentTable`, `TeacherStudentTable`).
✅ ALWAYS: one component + a `role`/`permissions` prop + `<RoleGate allow={[...]}>` around role-gated actions + field-level `canEdit` checks for inputs.

## Data & state components
- Lists/tables → the shared `DataTable`, not a bespoke `<table>`.
- KPIs → the shared `StatCard`.
- Modals → `FormModal` / `ConfirmDialog`, not ad-hoc `Dialog` usage per feature.
- Loading → `LoadingSkeleton`. Empty → `EmptyState`. Error → `ErrorState`. Every list/detail view handles all three states, not just the happy path.
