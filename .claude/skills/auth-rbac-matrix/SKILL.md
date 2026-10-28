---
name: auth-rbac-matrix
description: Use when defining roles/permissions, adding a module's permission rows, or touching scope rules. Filled for the Influencer Management Platform.
---

# Auth & RBAC Matrix — Influencer Management Platform

## Model
- Permissions are constants `module.action`, declared in code by the module that owns them and synced into the `permissions` table at boot. Roles are DB rows (`roles`, `role_permissions`, `user_roles`); the Super Admin can create any custom role. Env never defines roles or grants permissions.
- Each role-permission link has a scope: `all`, `assigned` (records linked to the user's brand/PR assignment), or `own` (records the user created). Repositories apply the scope filter; middleware `requirePermission('module.action')` checks the permission.
- Default roles are seed data and editable, except Super Admin: **locked, always every permission**, cannot be edited, removed or demoted if it is the last one.

## Default matrix (✅ = granted, A = granted with `assigned` scope, ❌ = not granted)
| Permission | Super Admin | Admin | Manager |
|---|:---:|:---:|:---:|
| roles.manage, integrations.manage, ai.configure | ✅ | ❌ | ❌ |
| roles.read (view roles and the permission catalog; needed to invite and assign roles) | ✅ | ✅ | ❌ |
| settings.read | ✅ | ✅ | ❌ |
| settings.write, audit.read | ✅ | ❌ | ❌ |
| users.read, users.write, users.invite | ✅ | ✅ | ❌ |
| users.revoke | ✅ | ✅ (not Super Admin) | ❌ |
| profile.read, profile.write, portfolio.write | ✅ | ✅ | ❌ |
| contacts.read, contacts.write | ✅ | ✅ | A |
| inbox.read, inbox.reply | ✅ | ✅ | A |
| inbox.approve (AI drafts, auto-replies) | ✅ | ✅ | ❌ |
| proposals.read, proposals.write | ✅ | ✅ | A |
| proposals.respond (accept/decline) | ✅ | ✅ | ❌ |
| campaigns.read, campaigns.write | ✅ | ✅ | A |
| deliverables.read, deliverables.submit | ✅ | ✅ | A |
| deliverables.approve | ✅ | ✅ | ❌ |
| agreements.read | ✅ | ✅ | A |
| agreements.write, agreements.sign | ✅ | ✅ | ❌ |
| meetings.read, meetings.write | ✅ | ✅ | A |
| meetings.confirm | ✅ | ✅ | ❌ |
| events.read, events.write, events.checkin | ✅ | ✅ | A |
| pr.read, pr.write | ✅ | ✅ | A |
| content.read | ✅ | ✅ | A |
| content.write, content.publish | ✅ | ✅ | ❌ |
| social.read | ✅ | ✅ | ❌ |
| analytics.read | ✅ | ✅ | ❌ |
| earnings.read, earnings.write | ✅ | ❌ | ❌ |
| customers.read, customers.write | ✅ | ✅ | ❌ |
| products.read, products.write | ✅ | ✅ | ❌ |
| orders.read, orders.write | ✅ | ✅ | ❌ |
| orders.refund | ✅ | ❌ | ❌ |
| support.read, support.write | ✅ | ✅ | own |
| workflows.read | ✅ | ✅ | ❌ |
| workflows.write | ✅ | ❌ | ❌ |
| reports.export | ✅ | ✅ | ❌ |

Anything not listed is denied by default. Defaults are a starting point: the Super Admin can grant more (for example `earnings.read` or `orders.refund` to an Admin) through custom roles.

## Rules
- Nobody can grant a permission they do not hold; only `roles.manage` can edit roles. Role and permission changes are audit-logged and take effect on the user's next request.
- Server enforces everything. Hiding a menu item or button in a UI is UX only. Per route: 401 unauthenticated, 403 wrong permission, 403/404 for a record outside scope.
- The client never receives another user's permission data.
- New module → add its permission rows here in the same PR that adds its routes.
- 2FA is required for Super Admin and Admin. Device limits are OFF for this project.
- Managers represent brands or PR teams: every Manager is linked to the organizations or campaigns they may see through `ManagerAssignment`; no assignment means no records.
- `GET /api/v1/me` exposes the caller's own effective permissions and scopes (never anyone else's) so UIs can gate navigation.