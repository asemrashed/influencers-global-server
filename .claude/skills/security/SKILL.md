---
name: security
description: Use when working on auth, sessions, headers, CSRF, sanitization, secrets, uploads, webhooks, or any security-sensitive code.
---

# Security Rules

## Input & Output
- Zod validates every input, client AND server (shared schema — never re-validate with different rules in two places).
- DOMPurify sanitizes user-generated HTML wherever accepted or rendered (before DB write and before render). Plain text fields are escaped on output, not run through the HTML pipeline.
- Never trust a client-supplied file's declared mime type — verify server-side.

## Secrets & Data Exposure
- `server-only` on any file touching DB, secrets, or credentials — guarantees it can't leak into the client bundle.
- API responses are DTOs mapped from ORM objects, never raw ORM objects (prevents accidental field leakage).
- No secret, API key, or connection string in a committed file — env only (see `env`).

## AuthN / AuthZ
- Passwords hashed with bcrypt or argon2. Never store or log raw passwords.
- Sessions: httpOnly, Secure, SameSite cookies.
- Every route declares an explicit access policy. Public routes (login, health, signature-verified webhooks) are deliberately marked public.
- Every protected route: authentication middleware AND authorization (RBAC) middleware — client-side role checks are UX only, never the source of truth.
- Rate-limit auth endpoints and any write-heavy route.

## Headers & Transport
- Helmet for secure headers (CSP, X-Frame-Options, HSTS, etc.).
- CSRF tokens on state-changing requests.
- HTTPS only in any non-local environment.

## Operational
- Audit log privileged and security-relevant actions (see `audit-log`).
- Security checks run once per request (e.g. at middleware), not re-computed per field, to stay cheap.
- Dependency vulnerabilities checked in CI (see `security-scanner` agent / `devops`).

## Also forbidden
- Authorizing from client input: role flags, env flags, hidden fields or client-sent IDs without an ownership/permission check (IDOR). Every by-ID lookup is scoped to what the caller may access.
- Exposing secrets via `NEXT_PUBLIC_*`/client bundles; accepting arbitrary upload paths or trusting file extensions (see `storage`).
- Marking anything paid/approved from an unverified callback or client redirect (see `payments`).
- Destructive migrations without backup + recovery plan (see `deployment`).
- Logging passwords, tokens, payment secrets or unneeded PII (see `error-handling-logging`).
- Treat provider callbacks/webhooks, uploaded files, DB content from users and third-party API responses as UNTRUSTED input: validate shape with Zod, verify signatures, escape on output.
- Sessions: rotate session ID on login/privilege change; invalidate on password change/logout; absolute + idle expiry.
