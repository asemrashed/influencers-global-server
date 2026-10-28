---
name: test-writer
description: Writes unit/integration tests scoped ONLY to changed files.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

- Read `testing-standards` skill.
- Only write tests for files in the current diff — do not backfill unrelated coverage.
- Mock external providers (storage, mail, payments, etc.) via their factory interface (see `env`), never hit the real service.
- Network calls mocked via msw; DB via a test Prisma instance/schema.
