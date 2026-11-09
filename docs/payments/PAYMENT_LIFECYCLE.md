# Payment Lifecycle: Atomic State Machine

**Branch:** `phase-5-3-payment-lifecycle-reconciliation`
**Date:** 2025-11-09
**Status:** Reference document — describes the Phase 5.3 atomic lifecycle service

---

## Purpose

This document describes the financial state machine owned by
`src/lib/payments/lifecycle.service.ts` — the SINGLE entry point for payment
state transitions in PrintShop SaaS.

Phase 5.2.1 had a correctness gap: the webhook pipeline performed the
`PaymentEvent` INSERT, the `Order` UPDATE, and the `PaymentEvent` UPDATE as
**three separate, non-transactional operations**. If the order transition
succeeded but the `PaymentEvent.update` failed (network blip, deadlock, cold
start), the system was left in an inconsistent state:

- The order was `paid` (money was taken)
- The `PaymentAttempt` was stuck in `created`
- The `PaymentEvent` was stuck in `received` (no `processedAt`)

Phase 5.3 closes that gap by wrapping all three updates in a single
`db.$transaction()` with **Serializable isolation**. Either the entire
financial transition commits, or none of it does.

---

## State machine

### PaymentAttempt.status

The `PaymentAttempt` model (Prisma `schema.prisma`) tracks a single checkout
attempt. Its `status` field is one of:

| Status     | Meaning                                                            | Terminal? |
|------------|-------------------------------------------------------------------|-----------|
| `created`  | The attempt was created at checkout; no provider confirmation yet | No        |
| `pending`  | The provider acknowledged the request but hasn't confirmed paid   | No        |
| `paid`     | The provider confirmed a successful payment                       | **Yes**   |
| `failed`   | The provider confirmed failure (or the customer cancelled)        | **Yes***  |
| `expired`  | Reconciliation found no payment after the TTL elapsed             | **Yes**   |

> *`failed` is terminal for THAT attempt. A retry produces a NEW
> `PaymentAttempt` row with a fresh `merchantOrderId`, which can independently
> reach `paid`.

#### Valid PaymentAttempt transitions

```
        ┌─────────────────────────────────────────────┐
        │                                             │
        ▼                                             │
   ┌─────────┐   paid     ┌──────┐                    │
   │ created │ ─────────▶ │ paid │   (terminal)       │
   └─────────┘            └──────┘                    │
        │                                              │
        │   failed                                    │
        ├──────────▶ ┌────────┐                       │
        │            │ failed │   (terminal — retry   │
        │            └────────┘    via NEW attempt)   │
        │                                              │
        │   expired (reconciliation TTL)              │
        └──────────▶ ┌─────────┐                      │
                     │ expired │   (terminal)         │
                     └─────────┘                      │
```

`pending` is also a valid source state for the `paid` / `failed` transitions
(reconciliation or status-check driven). `paid`, `failed`, and `expired` are
**terminal** — no further transitions are permitted.

### PaymentEvent.processingStatus

Every inbound webhook, status-check, and reconciliation cycle produces a
`PaymentEvent` row. Its `processingStatus` field is one of:

| Status      | Meaning                                                              |
|-------------|---------------------------------------------------------------------|
| `received`  | The event was inserted (initial state)                              |
| `processed` | The lifecycle transaction committed successfully                     |
| `skipped`   | The event was a duplicate, stale, mismatched, or had no attempt     |
| `failed`    | The lifecycle transaction threw (DB error, deadlock, etc.)          |

#### Valid PaymentEvent transitions

```
   ┌──────────┐  success     ┌───────────┐
   │ received │ ───────────▶ │ processed │
   └──────────┘              └───────────┘
        │
        │  duplicate / stale / mismatch
        ├──────────────────────────────▶ ┌─────────┐
        │                                │ skipped │
        │                                └─────────┘
        │  error / DB failure
        └──────────────────────────────▶ ┌────────┐
                                         │ failed │
                                         └────────┘
```

The `PaymentEvent.processingStatus` is updated **inside the same transaction**
as the `PaymentAttempt` transition (see "Transaction boundaries" below), so the
event's status always reflects the actual outcome of the lifecycle operation.

---

## Transaction boundaries

The `applyPaymentTransition` function in `lifecycle.service.ts` wraps **four
operations in a single `db.$transaction()` with Serializable isolation**:

```
db.$transaction(async (tx) => {
  // STEP 1 — INSERT PaymentEvent (dedup via UNIQUE([provider, eventId]))
  // STEP 2 — SELECT PaymentAttempt by merchantOrderId
  // STEP 3 — Validate amount + currency + tenant
  // STEP 4 — Conditional UPDATE PaymentAttempt: status IN ('created','pending') → 'paid'/'failed'
  // STEP 5 — Conditional UPDATE Order: status='awaiting_payment' → 'paid'  (only if paid=true)
  // STEP 6 — UPDATE PaymentEvent: processingStatus='received' → 'processed'
}, { timeout: 10_000, isolationLevel: 'Serializable' })
```

**If ANY step fails, the entire transaction rolls back.** No partial
financial transition is ever committed. Specifically:

- A unique-constraint violation on STEP 1 (duplicate event delivery) is caught
  and returns an idempotent response (see "Idempotency" below) — it does NOT
  roll back the transaction; the read of the existing event + attempt + order
  state lets the caller know the previous outcome.
- Any other error in STEP 1 (real DB failure) throws and rolls back.
- A missing `PaymentAttempt` (STEP 2) marks the event as `skipped` inside the
  transaction and returns — the event is persisted for forensic review but
  no financial transition is attempted.
- A tenant mismatch, amount mismatch, or currency mismatch (STEP 3) marks the
  event as `skipped` and returns.
- The conditional UPDATEs in STEP 4 and STEP 5 use `updateMany` with `WHERE`
  clauses that gate on the current state. If the precondition doesn't match
  (e.g., the attempt is already terminal), the UPDATE matches 0 rows and the
  event is marked `skipped` (the stale-event guard).
- A failure in STEP 6 (final PaymentEvent update) rolls back the entire
  transaction — including the PaymentAttempt and Order updates from STEPs 4
  and 5. This is the key correctness property: the financial state and the
  event bookkeeping stay consistent.

**Isolation level:** `Serializable` is the strongest isolation level available
in PostgreSQL. It prevents phantom reads and guarantees that two concurrent
transactions touching the same rows cannot both commit — one will be aborted
with a serialization failure and the caller can retry.

**Timeout:** 10 seconds. Matches the per-provider API timeout — a hung DB
connection cannot stall the webhook pipeline indefinitely.

---

## Idempotency guarantees

The lifecycle service is **idempotent** at three layers:

### 1. PaymentEvent UNIQUE([provider, eventId])

The `PaymentEvent` model has a partial unique constraint:

```prisma
@@unique([provider, eventId])
```

`eventId` is the provider's transaction ID (with a fallback to
`merchantOrderId` if the provider hasn't issued a txn ID yet). If a provider
retries a webhook delivery (or two overlapping cron ticks both see the same
stale attempt), the second `INSERT` throws a unique-constraint violation
(PostgreSQL error code `23505`). The lifecycle service catches that specific
error, reads the existing event + attempt + order state, and returns an
idempotent response:

```ts
if (isUniqueConstraintError(e)) {
  const existing = await tx.paymentEvent.findFirst({ where: { provider, eventId } });
  const attempt = await tx.paymentAttempt.findUnique({ where: { merchantOrderId } });
  const order = await tx.order.findUnique({ where: { id: orderId } });
  return { applied: false, idempotent: true, attemptStatus: ..., orderStatus: ..., reason: 'duplicate event' };
}
```

### 2. PaymentAttempt conditional UPDATE (WHERE status IN ('created', 'pending'))

Even if the PaymentEvent dedup misses (e.g., the second event has a *different*
`eventId` because the provider assigned a new txn ID on retry), the
`PaymentAttempt` conditional UPDATE catches the race:

```ts
const attemptUpdated = await tx.paymentAttempt.updateMany({
  where: {
    id: attempt.id,
    shopId: input.shopId,
    status: { in: ['created', 'pending'] },  // ← only if NOT already terminal
  },
  data: { status: newAttemptStatus, providerTransactionId: ... },
});

if (attemptUpdated.count === 0) {
  // The attempt is already in a terminal state — stale event, skip.
  await tx.paymentEvent.update({ where: { id: eventRecord.id }, data: { processingStatus: 'skipped', ... } });
  return { applied: false, idempotent: true, reason: 'attempt already in terminal status' };
}
```

This catches **concurrent processing** (two webhook deliveries racing for the
same order) AND **stale events** (a late-arriving webhook for an attempt that
was already transitioned by the reconciliation cron).

### 3. Order conditional UPDATE (WHERE status='awaiting_payment')

The Order transition is similarly gated:

```ts
const orderUpdated = await tx.order.updateMany({
  where: {
    id: input.orderId,
    shopId: input.shopId,
    status: 'awaiting_payment',  // ← only if NOT already paid/printing/etc.
  },
  data: { status: 'paid', paidAt: new Date(), paymentTxnId: ..., paymentUtr: ..., paymentProvider: ... },
});
```

This catches the race between a webhook and a **manual shopkeeper verify**
(`POST /api/v1/shops/me/orders/:id/verify-payment`). If the shopkeeper
already verified the payment manually, the webhook's conditional UPDATE
matches 0 rows — the PaymentAttempt transition (STEP 4) still commits, so
the financial state stays consistent, but the Order is not double-transitioned
and no duplicate audit-log entry is written.

### 4. Stale events (terminal-state guard)

If an event arrives *after* the `PaymentAttempt` is in a terminal state
(`paid`, `failed`, or `expired`), the conditional UPDATE in STEP 4 matches
0 rows. The lifecycle service marks the event as `skipped` with
`errorMessage: 'attempt already in terminal status ...'` and returns an
idempotent response. A stale `paid` event arriving after a `failed` event
is therefore **rejected** — the newer failure is not overwritten by a
stale success (or vice versa).

---

## Code paths

`applyPaymentTransition` is the SINGLE entry point for financial state
transitions. The following files call it:

| File | Function | Trigger |
|------|----------|---------|
| `src/lib/payments/webhook.service.ts` | `processWebhook` | PhonePe v1 / Paytm inbound webhook (signed payload) |
| `src/lib/payments/phonepe-v2-webhook.ts` | `processPaymentCompleted` | PhonePe v2 Business API `pg.order.completed` event |
| `src/app/api/v1/cron/reconcile-payments/route.ts` | `GET` handler | Vercel Cron every 10 minutes (see `PAYMENT_RECONCILIATION.md`) |

All three paths construct a `PaymentTransitionInput` with the same shape:

```ts
{
  merchantOrderId,    // the per-attempt UUID (PaymentAttempt.merchantOrderId)
  provider,           // 'phonepe' | 'paytm' | ...
  providerTxnId,      // the PSP's transaction ID (for dedup + persistence)
  providerUtr,        // the bank-side UTR/RRN
  amountPaise,        // in paise — MUST match PaymentAttempt.amountPaise
  currency,           // 'INR'
  paid,               // true → paid; false → failed
  eventId,            // dedup key (providerTxnId ?? merchantOrderId)
  source,             // 'webhook' | 'status_check' | 'reconciliation' | 'manual'
  shopId,             // tenant guard
  orderId,            // for the Order transition
}
```

The `verify-payment` manual route (`src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts`)
does **NOT** call `applyPaymentTransition` — it uses a separate
`repos.orders.transitionStatus` conditional update because manual verification
is not a provider event and doesn't create a `PaymentEvent` row. The Order
conditional UPDATE inside `applyPaymentTransition` (with
`WHERE status='awaiting_payment'`) is what makes the two paths race-safe.

---

## Reconciliation support functions

In addition to `applyPaymentTransition`, the lifecycle service exports two
reconciliation helpers:

### `findStalePaymentAttempts(staleAfterMs, limit)`

Returns a bounded batch (max `limit`, hard-capped at 50) of `PaymentAttempt`
rows where:
- `status = 'created'` (never transitioned)
- `createdAt < NOW() - staleAfterMs` (the payment window has elapsed)

Ordered by `createdAt ASC` (oldest first — most urgent to reconcile). Used by
the reconciliation cron route to find candidates for status polling.

### `expirePaymentAttempt(attemptId, reason)`

Marks a `PaymentAttempt` as `expired` via a conditional `updateMany` with
`WHERE status='created'`. This is a **separate operation** from
`applyPaymentTransition` because expiry is NOT a financial transition — it's
a cleanup operation. It doesn't touch the Order (the order stays in
`awaiting_payment`, allowing the customer to retry checkout via a new attempt).

> Note: the reconciliation cron does **NOT** automatically call
> `expirePaymentAttempt`. Old attempts are left for manual review (see
> `PAYMENT_RECONCILIATION.md` limitations). The function is exported for
> future use + operational scripts.

---

## See also

- `docs/payments/PAYTM_CHECKSUM_COMPATIBILITY.md` — official Paytm checksum
  algorithm reference + Phase 5.3 fix details.
- `docs/payments/PAYMENT_RECONCILIATION.md` — reconciliation cron scheduling,
  authentication, batch limits, and failure handling.
- `docs/payments/WEBHOOK_LIFECYCLE_AND_RECONCILIATION.md` — provider webhook
  retry behavior + defensive measures (Phase 5.2.1 reference).
- `docs/payments/PAYMENT_STATE_MACHINE.md` — Order status state machine.
- `prisma/schema.prisma` — `PaymentAttempt` and `PaymentEvent` model
  definitions (lines 197–238).
- `src/lib/payments/lifecycle.service.ts` — the implementation.
- `src/lib/payments/lifecycle.service.test.ts` — behavioral tests for the
  atomic transition + idempotency + stale-event guards.
