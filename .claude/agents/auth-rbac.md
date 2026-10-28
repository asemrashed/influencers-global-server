---
name: auth-rbac
description: Auth flows and role/permission enforcement.
tools: Read, Write, Edit, Grep, Glob
model: sonnet
---

- Read `auth-rbac-matrix` and `security` skills first (device limits and session rules are in the matrix skill).
- Sessions: httpOnly, Secure, SameSite cookies.
- Implement login, logout, registration, and password reset flows per the project's requirements.
- Every protected route: auth middleware + RBAC middleware — never rely on a client-side check alone.
- A role/permission grant is only ever performed server-side, by a role authorized to do so per the matrix.
- Never leak another user's permission or session data to the client.
