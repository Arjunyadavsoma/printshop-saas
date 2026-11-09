# Subscription & Entitlement Matrix

**Status:** Production reference — single source of truth for which features require
which plan, which routes enforce entitlement, and what happens when the
entitlement service cannot reach the database.
**Source of truth:** `src/lib/api/entitlements.ts`, `prisma/schema.prisma`
(`Shop.subscriptionTier`, `Shop.subscriptionExpiresAt`, `AuditLog`).

---

## 1. Plan Definitions

Plans are stored as the string column `Shop.subscriptionTier` (default
`'free'`) plus the nullable `Shop.subscriptionExpiresAt`. There is no
separate billing table; tiers are written by the admin tooling in
`/api/v1/admin/shops/[id]` and surfaced read-only to the shopkeeper via
`GET /api/v1/shops/me`.

The full feature-to-plan matrix is hard-coded in `PLAN_FEATURES`:

```ts
// src/lib/api/entitlements.ts
const PLAN_FEATURES: Record<string, Feature[]> = {
  free:       [],
  starter:    ['analytics', 'reports'],
  pro:        ['analytics', 'reports', 'multi_device', 'delivery_tracking'],
  enterprise: ['analytics', 'reports', 'multi_device', 'delivery_tracking', 'advanced_pricing'],
};
```

| Plan         | Features unlocked                                                                  |
| ------------ | ---------------------------------------------------------------------------------- |
| `free`       | (none) — every paid feature gated                                                  |
| `starter`    | `analytics`, `reports`                                                             |
| `pro`        | `analytics`, `reports`, `multi_device`, `delivery_tracking`                        |
| `enterprise` | all five: `analytics`, `reports`, `multi_device`, `delivery_tracking`, `advanced_pricing` |

Feature union (type `Feature`): `'analytics' | 'reports' | 'multi_device' |
'delivery_tracking' | 'advanced_pricing'`.

> **Free features are always available regardless of plan:** ordering, file
> upload, printing, payment checkout, daily reconciliation for the shopkeeper's
> own orders, basic shop profile management (`GET/PATCH /api/v1/shops/me`).
> No `requireEntitlement()` call is made on those routes.

---

## 2. Feature-to-Route Mapping

| Feature              | Enforced today? | Route(s) that *should* be gated                                                                                          | Code calling `requireEntitlement`                                  |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `analytics`          | **Yes**         | `GET /api/v1/shops/me/analytics`                                                                                         | `src/app/api/v1/shops/me/analytics/route.ts` (line 13)             |
| `reports`            | **Yes**         | `GET /api/v1/shops/me/reports/daily`                                                                                     | `src/app/api/v1/shops/me/reports/daily/route.ts` (line 30)         |
| `multi_device`       | **No (gap)**    | `POST /api/v1/devices/register`, `POST /api/v1/agents/register`, `/api/v1/shops/me/agents` (listing >1 agent/device)    | (none — entitlement check not yet wired into device/agent routes)  |
| `delivery_tracking`  | **No (gap)**    | `PrintDeliveryAttempt` write paths, `/api/v1/shops/me/orders/[id]/activity`, `markDeliveryReceived`                      | (none — `src/lib/services/delivery-coordinator.ts` does not call it) |
| `advanced_pricing`   | **No (gap)**    | `PATCH /api/v1/shops/me` with `pricingConfig` beyond base schema, future per-paper / per-color rules                     | (none — pricing engine in `packages/core/src/pricing/` is open)    |

The two enforced features use the same idiom — a dynamic import inside the
handler keeps the entitlements module off the cold-start critical path for
the routes that don't need it:

```ts
const { requireEntitlement } = await import('@/lib/api/entitlements');
await requireEntitlement(shop.id, 'analytics');
```

`GET /api/v1/shops/me` is intentionally ungated so the shopkeeper dashboard
can always show the **current subscription state** (tier, effectiveTier,
state, `daysUntilExpiry`, `inGracePeriod`, `features[]`). It calls
`getSubscriptionStatus()` (read-only) instead of `requireEntitlement()`.

---

## 3. Subscription States & Lifecycle

`SubscriptionState = 'active' | 'grace' | 'expired' | 'suspended' | 'canceled'`.

`resolveState(tier, expiresAt)` is the canonical resolver:

| State        | Trigger                                                                            | Effective tier applied      |
| ------------ | ---------------------------------------------------------------------------------- | --------------------------- |
| `active`     | `tier === 'free'`, OR `expiresAt` is null, OR `expiresAt > now`                    | the shop's real tier        |
| `grace`      | `expiresAt <= now` AND `now <= expiresAt + 7 days` (`GRACE_PERIOD_DAYS = 7`)       | the shop's real tier        |
| `expired`    | past the 7-day grace window                                                        | downgraded to `free`        |
| `suspended`  | set by admin (`/api/v1/admin/shops/[id]`) — currently a state only, no UI path     | downgraded to `free`        |
| `canceled`   | set by admin / billing webhook                                                     | downgraded to `free`        |

Only `active` and `grace` keep paid features working (`isActive =
state === 'active' || state === 'grace'`). Every other state collapses the
shop's effective feature set to `free` (empty), without mutating the
`subscriptionTier` column — the tier is preserved so the shopkeeper can
renew and immediately regain access.

> A `Subscription` model exists in `schema.prisma` (one-to-one with `Shop`,
> `tier`, `status`, `currentPeriodStart/End`, `provider`, external
> `providerSubscriptionId`) but is **not consulted** by the entitlements
> resolver today. All gating uses `Shop.subscriptionTier` + `Shop.subscriptionExpiresAt`.
> Migrating to the `Subscription` model is a future task (see
> `docs/architecture/audit/SUBSCRIPTION_GAP_ANALYSIS.md`).

---

## 4. Fail-Closed Behavior

The entitlement service is fail-closed by design. From
`src/lib/api/entitlements.ts`:

```ts
export async function isEntitled(shopId, feature): Promise<boolean> {
  try {
    const shop = await repos.shops.findById(shopId);
    if (!shop) return false;           // unknown shop → deny
    // ... state + feature check ...
    return features.includes(feature);
  } catch {
    return false;                       // DB error, timeout, etc. → deny
  }
}
```

| Failure mode                                  | `isEntitled` returns | Effect on route                                  |
| --------------------------------------------- | -------------------- | ------------------------------------------------ |
| Shop row not found                            | `false`              | paid feature denied with `ForbiddenError`        |
| DB unreachable / `repos.shops.findById` throws | `false`            | paid feature denied with `ForbiddenError`        |
| Free feature being requested                  | `true` (not gated)   | free feature still served (no entitlement check) |
| Tier unknown / `PLAN_FEATURES` miss           | `false`              | paid feature denied                              |

**`getSubscriptionStatus` is also fail-closed** — on any thrown error it
returns `{ tier: 'free', effectiveTier: 'free', state: 'expired',
isActive: false, features: [] }`. The dashboard shows the shop as expired
instead of crashing.

This means a degraded database does NOT silently grant paid features — it
temporarily locks them down, which is the safe direction. Free features
(ordering, printing, payment, basic shop management) keep serving because
those routes do not call `requireEntitlement` at all.

---

## 5. Audit Logging of Denials

When `requireEntitlement()` denies a feature, it writes an `AuditLog` row
**before** throwing `ForbiddenError`. The denial is recorded even if the
audit-log insert itself fails (the catch is non-fatal — the denial still
happens):

```ts
await container.db.insert('AuditLog', {
  id: crypto.randomUUID(),
  shopId,
  userId: null,                       // principal not threaded here today
  action: 'entitlement.denied',
  entityType: 'subscription',
  entityId: shopId,
  metadata: JSON.stringify({ feature, timestamp: new Date().toISOString() }),
  ip: null,
  createdAt: new Date(),
});
throw new ForbiddenError(`This feature (${feature}) requires an upgraded subscription plan.`);
```

`AuditLog` is indexed `@@index([shopId, createdAt])`, so denials are
queryable per-shop in time order via `repos.audit.findByAction('entitlement.denied')`.

> **Known gap:** `userId` and `ip` are `null` in denial rows because
> `requireEntitlement` doesn't receive the principal. Other audit callers
> (`order.checkout`, `shop.update`, webhook handlers) do thread these. Wiring
> them through the entitlement call is a future hardening task.

---

## 6. Operational Notes

- **Tier changes are admin-only.** Only `/api/v1/admin/shops/[id]` writes
  `subscriptionTier` / `subscriptionExpiresAt`; the shopkeeper cannot
  self-upgrade today. There is no billing provider wired into the
  `Subscription` model — renewals are manual until that integration ships.
- **Grace window is 7 days, fixed.** `GRACE_PERIOD_DAYS = 7` is a constant,
  not configurable per-shop. The check is wall-clock based on
  `subscriptionExpiresAt` — there is no "grace until end of month" logic.
- **Effective tier ≠ stored tier.** Always read the
  `effectiveTier` field from `getSubscriptionStatus`, never the raw
  `subscriptionTier` column, when deciding whether to gate a feature in
  new code.
- **Suspending a shop does not delete orders or block free features.**
  Suspended shops can still receive new orders and print — they just lose
  analytics/reports (and any future pro/enterprise features). Full
  suspension (block ordering) is a future capability not yet implemented.

---

## 7. Adding a New Entitled Feature

1. Add the feature to the `Feature` union type.
2. Add it to every plan in `PLAN_FEATURES` that should include it (and to
   `enterprise` so the union is exhaustive).
3. Add the `requireEntitlement(shop.id, '<feature>')` call at the top of
   each route handler that exposes the feature, immediately after the
   shop is resolved and before any DB work that the feature gates.
4. Add a test under `src/lib/api/` mirroring the existing
   `analytics` / `reports` coverage — assert (a) `free` tier gets
   `ForbiddenError`, (b) `starter`+ gets through, (c) DB error →
   `ForbiddenError`.
5. Update this table in §2.
