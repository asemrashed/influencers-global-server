# API Integration Guide for Frontend Builders (`/api/v1`)

This guide summarizes how any frontend (web, mobile, or micro-app) communicates with the Influencer Management Platform backend.

---

## 1. Authentication & Session Management
- **Type**: HttpOnly, SameSite cookie-based session (`session`).
- **CSRF Token**:
  - The login endpoint `POST /api/v1/auth/login` returns a `csrfToken` in its response body.
  - Every subsequent state-changing HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) must include the header:
    ```http
    X-CSRF-Token: <token>
    ```
- **Session Check / Me Endpoint**:
  - `GET /api/v1/me`: Returns the authenticated user, their effective roles, permissions (with scopes `all`, `assigned`, or `own`), active session details, and list of enabled modules.

---

## 2. API Contract & TypeScript Client
- **OpenAPI 3.1 Spec**: Available at `apps/api/openapi.json` and rendered at `/docs` when `API_DOCS_ENABLED=true`.
- **Client SDK**: The repository provides `@platform/api-client`, a typed fetch client generated directly from `openapi.json`.
  ```ts
  import { createClient } from '@platform/api-client';

  const client = createClient({ baseUrl: 'https://api.yourdomain.com' });
  const profile = await client.GET('/api/v1/public/profile');
  ```

---

## 3. Error Contract & Handling
Every error returned by `/api/v1` follows a unified machine-readable JSON structure:
```json
{
  "code": "VALIDATION_FAILED | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | CAPABILITY_DISABLED",
  "message": "Human-readable explanation",
  "details": [
    { "path": "email", "message": "Invalid email address format" }
  ],
  "requestId": "req-1730000000-abc"
}
```

---

## 4. Pagination & Query Standards
- List endpoints use cursor-based pagination:
  - Query parameters: `?limit=25&cursor=<nextCursor>`
  - Response format:
    ```json
    {
      "items": [...],
      "nextCursor": "cur_123456"
    }
    ```

---

## 5. Domain Endpoints Summary
| Domain | Prefix | Access Requirements |
|---|---|---|
| **Public Storefront** | `/api/v1/store/*` | Public (Categories, Products, Checkout) |
| **Public Profile** | `/api/v1/public/*` | Public (Profile, Rate Card, Portfolio, Inquiries, RSVP, Booking) |
| **Auth** | `/api/v1/auth/*` | Public for login/reset; authenticated for 2FA setup |
| **Commerce Management** | `/api/v1/customers`, `/api/v1/products`, `/api/v1/orders` | `customers.*`, `products.*`, `orders.*` |
| **Earnings & Invoices** | `/api/v1/earnings/*` | `earnings.read`, `earnings.write` |
| **Inbox & Support** | `/api/v1/inbox/*`, `/api/v1/support/*` | `inbox.*`, `support.*` |
| **Collaboration & Events** | `/api/v1/collaboration/*`, `/api/v1/events/*` | `collaboration.*`, `events.*` |
| **Social & Analytics** | `/api/v1/social/*`, `/api/v1/analytics/*` | `social.*`, `analytics.*` |
| **AI & Automation** | `/api/v1/ai/*`, `/api/v1/workflows/*` | `ai.*`, `workflows.*` (503 if capability disabled) |

