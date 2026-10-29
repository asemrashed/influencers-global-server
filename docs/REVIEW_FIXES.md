# Review fixes (after the independent review of the Phase 1–8 backend)

Suite after the fixes: **119 API tests + 4 deploy tests pass**, `tsc -b` and `eslint .` are clean, `npm audit --omit=dev` reports 0 vulnerabilities.

## Fixed
| # | Problem found | Fix | Proof |
|---|---|---|---|
| 1 | Public checkout could oversell: 6 concurrent orders on stock 1 left stock at -5, and a promo with `maxUses: 1` was used 6 times | Stock and promo use are claimed with one conditional statement each (`stock >= qty`, `usedCount < maxUses`); duplicate cart lines are merged; DB `CHECK` constraints added (migration `20261028000002_commerce_integrity`) | `commerce-integrity.test.ts` |
| 2 | Social "sync" invented +15 followers and stored them as `SYNCED`; connect labelled a typed number `SYNCED`; "publish" invented post ids and marked drafts `PUBLISHED` | Sync and publish now answer `503 CAPABILITY_DISABLED` (no platform adapter exists) and change nothing; the connect-time count is `MANUAL` | `phase5-flow.test.ts` |
| 3 | Workflows recorded `SUCCESS` without doing anything; AI routes returned canned values | `AiProvider` interface (no adapter yet, so AI stays 503); workflow actions are a closed list (`SEND_EMAIL`) that really queues email jobs; conditions are evaluated; delay honoured; unsupported or unreachable actions end `FAILED` with the reason; pending runs can be approved/rejected (`POST /workflows/runs/{id}/decide`); `ORDER_CREATED` and `INBOX_MESSAGE_RECEIVED` fire from real events and can never fail the customer's request; an AI approval is decided once and no longer claims `executedAt` | `workflows-ai.test.ts` |
| 4 | Payments, refunds, shipments, returns ignored the `assigned` scope | One `assertOrderInScope` on every order action (another user's order is `404`) | `commerce-integrity.test.ts` |
| 5 | 15 list endpoints returned bare arrays | The unbounded ones (orders, customers, invoices, earnings entries, store products, public albums, AI actions, workflow runs) are cursor-paginated; `limit` capped at 100 | `pagination.test.ts` |
| 6 | Anonymous endpoints only had the global limit; checkout accepted unbounded input; order numbers could collide | `RATE_LIMIT_PUBLIC_PER_MIN` (default 20/IP) on checkout, inquiries, booking, RSVP; checkout input bounded and sanitized; random order numbers; unique-violation races become `409` | `commerce-integrity.test.ts` |
| 7 | Further commerce bugs found while fixing | Payments cannot exceed the amount due; refunds cannot exceed what was paid (both race-safe); a cancel releases stock once; a return restocks once; blocked customers cannot order; strangers cannot rename customers; customer spend counts money received; shipping a cancelled order is refused | same file |
| 8 | `npm run lint` failed (34 errors); `db:generate` failed on a fresh clone; two stale RBAC tests; wrong numbers in the Phase 8 report | Fixed; `db:generate` now builds the packages it imports first; report corrected | CI steps |

## Still open (not built, not hidden)
- No file upload/download endpoints: the S3/Cloudinary/local storage adapters are wired but no route uses them.
- No tests for the SMTP, S3 and Cloudinary adapters, and none were ever run against real services.
- Email is sent only for invitations, password resets and workflow `SEND_EMAIL`; no reminders or notification emails yet.
- No AI adapter and no social platform adapters; both capabilities stay off until a provider is chosen.
- Small config lists stay unpaginated by design: store categories, rate card, availability slots, social accounts, workflow rules.
- `GET /orders` lists are scoped, but nothing yet assigns orders to Managers (`assignedUserId` is set only in the database).
- The new `CHECK` constraints will refuse to apply to a database that already holds overpaid/negative rows; clean those first on any existing install.
