---
name: theming
description: Use AFTER release 1 when building the 10-15 UI designs: design tokens, layout shells, section variants, theme catalog. Also read when writing any component, to keep it theme-neutral.
---

# Theming (10–15 UI designs, built after the release 1 pilot)

Designs are not started until the platform is stable. Until then, the only rule that applies is: components stay theme-neutral.

## Approach: one web app, themes as packages
- `packages/themes/<theme-name>/`: design tokens (color, type, spacing, radius), a layout shell, public-site section variants (hero, gallery, media kit, shop), and optional component overrides from a fixed list.
- A client's theme is chosen in its config and applied at build time. All themes use the same `shared-types` contracts and the same API, so a design never needs backend changes.
- If some designs truly need a different page structure, add a small number of layout shells; many token themes can share one shell.

## Rules
- Components read tokens only: no hardcoded colors, fonts, spacing or radius anywhere in `packages/ui` or the apps.
- Never fork a component per theme; parameterize it or use a slot or override from the fixed list.
- The admin area stays largely shared; most visual difference lives in the public site and the shop.
- Every theme supports loading, empty, error and permission-denied states, desktop and mobile layouts, and meets contrast requirements.

## Maintenance
- A theme catalog page renders every theme against the same sample data, with screenshot and accessibility checks in CI, so a core change that breaks one theme is caught before release.
- A theme never touches client data or logic. Client-specific UI changes go in `clients/<name>/` (see `client-deploy`).

## Landing page
Separate marketing app in its own repository and deployment (own `CLAUDE.md`), with no shared runtime and no client data. It shows the design catalog with real live-demo URLs (undeployed themes are labelled preview or coming soon, never given invented URLs), plus theme admin and an inquiry form. Build it after the designs exist.
