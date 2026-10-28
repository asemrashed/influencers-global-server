---
name: pwa-standards
description: Use ONLY when the project requires an installable/offline app (PWA, service worker, Workbox).
---

# PWA Standards

## When this applies
Only for projects that declare a PWA requirement in their `CLAUDE.md` (usually a later phase).

## Manifest
- `name`, `short_name`, `start_url`, `display: standalone`, `theme_color`, icons (192, 512, maskable).

## Service Worker (Workbox)
- Precache: app shell, fonts, core icons.
- Runtime cache:
  - Read-heavy API GET → NetworkFirst with cache fallback.
  - Static assets → CacheFirst, long TTL.
  - Images → StaleWhileRevalidate.
- NEVER cache: auth endpoints, payment endpoints, any mutation, anything containing another user's data.

## Offline
- Dedicated offline fallback page.
- For any "must work offline" write action: queue in IndexedDB → flush via Background Sync on reconnect. Don't build this for actions that don't need it.

## Push
- Requires explicit user opt-in; store the subscription server-side.
- Define the notification categories your project needs in your own project skill — this file only sets the mechanics.

## Performance budget
- Lighthouse ≥ 90 for PWA + Performance as a CI gate once this phase starts.
- LCP < 2.5s, CLS < 0.1, INP < 200ms.

## Security
- HTTPS only. No cross-user caching of authenticated responses. Scope the service worker to the app path only.
