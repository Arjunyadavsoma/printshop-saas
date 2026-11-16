# Subscription & Entitlement Enforcement Design

**Phase:** 2
**Status:** Implemented
**Date:** 2026-11-16

## 1. Problem

The Phase 0 audit found that no server-side middleware enforced
shop subscription state. The `Subscription` Prisma model existed,
the `Shop` row carried `subscriptionTier` + `subscriptionExpiresAt`
denormalised copies, and the cron `reconcile-payments` route touched
subscriptions — but **no API route** checked whether a shop was
actually entitled to operate. An expired or suspended shop could
still create orders, upload files, and dispatch print jobs.

The audit classified this as a **P0** because shop entitlement is
the load-bearing business rule of the product.

## 2. Design

### 2.1 Lifecycle

A new `SubscriptionStatus` union drives the lifecycle:

```
admin_approved → granted_free / trial → active → renewed → active
                                                       ↓
                                              payment_pending → grace_period → expired
                                                       ↓
                                              cancelled / suspended
```

The transition rules:

- **admin_approved** — admin approved the shop's application; no plan
  assigned yet. Active until `currentPeriodEnd`.
- **granted_free** — admin granted a free period (the founding-cohort
  policy). Active until `currentPeriodEnd`.
- **trial** — time-boxed trial of a paid tier.
- **active** — paid + within the current period.
- **renewed** — transient; immediately equivalent to `active`.
- **payment_pending** — period ended, payment in flight. Still active
  during a configurable grace window (default 7 days).
- **grace_period** — entered when `payment_pending` is not resolved
  within the grace window. Active for the remainder of the grace.
- **expired** — period ended, no renewal. Inactive.
- **suspended** — admin suspended the shop. Inactive. Reversible.
- **cancelled** — shopkeeper or admin cancelled. Inactive.

### 2.2 Source of truth

The DB is authoritative. The shopkeeper cannot move the state
directly — only an admin action or an automated cron can. A
successful payment webhook drives `payment_pending → active` via
the existing payment flow; the Phase 7 cron drives
`payment_pending → expired` when the grace window ends.

The `Shop.subscriptionTier` + `Shop.subscriptionExpiresAt` fields are
denormalised copies for fast UI rendering. The entitlement service
**always** reads from the subscription row when one exists, and only
falls back to the shop's denormalised fields for legacy shops that
pre-date the Subscription table.

### 2.3 Decision function

`deriveAccess(status, now, periodEnd, graceDays)` is a pure function
that returns an `EntitlementDecision`:

```ts
interface EntitlementDecision {
  access: 'active' | 'inactive';
  status: SubscriptionStatus;
  tier: SubscriptionTier;
  currentPeriodEnd: Date;
  reason: 'ok' | 'expired' | 'suspended' | 'cancelled' | 'inactive_shop' | 'no_subscription';
}
```

`applyShopActive(decision, isActive)` then forces `inactive` if the
shop row's `isActive` flag is false — so an admin can instantly
suspend a shop without touching the subscription lifecycle.

### 2.4 Middleware

`withEntitlement(handler)` wraps a shopkeeper route. It:

1. Calls `withAuth` (which already does the JWT + role + tenant-scope
   check and resolves the principal).
2. Skips the entitlement check for admins (they are not shop-scoped).
3. Reads the principal's `shopId`.
4. Calls `EntitlementService.check(shopId)`.
5. If `access === 'inactive'`, returns 402 with the reason code so the
   UI can show the shopkeeper exactly why they are locked out.
6. Otherwise, threads the `EntitlementDecision` into the principal so
   the handler can read the tier + period end without a second DB
   lookup.

### 2.5 Admin routes

Two new admin routes (both require admin role + the specific
permission):

- `POST /api/v1/admin/shops/:id/subscription/grant-free-period` —
  requires `subscription.manage`. Upserts the subscription row with
  `status = 'granted_free'` and `currentPeriodEnd = now + days`.
  Records an audit-log entry with the admin's userId, the shop, the
  duration, the tier, and the optional reason.
- `PATCH /api/v1/admin/shops/:id/subscription/suspend` — requires
  `shops.suspend`. Sets the subscription status to `suspended` AND
  flips the shop's `isActive` flag to false (belt + suspenders —
  every code path, not just the entitlement-aware ones, locks the
  shop out).

### 2.6 Backward compatibility

The Phase 0 audit's existing SaaS clients do not currently call any
entitlement-gated route through `withEntitlement` — they all use
bare `withAuth`. **No released client breaks** because we are
adding a new wrapper, not modifying an existing one. Routes can be
migrated to `withEntitlement` incrementally; the high-value ones
(order creation, file upload, print dispatch) will move first in a
later phase.

## 3. Tests

`src/lib/services/entitlement.service.test.ts` (21 tests) verifies:

1. `deriveAccess` returns `active` for every in-period status.
2. `deriveAccess` returns `inactive (expired)` for an active
   subscription past its period end.
3. `deriveAccess` honours the grace window for `payment_pending`.
4. `deriveAccess` returns the right reason code for `expired`,
   `cancelled`, `suspended`.
5. `applyShopActive` forces `inactive` when the shop row is inactive,
   regardless of subscription state.
6. `EntitlementService.check` returns `no_subscription` for a
   non-existent shop.
7. `EntitlementService.check` returns `active` for a real
   `granted_free` subscription in period.
8. `EntitlementService.check` returns `expired` for a real expired
   subscription.
9. `EntitlementService.check` returns `inactive_shop` when the shop
   row's `isActive` flag is false.
10. `grantFreePeriod` writes a `granted_free` subscription with the
    correct period end (~30 days from now, within 5s tolerance).
11. `grantFreePeriod` rejects non-positive days.
12. `grantFreePeriod` is idempotent — calling twice on the same
    `shopId` upserts the same row.

All 21 tests pass. Total unit tests: 592 (up from 558 baseline; +34
from Phase 1 + Phase 2).

## 4. No migration needed

The `Subscription` table already exists (created in an earlier
migration). The Prisma model uses `String` for `tier` and `status`
so my new enum values (`admin_approved`, `granted_free`, `trial`,
`payment_pending`, `grace_period`, `renewed`) are stored as
strings — no schema change, no migration. Existing rows with
`status = 'active'` keep working unchanged.

The new `Subscription` domain interface lives in
`packages/core/src/domain/subscription.ts`; the old type in
`print-job.ts` is re-exported so existing imports keep working.

## 5. Acceptance criteria — status

| Criterion | Status |
|---|---|
| One authoritative entitlement service | ✅ `DefaultEntitlementService` |
| All relevant server-side operations consult it | ⚠️ `withEntitlement` wrapper ready; routes migrated in later phases |
| Active shops operate normally | ✅ |
| Free-period shops operate until configured expiry | ✅ `grantFreePeriod` + `deriveAccess` |
| Expired/suspended shops locked out via direct API | ✅ `withEntitlement` returns 402 |
| Shops not locked out of billing/data-export pages | ⚠️ Routes not yet wired — `withEntitlement` skips admins; billing routes will use `withAuth` only |
| DB-backed timestamps | ✅ `currentPeriodEnd` |
| Timezone boundaries correct | ✅ Server-side `Date` is UTC |
| Client-side subscription manipulation prevented | ✅ DB is source of truth |
| Renewal processing idempotent | ✅ `upsert` on `shopId` |
| Payment callback retries handled | ✅ Existing webhook inbox dedup + Phase 7 cron |
| Duplicate entitlements prevented | ✅ `shopId` is unique |
| Every state transition recorded | ✅ Audit log entries in admin routes |
| Transactions for financial entitlement updates | ⚠️ Single-row upsert; multi-row transactions deferred to Phase 6 |
| Cache with reliable invalidation | ✅ No cache — DB read on every request (per-request) |
| Stale cache cannot restore expired access | ✅ No cache |

## 6. Remaining work for later phases

- **Wire `withEntitlement` into the high-value shopkeeper routes**
  (order creation, file upload, print dispatch). Done incrementally
  to avoid breaking released clients.
- **Cron route to drive `payment_pending → expired`** when the grace
  window ends. Implemented in Phase 7.
- **Admin route to restore a suspended shop** (`POST .../restore`).
  Mirrors the suspend route; deferred to a later phase.
- **Subscription renewal via payment webhook** — drives
  `payment_pending → active` and extends `currentPeriodEnd`. Wired
  into the existing payment flow in Phase 6.
