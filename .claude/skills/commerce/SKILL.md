---
name: commerce
description: Use when building the store: catalog, variants, cart, checkout, orders, inventory, shipping, returns, refunds, sales reports. Gateway undecided, see `payments`.
---

# Commerce (e-commerce and merchandise — release 1)

Works together with `payments` and `reliability`. `PAYMENT_PROVIDER` stays blank until the team chooses a gateway; do not pick one.

## Catalog and storefront
- Product, Category, Variant (price, SKU, stock). Product images go through `StorageProvider`. Search, category filter, sort and pagination are server-side.
- Public storefront routes are public by design; admin routes need permissions (`products.*`, `orders.*`). Storefront responses are DTOs and never expose cost, stock internals or other customers' data.

## Prices and totals
- The server computes every price, discount, shipping charge and total from the DB. Never trust amounts from the client.
- Money in integer minor units with a currency code. Discount codes are validated server-side (dates, usage limits, eligibility).

## Cart and checkout
- Checkout runs in one transaction: validate stock, reserve or decrement via `InventoryMovement`, create the Order. Stock never goes negative; use a row lock or optimistic version for the stock check.
- Idempotency key on order creation so a double submit returns the same order.
- Public checkout and guest forms are rate-limited and bot-protected.

## Order state machine
`pending → paid | failed | cancelled`, `paid → fulfilled → delivered`, `paid → refunded` (full or partial), plus `return_requested → returned → refunded`. Reject illegal transitions in the service; record each transition with actor and time.

## Payments (until a gateway is chosen)
- Only offline methods are enabled: cash on delivery, and manual bank or mobile transfer that an Admin confirms. Online payment attempts are rejected, never faked as success.
- When a gateway is chosen: add it behind `PaymentProvider`, verify server-side, accept webhooks only when signature-verified and idempotent, never store card data (see `payments`).

## Fulfillment, returns, refunds
- Shipment records with carrier, tracking and status. Return requests with reason and decision. Refunds need `orders.refund` and an audit entry. Stock is restored only for returned items marked resellable.

## Reports and alerts
- Sales reports and downloadable exports require `reports.export`. Low-stock alerts use the notifications queue. Digital products and extra store features only if approved later.

## Tests
Duplicate submit, simultaneous last-item purchase, tampered amount, illegal transition, refund over the paid amount, and a rejected online payment while the gateway is blank.
