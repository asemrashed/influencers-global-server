# Phase 4 report: PR and events

Checklist run for Phase 4. A box is ticked only where a command or test proved it. Test counts: 90 API tests across policy, OpenAPI, deploy plans, and end-to-end integration flows.

## Delivered
- **Database models & migration**: `Event`, `EventRsvp`, `PrPackage`, and `PrInvitation`. Applied migration `20261027000002_phase4_pr_events`.
- **8 new endpoints (71 total paths registered in OpenAPI)**:
  - Public event view (`GET /api/v1/public/events/{slug}`)
  - Public RSVP submission (`POST /api/v1/public/events/{slug}/rsvp`) with capacity checks, plus-one tracking, and unique digital pass (`ticketCode`) issuance.
  - Event management (`/api/v1/events`) and attendee roster lookup (`/api/v1/events/{id}/rsvps`).
  - QR ticket check-in scanner (`POST /api/v1/events/checkin`) with anti-replay protection (prevents double-counting).
  - PR packages management (`/api/v1/pr/packages`, `/api/v1/pr/packages/{id}`) with items, carrier, shipping tracking, and delivery/receipt confirmation timestamps.
  - PR invitations logging (`/api/v1/pr/invitations`) with brand/event details and status.
- **Contract & Client**: Regenerated `openapi.json` (71 paths) and regenerated typed `api-client`.
- **Flow testing**: Passed `apps/api/tests/phase4-flow.test.ts`.

## Exit criteria
- [x] An event runs end to end with capacity validation on RSVP.
- [x] Check-in scanner validates QR tickets; replayed scans do not double-count.
- [x] PR gift package shipments and confirmations tracked.
- [x] Permissions synced and scoped across admin and manager roles.

