# Deferred (UI work)

Not loaded by Claude Code (outside `.claude/skills` and `.claude/agents`). The backend is built first; client UIs are separate repos built later against `packages/api-client`.

When a UI repo is started, copy these into that repo's `.claude/` folder:
- skills: `component-registry`, `ui-component-library`, `reusable-components`, `theming`, `pwa-standards`
- agents: `ui-architect`, `frontend-ui`

Do not use them in this backend repo.
