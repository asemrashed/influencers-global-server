---
name: error-handling-logging
description: Use when implementing error responses, AppError, logging, request IDs, or client-side error display.
---

# Error Handling & Logging

## HTTP status codes
400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 429 rate-limited, 500 server error.

## Error shape
```
{ code: "RESOURCE_NOT_FOUND", message: "human-readable", details?: {...} }
```

## Server
- Wrap route handlers in a shared `asyncHandler` (or framework equivalent) so thrown errors reach one central error middleware.
- Central middleware maps a typed `AppError` (with `code`, `status`, `message`) to the HTTP response — business logic throws `AppError`, never crafts responses itself.
- Structured log per request: `{ level, msg, reqId, userId, route, durationMs }`. No `console.log` in production paths.

## Client
- Every error carries a stable `code`; UIs map `code` to their own messages and notifications.
- Never leak a raw stack trace or internal error message in a response — return `code` + a safe `message` only.

## Request IDs & redaction
- Generate/accept a `reqId` per request, return it in a response header and the error body, and include it in every log line and downstream/job call.
- Logger redacts by key: `password`, `token`, `authorization`, `cookie`, `secret`, `otp`, card/payment fields, and PII not needed for debugging.
- Log levels: `error` = needs action, `warn` = degraded/expected failure, `info` = lifecycle. Don't log validation noise as errors.

## Reliability hooks
- Unknown/unexpected errors → 500 with generic message + `reqId`; details only in logs. Operational errors (`AppError`) carry a stable `code`.
- Add a top-level handler for unhandled rejections/exceptions that logs and exits cleanly (see `reliability`).
- Client: error boundary per route segment; show retry for network/5xx, form-field messages for 400 `details`.
- Transactions, retries and idempotency rules live in `reliability`.
