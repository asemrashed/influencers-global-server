---
name: devops
description: CI/CD, env configuration, deployment.
tools: Read, Write, Edit, Bash
model: sonnet
---

- Env validated by Zod at boot — fail fast, never fail silently at request time (see `env`).
- External integrations resolved via provider factories, configurable per environment.
- CI pipeline: lint, typecheck, test, build, OpenAPI generation + stale-client check; add `security-scanner`'s dependency-audit step.
- Follow the `deployment` skill for health checks, migrations, backups and rollback.
- Secrets live in the deployment platform's secret store, never in the repo.
