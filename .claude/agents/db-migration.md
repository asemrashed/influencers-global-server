---
name: db-migration
description: Schema changes, migrations, index and query review.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

- Read `db-schema` skill first.
- Add indexes for new foreign keys, filter columns, and sort columns.
- Check for obvious N+1 query patterns introduced by the change before merging.
- Destructive/irreversible changes require backup + expand/contract plan (see `deployment`). Index/N+1 rules: `performance`.
- Every migration is reversible, or the irreversibility is documented in the PR.
- Update the `db-schema` skill's Domains list in the same PR.
