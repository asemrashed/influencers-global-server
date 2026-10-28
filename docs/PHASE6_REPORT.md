# Phase 6 Verification Report — Customers, Commerce & Earnings

## Status: COMPLETE

### Delivered Scope
1. **Schema & Database Migrations**:
   - Migration `20261028000000_phase6_commerce_earnings` applied to the database.
   - **Customers & Leads**: `Customer` with statuses (`LEAD`, `ACTIVE`, `INACTIVE`, `BLOCKED`), total spend and order counters, assigned staff tracking.
   - **Catalog & Inventory**: `ProductCategory`, `Product`, `ProductVariant` (SKU, price in cents, stock), and append-only `InventoryMovement` log for auditing every stock change.
   - **Promo Codes**: `PromoCode` supporting basis-point discounts (`discountBps`), flat minor unit discounts (`discountCents`), usage limits, expiration dates, and affiliate attribution.
   - **Orders & Fulfillment**: `Order`, `OrderItem`, `Shipment` (carrier, tracking, status), and `ReturnRequest` with conditional restocking (`restockResellable`).
   - **Earnings & Invoices**: `Invoice` with multi-step `PaymentMilestone` schedule, partial payment tracking via `EarningPayment`, standalone `EarningEntry` tracking, and explicit data provenance tags (`source: 'SYNCED' | 'MANUAL'`).

2. **Routes & Explicit RBAC Enforcement (101 Total Routes)**:
   - **Public Storefront**:
     - `GET /api/v1/store/categories` (Public)
     - `GET /api/v1/store/products` (Public)
     - `POST /api/v1/store/checkout` (Public, enforces offline payment check while gateway is unset, validates stock atomically, supports idempotency key, records inventory movement).
   - **Commerce Management**:
     - `GET /api/v1/customers` (`customers.read`, scoped `ALL` or `ASSIGNED`)
     - `POST /api/v1/customers` (`customers.write`)
     - `PATCH /api/v1/customers/{id}` (`customers.write`, scoped)
     - `POST /api/v1/products/categories` (`products.write`)
     - `POST /api/v1/products` (`products.write`)
     - `PATCH /api/v1/products/{id}` (`products.write`)
     - `POST /api/v1/products/variants/{id}/adjust-stock` (`products.write`, enforces stock non-negative invariant)
     - `POST /api/v1/promo-codes` (`products.write`)
     - `GET /api/v1/orders` (`orders.read`, scoped `ALL` or `ASSIGNED`)
     - `GET /api/v1/orders/{id}` (`orders.read`, scoped)
     - `PATCH /api/v1/orders/{id}/status` (`orders.write`, enforces strict state machine: `PENDING -> PAID | CANCELLED`, `PAID -> FULFILLED -> DELIVERED`, releases stock on cancellation)
     - `POST /api/v1/orders/{id}/payments` (`orders.write`, records offline payment)
     - `POST /api/v1/orders/{id}/refund` (`orders.refund`, enforces refund <= paid amount invariant)
     - `POST /api/v1/orders/{id}/shipments` (`orders.write`, generates shipment and marks order fulfilled)
     - `POST /api/v1/orders/{id}/returns` (`orders.write`, initiates return request)
     - `PATCH /api/v1/orders/{id}/returns/{returnId}` (`orders.write`, approves/restocks inventory when resellable)
   - **Invoices & Earnings**:
     - `GET /api/v1/earnings/invoices` (`earnings.read`)
     - `POST /api/v1/earnings/invoices` (`earnings.write`, creates invoice + payment milestones)
     - `POST /api/v1/earnings/invoices/{id}/payments` (`earnings.write`, handles partial/full offline payments)
     - `GET /api/v1/earnings/entries` (`earnings.read`, includes provenance tags)
     - `POST /api/v1/earnings/entries` (`earnings.write`, tagged `MANUAL` or `SYNCED`)
     - `GET /api/v1/earnings/summary` (`earnings.read`, aggregated store and client fee revenue)

3. **Invariants & Safety Verified**:
   - Stock never goes negative (overdraw attempts rejected with 409 conflict).
   - Online payments rejected when `PAYMENT_PROVIDER` is blank (unsupported payment method returned 400).
   - Illegal order state transitions rejected (e.g. `PENDING` directly to `DELIVERED` rejected with 409).
   - Refund cannot exceed paid amount (excessive refund rejected with 409).
   - Restocking verified upon return decision (`RETURN_RESTOCK` inventory movement generated).
   - Idempotency key verified (replay returns identical order without double decrementing stock).

4. **Test Verification**:
   - `phase6-flow.test.ts`: Passed (end-to-end flow of catalog, checkout, order transitions, returns/restock, partial invoice payments, and earnings).
   - `openapi.test.ts`: Passed (101 routes in sync, schema generator up to date).
   - `policy.test.ts`: Passed (all 101 routes explicitly mapped, 401 unauthenticated, 403 unauthorized, and CSRF token enforcement).
   - `tools/deploy`: Passed (4/4 plan tests).

