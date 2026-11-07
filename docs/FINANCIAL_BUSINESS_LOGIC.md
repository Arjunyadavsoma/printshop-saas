# PrintShop — Financial Business Logic

> The canonical financial rules that both the web SaaS and PrintEXE
> desktop client must follow. All financial calculations are
> server-authoritative. The desktop never independently computes
> financial results.

**Status:** v1.0 — 2025-11-07.

---

## 1. Core principle

**The server is the sole authority for financial calculations.**

The desktop client:
- Displays amounts fetched from the server
- Submits payment records via the API
- Never computes prices, taxes, discounts, or totals locally

The web client:
- Computes prices via the server-side pricing engine
- Verifies payment amounts via webhook signatures
- Persists all financial events as append-only audit records

---

## 2. Currency representation

- **All amounts are integer paise** (1 INR = 100 paise) in `Int` columns
- **No floating-point money** anywhere in business logic
- **Pricing engine** (`packages/core/src/pricing/`): pure functions, paise in → paise out, half-up rounding
- **Display:** `formatINRFromPaise(paise)` from `@platform/utils`
- **Database columns:** `totalAmountPaise`, `pricePaise`, `amountPaise`, `pamphletPricePaise`

The desktop must use an equivalent integer-paise representation. Never convert to float.

---

## 3. Pricing calculation

### 3.1 The pricing engine

Location: `packages/core/src/pricing/pricing-engine.ts`
Function: `priceFile(input: PricingInput): PricingResult`

```typescript
interface PricingInput {
  shopPricingConfig: ShopPricingConfig;
  paperSize: 'a4' | 'a3' | 'letter' | 'legal';
  colorMode: 'bw' | 'color';
  copies: number;
  duplex: boolean;
  pageCount: number;
  pageRange?: string;  // overrides pageCount if specified
}

interface PricingResult {
  pricePaise: number;
  breakdown: {
    perPagePaise: number;
    pagesCharged: number;
    subtotalPaise: number;
    duplexDiscountPaise: number;
    copiesMultiplier: number;
    totalPaise: number;
  };
}
```

### 3.2 ShopPricingConfig

Stored as JSON in `Shop.pricingConfig`:
```json
{
  "bwA4PerPage": 200,      // ₹2.00 per B&W A4 page
  "colorA4PerPage": 1000,  // ₹10.00 per color A4 page
  "bwA3PerPage": 400,
  "colorA3PerPage": 2000,
  "minOrderValue": 1000,   // ₹10.00 minimum
  "duplexDiscountPercent": 10  // 10% off for duplex
}
```

### 3.3 Calculation rules

1. **Page count:** `pageRange` (if specified) is parsed to count pages. Otherwise `pageCount` from PDF parsing.
2. **Per-page rate:** looked up by `paperSize` + `colorMode` from `ShopPricingConfig`
3. **Subtotal:** `perPagePaise × pagesCharged`
4. **Duplex discount:** `subtotal × duplexDiscountPercent / 100` (rounded half-up)
5. **Copies multiplier:** `(subtotal - duplexDiscount) × copies`
6. **Order total:** `sum of all file prices`
7. **Minimum order:** if total < `minOrderValue`, total is raised to `minOrderValue`

### 3.4 Desktop behavior

The desktop MUST NOT compute prices. When displaying an order, it fetches `GET /api/v1/shops/me/orders/{id}` which returns `totalAmountPaise` (already computed server-side). When a customer changes print settings, the web app calls `PATCH /api/v1/orders/{id}/files/{fileId}` which re-prices on the server.

---

## 4. Taxes

**Current state:** GST is NOT currently applied. PrintShop operates as a service platform; the shopkeeper handles their own tax compliance.

**Future:** if GST is added:
- GST rate stored in `Shop.gstRate` (e.g., 18 for 18%)
- Computed server-side: `taxPaise = subtotalPaise × gstRate / 100` (rounded half-up)
- Stored as `taxPaise Int` on the Order
- Invoice shows: subtotal, tax, total

**The desktop must never compute tax locally.** It displays the server-computed `taxPaise`.

---

## 5. Discounts

**Current state:** only duplex discount (built into the pricing engine). No manual discounts.

**Future:** if manual discounts are added:
- Discount stored as `discountPaise Int` on the Order (absolute amount, not percentage)
- Applied server-side after subtotal + tax
- Validated: `discountPaise <= subtotalPaise + taxPaise` (can't discount below zero)
- Audit-logged with the shopkeeper who applied it

---

## 6. Invoices (Phase 2 — not yet implemented)

### 6.1 Model (target)

```prisma
model Invoice {
  id              String   @id @default(uuid())
  shopId          String   // tenant FK
  orderId         String?  // optional link to Order
  customerName    String
  customerPhone   String?
  invoiceNumber   String   @unique // per-shop sequential
  issueDate       DateTime @default(now())
  dueDate         DateTime?
  subtotalPaise   Int
  taxPaise        Int      @default(0)
  discountPaise   Int      @default(0)
  totalPaise      Int      // subtotal + tax - discount
  paidPaise       Int      @default(0)  // sum of payments
  status          String   @default("draft") // draft|issued|paid|partial|overdue|cancelled
  notes           String?
  revision        Int      @default(1)
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([shopId, status])
  @@index([shopId, updatedAt])
}
```

### 6.2 Invoice totals

- `subtotalPaise` = sum of `InvoiceItem.pricePaise`
- `taxPaise` = `subtotalPaise × gstRate / 100` (server-computed)
- `totalPaise` = `subtotalPaise + taxPaise - discountPaise`
- `paidPaise` = sum of approved `Payment.amountPaise` for this invoice
- `outstandingPaise` = `totalPaise - paidPaise`
- `status` transitions: `draft → issued → partial → paid` (or `overdue` if past dueDate)

**All computed server-side.** The desktop displays the server's values.

---

## 7. Payments

### 7.1 Payment providers

| Provider | Integration | Verification |
|---|---|---|
| PhonePe v1 (Standard) | X-VERIFY + base64 | Server-side signature verification |
| PhonePe v2 (Business) | SHA auth + JSON | Server-side SHA-256 auth |
| Paytm | CHECKSUMHASH | Server-side AES-128-CBC + SHA-256 |
| UPI deep-link | `upi://pay?...` URI | Manual verify by shopkeeper (or webhook if PSP) |
| Cash | `Shop.cashOnPickup` | Manual verify by shopkeeper |

### 7.2 Payment verification flow

1. Customer pays via UPI app / PhonePe / Paytm
2. PSP sends webhook to `POST /api/v1/payments/{provider}/webhook`
3. Server verifies signature (real crypto)
4. Server validates amount: `webhookAmount === order.totalAmountPaise` (MANDATORY)
5. Server validates state: `order.status === 'awaiting_payment'`
6. Race-safe transition: `UPDATE Order SET status='paid' WHERE id=? AND status='awaiting_payment'`
7. Idempotency: `paymentTxnId UNIQUE` + cache dedup (`pay:done:{provider}:{txnId}`)
8. Audit log: `webhook.{provider}.paid`
9. Realtime: `order.paid` event
10. Auto-dispatch print jobs

### 7.3 Manual verification

If no webhook (UPI direct transfer), the shopkeeper manually verifies:
- `POST /api/v1/shops/me/orders/{id}/verify-payment` with `{action: 'verify', txnReference: '...'}`
- Generates deterministic `paymentTxnId = 'manual-{orderId}'`
- Same race-safe transition + audit log

### 7.4 Partial payments (Phase 2)

For invoices:
- `Payment.amountPaise` can be < `Invoice.totalPaise`
- `Invoice.paidPaise += paymentAmountPaise`
- `Invoice.status` → `partial` if `paidPaise < totalPaise`, → `paid` if `paidPaise >= totalPaise`
- Multiple payments allowed; each is a separate `Payment` record with its own `paymentTxnId`

**Server-authoritative.** The desktop submits payment records via `POST /api/v1/sync/push`; the server validates + commits.

---

## 8. Refunds (Phase 2)

- `Refund` model: `{id, shopId, orderId?, invoiceId?, amountPaise, reason, status, paymentTxnId}`
- Refund amount validated: `refundAmount <= originalPaymentAmount`
- `Order.status` → `refunded` (or `cancelled` + `refunded`)
- `Invoice.paidPaise -= refundAmount`
- Server-authoritative — the desktop never computes refund totals

---

## 9. Outstanding balances

- **Order-level:** `outstandingPaise = totalAmountPaise - (paidAmountPaise ?? 0)`
- **Invoice-level:** `outstandingPaise = totalPaise - paidPaise`
- **Customer-level (future):** sum of all outstanding invoice balances for that customer

All computed server-side. The desktop displays the fetched values.

---

## 10. Inventory deductions (Phase 2)

- `InventoryMovement` model: `{id, shopId, itemId, quantity, direction: 'in'|'out', reason, orderId?, timestamp}`
- When an order completes, the server deducts paper/toner from inventory
- `InventoryItem.quantityOnHand -= movement.quantity`
- Validated: `quantityOnHand >= 0` (can't go negative without override)
- Server-authoritative

---

## 11. Idempotency

| Operation | Idempotency mechanism |
|---|---|
| Payment webhook | `paymentTxnId UNIQUE` + cache `pay:done:{provider}:{txnId}` |
| Manual payment verify | Deterministic `paymentTxnId = 'manual-{orderId}'` |
| Print job claim | Partial unique index `PrintJob_active_file_unique` + conditional UPDATE |
| Sync push | `baseRevision` conflict check + `revision` increment |
| Order creation | `customerToken` + `tokenNumber` unique per shop |

**Duplicate prevention is structural (DB constraints), not application-level.**

---

## 12. Audit trail

Every financial event is logged in `AuditLog`:
- `auth.login`, `auth.register`
- `order.create`, `order.paid`, `order.cancelled`, `order.collected`
- `webhook.{provider}.paid`, `webhook.{provider}.failed`
- `payment.manual_verify`, `payment.reject`
- `agent.revoke`
- `sync.push` (future)

`AuditLog` is append-only (no `updatedAt`, no delete). Used for reconciliation + dispute resolution.

---

## 13. Desktop financial rules (summary)

1. **Never compute prices** — fetch from server
2. **Never compute totals** — fetch from server
3. **Never mark a payment as verified** — submit via sync push; server validates
4. **Never apply discounts** — submit via sync push; server validates
5. **Never compute outstanding balances** — fetch from server
6. **Display amounts using `formatINRFromPaise()` equivalent** — integer paise → ₹ string
7. **Cache financial data for display only** — never as authoritative
8. **On sync conflict, server wins** — the desktop must accept the server's version
