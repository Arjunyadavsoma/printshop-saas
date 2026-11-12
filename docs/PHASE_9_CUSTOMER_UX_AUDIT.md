# Phase 9 — Customer UX Audit

## Existing customer journey

### Routes
- `/` — Homepage with shop discovery (448 lines)
- `/shops/[slug]` — Shop detail + order creation (398 lines)
- `/orders/[id]` — Complete 5-step ordering flow (1682 lines)

### Order page steps (`src/app/orders/[id]/page.tsx`)
1. **Upload** — Drag-drop + file picker, progress, cancel, retry
2. **Configure** — Print settings (color, duplex, paper, copies, page range)
3. **Checkout** — Order summary with server-authoritative pricing
4. **Pay** — UPI QR / deep-link / checkout URL
5. **Track** — Order status + payment status indicators

### Design issues found
- 39 arbitrary `text-[10px]` / `text-[11px]` usages in order page
- Step indicator uses `text-[10px]` (below 12px minimum)
- No `PageHeader` component used (inline headings)
- No `EmptyState` component used for upload step
- No `LoadingSkeleton` used for initial page load
- No `StatusIndicator` used for file/upload status

### Critical business logic (must NOT change)
- Server-authoritative pricing via PATCH `/files/[fileId]`
- Checkout uses `order.totalAmountPaise` (never client-supplied)
- Payment idempotency via stable `checkout-${order.id}` key
- File signature validation (F-08 from Phase 7.1)
- Upload cancellation via XHR abort
- PDF preview with page selection + zoom
- WebhookInbox for unmatched events
- Order access via `customerToken` header

### Raw palette in order page
- 0 raw palette usages (already using semantic tokens)

### Arbitrary small fonts in order page
- 39 usages of `text-[10px]` or `text-[11px]`
- All should be migrated to `text-xs` (12px) minimum
