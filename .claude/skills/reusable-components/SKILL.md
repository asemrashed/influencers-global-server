---
name: reusable-components
description: Use when deciding whether to extract, share, or parameterize a component instead of forking it.
---

# Reusable Components — Extraction Rules

## Rule of Three
- Needed in 1 place → keep it local to that feature.
- Needed in 2 places → consider extracting; not mandatory yet.
- Needed in 3+ places → extract to `/packages/ui` now. Don't wait for a 4th copy to appear.

## Prefer parameterization over forking
- If two versions of a component differ only by role, data shape, or a few options — add a prop. Do not create `ComponentNameAdmin`, `ComponentNameTeacher`, etc.
- If they differ substantially in structure/behavior, they're probably two different components with a shared sub-piece — extract the shared sub-piece, not the whole thing.

## Before creating anything new
1. Check `component-registry` for an existing match.
2. If 80%+ similar → extend with a prop, update the registry entry.
3. If genuinely new → build it, then add it to `component-registry` in the same PR.

## Ownership
- Once promoted to `/packages/ui`, a component has no feature-specific logic left in it — feature code passes data/handlers in via props, it doesn't reach into the component's internals.
