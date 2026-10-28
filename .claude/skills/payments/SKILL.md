---
name: payments
description: Use ONLY if the project takes payments. Gateway must be chosen by the user first; covers server-side verification, idempotent callbacks, refunds.
---

# Payments — optional capability (`PAYMENT_PROVIDER` stays BLANK until the user chooses)

## Gate (do this first)
1. Does the project need payments? If not, confirm and leave it out entirely.
2. If yes and `PAYMENT_PROVIDER` is unset/undecided: STOP and ask the user which gateway (e.g. SSLCOMMERZ, ShurjoPay, bKash, Nagad, Stripe, other) and whether sandbox or live.
3. Never assume a gateway, never invent keys/URLs. Use `.env.example` placeholders only.
4. Once chosen, record it in the project's `CLAUDE.md` and add a provider skill (`payment-<provider>`) rather than growing this file.

## Adapter
- `PaymentProvider` interface: `createPayment`, `verifyPayment`, `handleWebhook`, `refund`. Factory from env; business code never imports a gateway SDK.

## Non-negotiables
- **Server decides amount and currency.** Never trust an amount, price or status sent by the client or by a redirect URL.
- **Redirect ≠ paid.** Mark an order paid only after server-side verification: verified webhook signature and/or a call to the gateway's verify API, with amount, currency and merchant reference all matching the order.
- **Idempotent**: duplicate/replayed callbacks must not double-credit. Dedupe on gateway transaction ID (unique constraint) inside a DB transaction (see `reliability`).
- Order states are an explicit state machine (`pending → paid | failed | cancelled → refunded`); reject illegal transitions.
- Webhook endpoints: signature-verified, raw-body handling, no auth cookie, rate-limited, always respond fast and process async.
- Refunds/manual overrides need elevated permission and an audit entry (see `audit-log`).
- Never store card numbers/CVV. Never log gateway secrets or full payloads containing PII.
- Reconcile: a scheduled job re-checks `pending` payments older than N minutes against the gateway.
- Test with the gateway's sandbox via a test double of the adapter; cover duplicate, failed, tampered-amount and out-of-order callbacks.
