---
name: audit-log
description: Use ONLY if audit logging is enabled or privileged/security actions must be recorded.
---

# Audit Log — optional capability (`AUDIT_LOG_ENABLED`)

Audit log = permanent business/security record ("who did what to what, when"). It is NOT the application log (see `error-handling-logging`).

## What to record
- Auth: login success/failure, logout, password change/reset, MFA/device changes, session revocation.
- Authorization: role/permission grants and revocations, access-denied on sensitive resources.
- Privileged/admin actions and destructive actions (delete, bulk edit, export, impersonation).
- Business-critical changes: money, grades/records, status transitions — as defined per project in its `CLAUDE.md`.

## Entry shape
`{ id, at, actorId, actorRole, action ("module.verb"), targetType, targetId, before?, after?, ip, userAgent, reqId, result }`
- Store a minimal diff or changed fields, not whole sensitive records. NEVER store passwords, tokens, card data or secrets.

## Rules
- Append-only: no update/delete API; app DB role has INSERT/SELECT only on this table where feasible.
- Written server-side from one `audit.record()` helper called by services, in the same transaction as the change when integrity matters.
- Failure to write an audit entry for a privileged action fails the action (don't silently skip).
- Index by `(targetType, targetId)`, `actorId`, `at`. Define a retention policy per project; paginate reads; viewing it needs its own permission.
- When `AUDIT_LOG_ENABLED=false`, the helper is a no-op — the code path stays, behavior is off.
