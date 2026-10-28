---
name: notifications
description: Use ONLY if the project sends email, SMS or push: provider adapters, OTP/reset safety, rate limits.
---

# Notifications (Email / SMS / Push) — optional capability

Include only if the project needs it. Disabled unless its provider env var is set (see `env`).

## Adapter
- One `NotificationProvider` interface per channel (`EmailProvider.send`, `SmsProvider.send`), resolved by factory from `EMAIL_PROVIDER` / `SMS_PROVIDER`. Call sites never import a vendor SDK.
- If the provider for a channel is blank, the channel is OFF: `send` returns an explicit `{ status: "disabled" }` (never `sent`), logs once at boot, and does not pick another provider.
- Callers must handle the result. Flows that REQUIRE delivery (OTP, password reset, verification) reject with a typed `AppError` when the channel is disabled or fails — never report success. Best-effort notices (digests, FYIs) may skip and log.
- Provider choice for SMS/email is project-specific. If the project needs it and none is chosen, ASK the user (e.g. SMTP, Resend, SES, SendGrid for email; local BD gateways, Twilio for SMS). Never invent credentials.

## Sending
- Send through a background job/queue, not inline in the request (see `reliability`).
- Templates live in code/versioned files with typed variables; escape all user-supplied values (HTML email = XSS vector).
- Dedupe: one logical event → one message (idempotency key). Respect user opt-out/preferences where the project defines them.
- Rate-limit user-triggered sends (OTP, password reset) per user AND per IP to prevent SMS/email bombing and cost abuse.
- OTP/reset tokens: random, hashed at rest, short expiry, single use.
- Never log full message bodies containing tokens/OTPs; mask recipients (`+88017****123`).
- Provider webhooks (delivery status) are untrusted: verify signature before updating state.
