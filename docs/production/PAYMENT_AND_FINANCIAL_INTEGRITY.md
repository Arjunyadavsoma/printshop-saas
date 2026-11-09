# Payment & Financial Integrity

**Status:** Production reference for the payment pipeline, idempotency layers,
and the financial reporting invariants the system must not violate.
**Source of truth:** `src/lib/payments/webhook.service.ts`,
`src/lib/payments/registry.ts`, `src/lib/payments/phonepe-v2-webhook.ts`,
`src/app/api/v1/orders/[id]/checkout/route.ts`,
`packages/adapters/src/payment/*`, `prisma/schema.prisma`
(`Order.paymentTxnId @unique`, `PaymentAttempt`, `PaymentEvent`).

---

## 1. Supported Providers

The `PaymentAdapterRegistry` (`src/lib/payments/registry.ts`) wires three
concrete adapters. Routing is per-shop based on `Shop.paymentProvider`
(the string column written by the shopkeeper's payment-credentials
flow); the checkout handler calls `container.paymentRegistry.get(shop.paymentProvider)`.

| Provider                    | Adapter (in `packages/adapters/src/payment/`)        | Auth scheme                                                                                                       | Webhook path                                          |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **PhonePe v1** (Standard)   | `PhonePePaymentAdapter` (v1 branch via UPIPay SDK)    | `merchantId + saltKey + saltIndex`; callback verified by `X-VERIFY` header = `sha256(base64body + saltKey)###saltIndex` (UPIPay `verifyWebhook`) | `POST /api/v1/payments/phonepe/webhook`               |
| **PhonePe v2** (Business)   | `PhonePePaymentAdapter` (v2 branch, OAuth2)           | `clientId + clientSecret + clientVersion`; OAuth2 Bearer token from `/oauth/v1/token` (cached ~10 min per `clientId`); API calls to `/pg/v2/pay`, `/pg/v2/status`, `/pg/v2/refund` | Dedicated v2 handler in `src/lib/payments/phonepe-v2-webhook.ts` (SHA-256 `Authorization: sha256(username:password)` hex) |
| **Paytm**                   | `PaytmPaymentAdapter`                                 | `merchantId + merchantKey + website`; callback verified by `CHECKSUMHASH` = `AES-128-CBC(sha256(params\|merchantKey), IV='0123456789012345')` (hand-rolled, constant-time compare) | `POST /api/v1/payments/paytm/callback` (returns an HTML page, not JSON) |
| **UPI deep-link** (fallback)| `UpiDeepLinkPaymentAdapter` (`provider='googlepay'`)  | No server-side auth — generates a `upi://pay?...` URI; status is confirmed by polling the PSP status API or manual UTR entry | none (no webhook; `handleWebhook` returns `404`)      |

PhonePe auto-detects v1 vs v2 by credential shape: `clientId` present → v2,
else v1. The webhook signature format is identical for v1 and v2
(`X-VERIFY`), so the v1 UPIPay `verifyWebhook` path is used for both when a
`saltKey` is available; the v2-only path falls back to decoding the base64
body and trusting HTTPS transport + a follow-up `/pg/v2/status` call as
defense-in-depth (see `phonepe.adapter.ts` lines 245–301).

---

## 2. End-to-End Payment Flow

```
customer → POST /api/v1/orders/[id]/checkout
            │  (withOrderAccess — must hold the order's customerToken)
            │  (rate-limited: 20 / 60 s)
            ▼
    adapter.createPaymentIntent({ orderId, amountPaise, shopUpiId, shopCredentials })
            │  → merchantOrderId = crypto.randomUUID()   (per attempt)
            │  → checkoutUrl (PhonePe/Paytm) or upi://... (UPI deep-link)
            │  → if adapter fails → fallback upi:// URI from shop.upiId
            ▼
    rememberPaymentSession(merchantOrderId, { orderId, shopId, amountPaise, provider })
            │  → cache:    pay:moid:{merchantOrderId}   TTL=600 s (10 min)
            │  → DB:       PaymentAttempt row (durable, survives cold start)
            ▼
    returns { checkoutUrl, upiUri, qrPayload, expiresAt }   (customer pays)
```

The webhook pipeline (`processWebhook` in
`src/lib/payments/webhook.service.ts`) then runs **eight ordered steps**:

1. **Audit-log the raw payload BEFORE any processing.** Action
   `webhook.{provider}.received`, `entityId='pending'` — every inbound
   webhook is recorded regardless of outcome.
2. **Extract the merchantOrderId without trusting it.** Provider-specific
   `extractReference()` parses the (still-unverified) payload just enough
   to look up the session — never to decide payment state.
3. **Look up the session** (cache → PaymentAttempt DB fallback — §4).
   Missing session → `404`, no further processing.
4. **Load the shop + its encrypted `paymentCredentials`.** Tenant mismatch
   between session.shopId and order.shopId → `403`.
5. **Verify the signature via the adapter.** This is real crypto
   (HMAC-SHA256 / AES-CBC / OAuth2 token), not a header presence check.
   Failed verification → return the adapter's status code; do nothing else.
6. **Idempotency check (cache).** `pay:done:{provider}:{txnId}` — if
   present, return `200 idempotent` without touching the DB.
7. **Validate the amount + state transition.**
   - `amountPaise === null` → reject (Phase 4 fix: was previously
     skipped, allowing a ₹0 webhook to mark a ₹500 order paid).
   - `amountPaise !== order.totalAmountPaise` → reject with the
     expected/got values logged.
   - `!canTransitionOrder(order.status, 'paid')` → idempotent skip.
8. **Flip the order to `paid`, race-safe.** `repos.orders.transitionStatus`
   runs `UPDATE ... WHERE id=? AND shopId=? AND status='awaiting_payment'`.
   Zero rows matched → a concurrent request already won — return
   idempotent. UNIQUE-constraint violation on `paymentTxnId` (P2002) →
   idempotent. Anything else → re-throw.

After step 8: cache the processed key for 24 h, write
`webhook.{provider}.paid` audit log, publish `order.paid` on the shop's
realtime channel (best-effort), and enqueue print jobs for every pending
file on the order via `enqueuePaidOrderPrint` (which itself calls the
shared `enqueueFilePrint` helper with its own two-layer idempotency guard).

---

## 3. Idempotency Layers

Three layers, in order of cost. Each is necessary; none is sufficient alone.

| Layer | Mechanism | TTL / scope | What it catches |
| ----- | --------- | ----------- | --------------- |
| **1. Cache** | `pay:done:{provider}:{txnId}` set after a successful transition | 24 h, in `CACHE_PROVIDER` (memory on Vercel — per-invocation; Upstash Redis if configured) | Fast-path dedup of the same webhook arriving twice within seconds (PSP retry storms) |
| **2. DB UNIQUE** | `Order.paymentTxnId @unique` (`schema.prisma` line 83) + `transitionStatus` precondition `WHERE status='awaiting_payment'` | Permanent (until order row deleted) | Concurrent webhook + manual verify / duplicate webhook with same txnId; the authoritative guard |
| **3. PaymentAttempt DB** | `PaymentAttempt.merchantOrderId @unique` row written at checkout | Permanent (expiresAt = checkout + 10 min, but row persists) | Cache miss after Vercel cold start; delayed webhook arriving >10 min after checkout when the cache TTL has elapsed |

`lookupPaymentSession()` always tries the cache first, then on miss
falls back to `db.paymentAttempt.findUnique({ where: { merchantOrderId } })`
and re-populates the cache. The DB row is the durable source of truth —
without it, a webhook arriving 11 minutes after checkout (when the
cache entry has expired and the function instance that handled checkout
has been torn down) would return `404 session expired` and the order
would sit in `awaiting_payment` forever.

---

## 4. PaymentAttempt & PaymentEvent Models

Both models exist in `prisma/schema.prisma` (lines 197–238) and the
production database (migration `20261015172034_init` + the Phase-4
durable-webhook work referenced in the schema comments).

**`PaymentAttempt`** — one row per checkout attempt:

| Field                     | Type / default                       | Notes |
| ------------------------- | ------------------------------------ | ----- |
| `id`                      | UUID PK                               |       |
| `shopId`, `orderId`       | FKs to Shop, Order                    | tenant-scoped |
| `provider`                | `'phonepe' \| 'paytm' \| 'googlepay'` | matches `Shop.paymentProvider` |
| `merchantOrderId`         | `@unique`                             | the per-attempt UUID; PSP references this; the webhook resolves the order via this column |
| `providerTransactionId`   | nullable                              | PSP's txn id, set on webhook/status (also indexed) |
| `amountPaise`             | Int                                   | copied from `order.totalAmountPaise` at checkout time — used by the amount-integrity check |
| `status`                  | `'created' \| 'pending' \| 'paid' \| 'failed' \| 'expired'` (default `created`) | |
| `idempotencyKey`          | nullable                              | optional PSP idempotency token |
| `expiresAt`               | DateTime                              | checkout + 10 min |

**`PaymentEvent`** — append-only event log per attempt. One row per
webhook / status-check / reconciliation callback. Enforces
`@@unique([provider, eventId])` so a PSP replaying the same event id is
a no-op. Tracks `signatureValid` (bool), `processingStatus`
(`received \| processed \| skipped \| failed`), `errorMessage`. This is
the audit trail required to reconstruct what happened for any disputed
payment.

> The `PaymentAttempt` table is consulted on every webhook via the
> `lookupPaymentSession` fallback path. It is not optional — the
> production deployment must run `prisma migrate deploy` so the table
> exists. The `try/catch` around the DB lookup is graceful degradation
> for the legacy "table not yet migrated" state, not a license to
> operate without it.

---

## 5. Financial Integrity Invariants

These are properties the codebase is structured to preserve. Any change
to payment or reporting code must keep them true.

1. **Never trust client-side payment success.** The customer's browser
   saying "I paid" via a redirect URL or postMessage is *not* payment
   confirmation. Only a verified webhook (signature-valid, amount-matched,
   `transitionStatus` succeeded) or the shopkeeper's manual
   `verify-payment` route (which itself calls `adapter.verifyPayment` —
   the PSP status API) can move an order out of `awaiting_payment`.
2. **Webhook ≠ bank settlement.** A `paid` order means the PSP accepted
   the transaction; it does NOT mean the merchant's bank account has
   been credited. Settlement happens on the PSP's own T+1 / T+2 schedule
   and is *not* tracked by this system. The daily report
   (`/api/v1/shops/me/reports/daily`) reports **verified collections**
   (orders with `paidAt + paymentTxnId`), not settled cash.
3. **Shop transaction volume ≠ platform subscription revenue.** The
   revenue numbers in `/api/v1/shops/me/analytics` and
   `/api/v1/shops/me/reports/daily` are *the shop's own* order totals
   (what customers paid the shopkeeper for printing). Platform revenue
   is `Shop.subscriptionTier` × billing price, tracked separately (today:
   not tracked at all — there is no billing provider wired in). Never
   sum shop transaction volumes and present the result as platform MRR.
4. **Amount integrity is enforced server-side.** The expected amount is
   read from `order.totalAmountPaise` (set at order creation, before
   checkout). The webhook's `amountPaise` must be present AND equal — a
   missing or mismatched amount is a hard reject (Phase 4 fix; see
   `webhook.service.ts` lines 217–236).
5. **`paymentTxnId` is immutable once set.** It has a UNIQUE constraint;
   the race-safe `transitionStatus` only writes it when flipping from
   `awaiting_payment → paid`. A second webhook for the same txn is a
   P2002 → idempotent skip, not an overwrite.
6. **UTR ≠ txnId.** `paymentTxnId` is the PSP's transaction id
   (authoritative for dedup). `paymentUtr` is the bank UTR (for the
   shopkeeper's reconciliation against their bank statement). Both are
   stored on the Order; only `paymentTxnId` is unique-constrained.

---

## 6. Failure Modes & What Happens

| Scenario | System behavior |
| -------- | --------------- |
| PSP webhook arrives but signature invalid | Step 5 fails → return adapter's status (typically `401`); order stays in `awaiting_payment`; `webhook.{provider}.received` audit row written but no `paid` row. |
| Webhook arrives but amount missing / wrong | Step 7 rejects with `400`; order stays in `awaiting_payment`; logged as `amount missing` / `amount mismatch`. |
| Duplicate webhook (same `txnId`) within 24 h | Step 6 cache hit → `200 idempotent`, no DB write. |
| Duplicate webhook after cache TTL elapsed | Cache miss → step 7 `canTransitionOrder` returns false (order already `paid`) → `200 idempotent`. If a *new* txnId arrives for an already-paid order, the `transitionStatus` precondition fails → idempotent. |
| Webhook arrives >10 min after checkout, cold function | Cache `pay:moid:` missed → `PaymentAttempt` DB lookup hits → session restored → webhook processed normally. |
| Concurrent webhook + manual verify-payment | Both call `transitionStatus` with `WHERE status='awaiting_payment'`; exactly one wins (returns the updated row); the other gets `null` → idempotent skip. UNIQUE on `paymentTxnId` is the second guard. |
| PSP returns a `failed` / non-success state | `v.paid === false` → audit `webhook.{provider}.failed`, return `200`, order stays `awaiting_payment` (allows retry). |
| Adapter `createPaymentIntent` throws | Checkout handler catches via `fail(toAppError(cause))`; checkout URL is `null` and the fallback UPI deep-link URI is generated from `shop.upiId` so the customer can always pay. |
| Unknown `paymentProvider` on the shop | `paymentRegistry.get(provider)` throws `AdapterError`; checkout returns the error envelope. |

---

## 7. Operational Notes

- **Webhooks must be authenticated at the HTTP layer too.** PSP callbacks
  arrive over public internet; the adapter's signature check is the
  application-level guard. The PhonePe v2 handler additionally validates
  a SHA-256 `Authorization` header against `PHONEPE_WEBHOOK_USERNAME` /
  `PHONEPE_WEBHOOK_PASSWORD` env vars (constant-time compare via
  `timingSafeEqual`).
- **The dev simulate routes (`/api/v1/payments/dev/phonepe/simulate`,
  `/api/v1/payments/dev/paytm/simulate`) sign test callbacks with the
  shop's real credentials and are gated behind `require-dev`.** They must
  never be reachable in production — confirm `NODE_ENV=production` and
  that `require-dev` throws outside dev/staging.
- **Manual verify-payment route**
  (`POST /api/v1/shops/me/orders/[id]/verify-payment`) is the
  shopkeeper-initiated fallback when a webhook is lost. It calls
  `adapter.verifyPayment()` (the PSP status API) — never marks paid
  based on a customer-submitted UTR alone. The UTR is stored as
  `paymentUtr` for reconciliation but `paymentTxnId` must come from the
  PSP.
- **Refunds** (`adapter.refund`) are server-initiated, not
  webhook-triggered. They generate a fresh `refund-{uuid}` merchant id
  and call the PSP's refund endpoint. A refund webhook
  (`pg.refund.completed` for PhonePe v2) is logged but never marks an
  order paid — the order stays in its current state.

---

## 8. Adding a New Payment Provider

1. Implement `PaymentAdapter` in a new file under
   `packages/adapters/src/payment/`.
2. Register it in `PaymentAdapterRegistry`'s constructor
   (`src/lib/payments/registry.ts`) and add the string to the
   `PaymentProvider` union in `@platform/core/domain`.
3. If the provider has a webhook, add a route under
   `src/app/api/v1/payments/{provider}/...` that calls
   `processWebhook({ provider, rawBody, headers, path, ip })`. **Do not**
   put provider-specific payment logic in the route — it belongs in the
   adapter's `handleWebhook` + the shared `processWebhook` pipeline.
4. Add a case to `extractReference()` in `webhook.service.ts` if the
   payload format differs.
5. Test the three idempotency layers explicitly: cache hit, UNIQUE hit,
   PaymentAttempt-fallback hit; plus amount mismatch and signature
   failure rejections.
