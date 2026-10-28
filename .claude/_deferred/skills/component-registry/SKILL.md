---
name: component-registry
description: Use BEFORE creating any UI component, to check what already exists. Index of primitives and app components for the Influencer Management Platform.
---

# Component Registry — Influencer Management Platform

## 🧱 shadcn Primitives (NEVER recreate)
Button, Input, Textarea, Select, Checkbox, Radio, Switch, Dialog, Sheet, Drawer,
Table, Card, Badge, Tabs, Tooltip, Popover, Dropdown, Calendar, Form, Toast, Skeleton.

## 🧩 Shared App Components (/packages/ui)
| Component | Path | Used For |
|-----------|------|----------|
| DataTable | /packages/ui/data-table | ALL list/table views, pagination, sort, filters |
| StatCard | /packages/ui/stat-card | Dashboard KPI cards |
| PageHeader | /packages/ui/page-header | Title + breadcrumb + actions |
| FilterBar | /packages/ui/filter-bar | Search + filters above tables |
| FormModal | /packages/ui/form-modal | Any create/edit dialog |
| ConfirmDialog | /packages/ui/confirm-dialog | Destructive actions |
| EmptyState | /packages/ui/empty-state | No data UI |
| ErrorState | /packages/ui/error-state | Error UI |
| PermissionDeniedState | /packages/ui/permission-denied-state | 403 UI (required by the product scope) |
| RoleGate | /packages/ui/role-gate | Permission-based conditional render (UX only) |
| LoadingSkeleton | /packages/ui/loading-skeleton | Page/table skeletons |
| Pagination | /packages/ui/pagination | Cursor + offset |
| FileUploader | /packages/ui/file-uploader | Storage provider-agnostic (see `storage`) |
| UserAvatar | /packages/ui/user-avatar | Any dashboard |

Every list and detail view handles loading, empty, error and permission-denied states, not just the happy path.

## 🧩 Project-Specific Components — add rows here as they are built
Planned (create only when the phase needs them, check the shared set first):
| Component | Path | Used For |
|-----------|------|----------|
| ApprovalBadge | /packages/ui/approval-badge | Marks AI drafts and items waiting for human approval (phases 2, 7) |
| ConnectionStatus | /packages/ui/connection-status | Social account state: connected, stale, error, manual (phase 5) |
| SourceTag | /packages/ui/source-tag | Shows `manual` vs `synced` on earnings and analytics figures (phases 5, 6) |
| CalendarView | /packages/ui/calendar-view | Content, events and meetings calendars (phases 3–5) |
| ThreadView | /packages/ui/thread-view | Inbox conversations (phase 2) |

## 📋 Rules
- BEFORE creating ANY component → search this file first.
- 80%+ similar to something listed → EXTEND with props, don't fork.
- Permission differences → `RoleGate` or a prop — never a per-role duplicate (see `reusable-components`).
- Components must be theme-neutral: colors, fonts, spacing and radius come from design tokens, never hardcoded (see `theming`).
- New reusable component → add it to this table in the same PR that introduces it.
