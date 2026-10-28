# Phase 2 report: Profile, public API, inbox and support

Checklist run for Phase 2. A box is ticked only where a command or test proved it. Test counts: 84 API tests including policy tests, OpenAPI contract tests, deploy plan tests, and the end-to-end headless flow script (`phase2-flow.test.ts`).

## Delivered
- **Database models & migration**: `Profile`, `PortfolioAlbum`, `PortfolioItem`, `MediaKit`, `RateCardItem`, `Contact`, `InboxThread`, `InboxMessage`, `Notification`, `SupportTicket`, `SupportTicketReply`, and `ManagerAssignment`.
- **49 registered endpoints**:
  - Public profile & portfolio endpoints (`/api/v1/public/profile`, `/api/v1/public/portfolio/albums`, `/api/v1/public/portfolio/albums/{slug}`).
  - Public collaboration/booking inquiry submission (`POST /api/v1/public/inquiries`) with bot honeypot validation and rich-text sanitization.
  - Profile, media kit, and rate card management (`/api/v1/profile`, `/api/v1/media-kit`, `/api/v1/rate-card`).
  - Portfolio albums & items management with ordering and cover image metadata.
  - Contacts directory with filters, search, and scoped permissions (`/api/v1/contacts`).
  - Unified inbox threads & messaging with unread tracking, status transitions, and in-app notifications (`/api/v1/inbox/threads`, `/api/v1/notifications`).
  - Support ticket system with categories, priorities, assignment, status tracking, and scoped replies (`/api/v1/support/tickets`).
- **OpenAPI & Typed Client**: `openapi.json` expanded to 49 paths; `packages/api-client` regenerated and synced.
- **Security & Authorization**: All endpoints enforce explicit access policies (`public`, `authenticated`, or permission-gated with scopes). Rich HTML fields sanitized with DOMPurify on write.

## Exit criteria
- [x] A brand submits a public collaboration inquiry and staff sees it in the unified inbox.
- [x] Public routes validated, rate-limited, bot-protected, and explicitly registered.
- [x] A support ticket can be created, assigned, replied to, and resolved with scope filtering (`own` scope for Managers).
- [x] End-to-end flow test (`phase2-flow.test.ts`) passes.
- [x] API contract, policy checks, and deploy plans all pass.

