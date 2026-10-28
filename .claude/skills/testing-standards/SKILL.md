---
name: testing-standards
description: Use when writing or planning tests: scope, mocking providers, authorization and critical-flow coverage.
---

# Testing Standards

## Scope
- A PR's tests cover ONLY the files changed in that PR — don't re-test the whole app on every change (token + time cost).

## Tooling
- Unit: Vitest (or project's chosen runner). Integration: test runner + msw (mock network) + a test DB/Prisma instance.

## Mocking
- Mock any external provider (storage, mail, payments, third-party API) via its factory — swap in a test double, don't hit the real service.
- Mock at the interface boundary defined in `env`/`storage`, so tests don't need to know the concrete vendor.

## Targets
- Services/business logic: aim ~80% coverage.
- Components: cover critical interactive paths (~60%), skip trivial presentational ones.
- Avoid snapshot tests on large/complex components — they rot silently and don't catch real regressions.

## Always cover (for changed code)
- **Authorization:** each new route tested for unauthenticated (401), wrong role (403) and another user's resource ID (403/404 — IDOR).
- **Critical flows:** auth, payments, anything money/grade/record-changing — happy path plus failure, duplicate/replay and invalid-input cases (see `reliability`, `payments`).
- **Feature flags:** when a capability is disabled, its endpoints reject/are absent.
- Run with provider test doubles; never real payment/SMS/email calls.

## Backend-first: headless flow tests
- Each module ships one e2e flow script (Vitest + supertest or an HTTP client against a test DB) that walks its main user journey through the real API using the generated `api-client`: sign in, create, transition, forbidden attempt, invalid input. This is the stand-in for a UI until one exists.
- The same scripts run against staging after deploy as the smoke test.
- Skip component-test targets here; they belong to UI repos.
