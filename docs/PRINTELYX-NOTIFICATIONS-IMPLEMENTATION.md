# PRINTELYX — Notifications Implementation

**Date:** 2026-11-26

## Existing Infrastructure (Reused)

### Providers

| Provider | Status | Used for |
|---|---|---|
| **Resend (email)** | Production-ready (`packages/adapters/src/email/resend.adapter.ts`), wired in container when `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` set | Password-reset ONLY. No order/payment emails wired. |
| **Stub (email)** | Dev/test in-memory capture (`packages/adapters/src/email/stub.adapter.ts`) | Dev fallback |
| **Stub (SMS)** | No real SMS gateway (`packages/adapters/src/sms/stub.adapter.ts`) | Not wired |
| **In-app (Notification table)** | Production (`prisma/schema.prisma:773`, `repos.notifications`) | Shopkeeper notifications |
| **FCM / Web Push** | **Not implemented** | N/A |
| **Capacitor push** | **Not implemented** | N/A |

### Notification Table (DB-backed, shopkeeper-facing)

- `model Notification` — `shopId`, `kind`, `orderId?`, `payload Json?`, `readAt?`, `@@index([shopId, readAt, createdAt])`.
- Repository: `repos.notifications.createForShop`, `unreadForShop`, `markRead`.
- **Dedup:** Application-layer only (no DB unique constraint on `(shopId, orderId, kind)` — documented as a future improvement).

## Events Supported

| Event | Shopkeeper notification | Customer notification | Status |
|---|---|---|---|
| Order placed | ✅ `kind: 'new_order'` | In-app (tracking page) | Added in Feature 4 |
| Payment submitted (UTR) | ✅ `kind: 'payment_submitted'` | In-app (tracking page) | Existing |
| Payment confirmed | ✅ `kind: 'payment_confirmed'` | In-app (tracking page) | Added in Feature 4 |
| Payment rejected | In-app (order event) | In-app (tracking page shows reject reason) | Existing |
| Order ready | ✅ `kind: 'order_ready'` | In-app (tracking page) | Existing |
| Order collected | Order event only | n/a | Existing |
| Order cancelled | Order event only | In-app (tracking page) | Existing |
| Refund initiated | Order event only | n/a | Added in Feature 4 (refund service) |

## In-App Notification Center

The shopkeeper dashboard has a notifications queue:
- `src/app/shop/payments/page.tsx` — pending payment confirmations.
- `src/app/shop/dashboard/page.tsx` — recent orders + notifications.
- Shopkeeper APIs: `GET /api/v1/shops/me/orders` (list), `POST /api/v1/shops/me/orders/[id]/confirm-payment` (confirm/reject).

**Customer notification center:** Not a separate page — the customer receives notifications via:
1. The order tracking page (`/o/[token]`) which polls + uses realtime (Socket.IO).
2. The order confirmation screen (`StepConfirmation`) which refreshes status on mount.
3. The order history page (`/orders`) which shows status badges.

## Push Notifications (FCM / Web Push)

**Not implemented.** The audit found no Firebase Cloud Messaging, Web Push, or Capacitor push notification integration. Implementing push requires:
1. Firebase project setup + `FIREBASE_SERVER_KEY` / `FIREBASE_WEB_PUSH_CERT` env vars.
2. Service worker registration for Web Push (`public/sw.js`).
3. Device token registration endpoint (`POST /api/v1/customer/device-token`).
4. Token refresh + removal handling.
5. Background notification tap → deep link to `/o/[token]`.

This is a significant feature that was not in scope for this stabilization session.

## Email Notifications

**Not wired for order events.** The `ResendEmailAdapter` is production-ready but only called from `forgot-password`. To wire customer emails:
1. Call `container.email.send(...)` in `placeOrder` (order confirmation), `confirmPayment` (payment confirmed), `refreshOrderPrintState` (order ready).
2. Add email templates (order_placed, payment_confirmed, order_ready, order_cancelled, refund_initiated).
3. Record delivery status (Resend returns a message ID).

## Reliability

- **Idempotent notification creation:** The `Notification` table has no DB-level dedup. Application-layer check-then-insert reduces duplicates but is raceable. A `@@unique([shopId, orderId, kind])` partial index would close this (documented as future work).
- **No notification for unverified payment:** The `payment_submitted` notification fires when the customer submits a UTR, NOT when the order is marked paid. The `payment_confirmed` notification fires only after the shopkeeper confirms (or the webhook verifies). This is correct — no false "paid" notifications.
- **No notification for uncommitted order:** The `new_order` notification fires inside `placeOrder` AFTER the order is persisted (after `db.update('order', ...)`). If the order creation fails, no notification is created.

## Limitations

1. No customer-facing email (only password-reset).
2. No push notifications (FCM/Web Push not implemented).
3. No SMS (stubbed).
4. Notification dedup is application-layer, not DB-enforced.
5. No notification preferences UI (customers can't opt out of specific channels).
