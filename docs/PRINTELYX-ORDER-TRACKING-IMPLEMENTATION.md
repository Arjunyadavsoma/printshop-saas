# PRINTELYX — Order Tracking Implementation

**Date:** 2026-11-26

## Existing Infrastructure (Reused)

The order tracking system was already substantially built. No new tracking database or duplicate status system was created.

### Routes

| Route | File | Purpose |
|---|---|---|
| `/o/[token]` | `src/app/o/[token]/page.tsx` (974 lines) | Public order tracking — token-gated (128-bit), anti-enumeration (404 for unknown/expired) |
| `/track` | `src/app/track/page.tsx` + `track-client.tsx` | Order lookup by link or order number → redirects to `/o/[token]` |
| `/orders` | `src/app/orders/page.tsx` | Customer order history (localStorage-based, capped 20) |
| `/orders/[id]` | `src/app/orders/[id]/page.tsx` | Individual order detail (token-gated) |
| `GET /api/v1/o/[token]` | `src/app/api/v1/o/[token]/route.ts` | Tracking payload (rate-limited 60/min) |
| `GET /api/v1/orders/[id]/status` | `src/app/api/v1/orders/[id]/status/route.ts` | Payment + print status poll |
| `GET /api/v1/orders/[id]/receipt` | `src/app/api/v1/orders/[id]/receipt/route.ts` | PDF receipt (pdf-lib, token-gated) |

### Status Mapping

The backend `Order.status` lifecycle (from `src/lib/orders/state-machine.ts`):

```
draft → awaiting_payment → payment_submitted → paid → queued → printing → partially_printed → ready → collected
                                                                   ↓
                                                              cancelled / failed / expired
```

The tracking page maps these to a 5-stage customer-facing timeline:
1. **Placed** — `order_placed` event
2. **Payment** — `awaiting_payment` / `payment_submitted` / `paid`
3. **Printing** — `queued` / `printing` / `partially_printed`
4. **Ready** — `ready`
5. **Collected** — `collected` / `paid_on_pickup`

Terminal states: `cancelled`, `failed`, `expired` show a distinct red notice.

### Tracking Features

- **Polling:** Visibility-aware exponential backoff (5s → 10s → 30s → 60s), stops after 30 min idle (`useTrackPoll` hook).
- **Realtime:** Socket.IO room `order:<token>` via `useOrderRealtime` hook with polling fallback.
- **Pickup code slip:** Dark "rv-code-card" when `pickupCode` is set.
- **Printing progress:** Per-task rows (`setLabel`, `sheetCount`, status label).
- **Documents:** Per-file card with name, pageCount, copies, colorMode, paperSize, duplex, pageRange, pricePaise.
- **Payment card:** Shows UTR status, counter payment instructions, rejection reason, UPI deep-link + UTR input.
- **Price breakdown:** `PriceBreakdown` component (subtotal, add-ons, urgent, total).
- **Shop details:** Name, address, call link, directions, share, cancel.
- **Customer edits:** Print settings editable while `awaiting_payment` via PATCH endpoint.

### Security

- **Token-as-credential:** 128-bit `customerToken` (32-char hex), `@@unique([shopId, customerToken])`.
- **Anti-enumeration:** Unknown + expired tokens return identical 404.
- **Constant-time compare:** `withOrderAccess` wrapper.
- **No PII in public tracking:** Customer phone/email not exposed; only order-safe fields.
- **Rate-limited:** 60 req/min per IP for tracking, 20 req/min for payment/cancel.

## What Was NOT Changed

The tracking system was already production-grade. No modifications were needed in this session. The tracking page, polling hooks, realtime integration, PDF receipt, and status timeline were all preserved as-is.

## Customer Experience

The customer can:
1. Open `/o/[token]` (from the confirmation screen, QR code, or order history).
2. See a live status timeline that updates via polling + realtime.
3. View their documents, price breakdown, and pickup code.
4. Submit a UTR or choose counter payment (if `awaiting_payment`).
5. Edit print settings (if `awaiting_payment`).
6. Cancel the order (before printing starts).
7. Download a PDF receipt.
8. Call the shop or get directions.

## Limitations

- **No estimated completion time** unless backed by actual queue data (`waitMinutes` from the nearby API). The tracking page does not fabricate ETAs.
- **No delivery tracking** — the platform is pickup-only (no delivery model in the schema).
- **No arbitrary progress percentages** — the timeline shows real backend states only.
