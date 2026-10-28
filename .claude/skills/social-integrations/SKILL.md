---
name: social-integrations
description: Use when connecting social accounts, syncing followers or analytics, publishing posts, or reading and replying to comments and messages.
---

# Social Integrations

Platforms: Facebook, Instagram, TikTok, LinkedIn, YouTube, Telegram. Capabilities depend on API access, account type, permissions and platform approval. Never promise a capability that is not verified for the platform below; always provide a manual alternative.

## Capability status (checked 19 Oct 2026 against official docs where marked)
| Platform | Followers | Posting / comments | Status |
|---|---|---|---|
| Instagram | `followers_count`, Business and Creator accounts only; needs `instagram_business_basic` (Instagram Login) or `instagram_basic` + `pages_read_engagement` (Facebook Login) | Not confirmed | Count verified |
| Facebook Pages | `followers_count`; Page-owned data needs `pages_read_engagement`; user must be able to moderate the Page | Not checked | Count verified |
| TikTok | `follower_count` via `user.info.stats` scope | Posting needs a separate content audit (weeks); until then every post is private with no error. Comment scopes exist (`comment.list.manage`) | Count verified; posting gated |
| YouTube | `subscriberCount` (not confirmed on the official page) | Default quota 10,000 units/day and 100 `videos.insert`/day until a compliance audit | Quota verified; rest unverified |
| LinkedIn | Followers metric reported for personal profiles only by a third-party summary | Not confirmed | Unverified |
| Telegram | Member count via the Bot API (bot as channel admin) | Bot posts to its channel; reading comments depends on the linked group and bot privacy mode | Unverified |
Re-verify against each platform's current official docs before building that platform. Update this table with what you verify.

## Design
- `SocialProvider` interface per platform behind a factory; `SocialAccount` stores encrypted tokens, scopes, connection status and last sync time.
- Sync, publish and comment-reading are separate capabilities per account; each can be off.
- A scheduled job writes one `FollowerSnapshot` per account per day. If a sync fails or the account is disconnected, show the last good number with a stale marker and offer manual entry (`source = manual`). Never show a made-up number.
- Cross-posting adapts one draft per platform; failures are reported per platform and the user can copy the post for manual publishing. TikTok posts are never described as public until the audit has passed.
- Handle token expiry and revocation: mark the account as needing reconnection, notify the Super Admin, keep other platforms working.
- Credentials: each client registers its own developer apps, or explicitly authorizes us to manage them. Tokens live only in that client's own database and env. Platform app review is a per-client onboarding task.

## Safety
- Treat API responses, webhook payloads, comments and messages as untrusted input (Zod-validate, verify signatures). Respect rate limits with backoff and a cap; never retry non-idempotent publishes blindly (dedupe on a publish-job ID).
- Comment auto-replies follow the approval levels in `ai-automation`.
- Never log tokens or full message bodies.
