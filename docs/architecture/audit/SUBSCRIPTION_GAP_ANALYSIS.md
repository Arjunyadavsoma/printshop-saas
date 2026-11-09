# Subscription System — Gap Analysis

> Audit of the subscription system: `Subscription` model exists but is vestigial. `Shop.subscriptionTier` is informational only. No entitlements enforcement. Documents what exists vs what's missing, and the confirmed business rules.

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b`
**Evidence labels:** VERIFIED (source-confirmed), IMPLEMENTED, BLOCKED, NOT VERIFIED

---

## 1. Confirmed business rules

These rules are stated in `docs/PRODUCTION_READINESS_AUDIT.md` and cross-referenced with the codebase. They define what the subscription system MUST do:

1. **Launch cohort:** First 100 shops form the launch cohort (free access)
2. **Admin selection:** A central administrator manually selects which shops get free access
3. **Paid plans from launch:** Paid subscription plans exist from day one
4. **Central control:** Subscription state is centrally controlled (admin-managed, not self-serve)
5. **Entitlements gating:** Routes/features must be gated by subscription tier

---

## 2. What exists today (AS-IS)

### 2.1 Database schema — VERIFIED

**File:** `prisma/schema.prisma`

**`Subscription` model (lines 161-173):**
```prisma
model Subscription {
  id                     String   @id @default(uuid())
  shopId                 String   @unique
  tier                   String   @default("free")
  status                 String   @default("active")
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  provider               String   @default("internal")
  providerSubscriptionId String?
  ...
}
```

**`Shop.subscriptionTier` field (line 23):**
```prisma
subscriptionTier      String        @default("free")
subscriptionExpiresAt DateTime?
```

**`Shop.subscription` relation (line 53):** `subscription Subscription?`

### 2.2 Code references — VERIFIED

Grep for `Subscription|subscriptionTier` in `src/`:

| File | Reference type | Status |
|---|---|---|
| `src/lib/repositories/shop.repository.ts` | `subscriptionTier` field on `Shop` type | Informational read |
| `src/app/api/v1/admin/shops/route.ts` | `subscriptionTier` in admin shop list | Informational |
| `src/app/api/v1/admin/shops/[id]/route.ts` | `subscriptionTier` in admin shop update | Informational |
| `src/app/api/v1/shops/route.ts` | `subscriptionTier` in shop listing | Informational |
| `src/app/api/v1/shops/me/route.ts` | `subscriptionTier` in shop profile | Informational |
| `src/app/admin/shops/page.tsx` | Display only | UI label |
| `src/app/admin/shops/[id]/page.tsx` | Display + edit form | UI label |
| `src/app/shop/settings/page.tsx` | Display only | UI label |
| `src/components/portal/admin-types.ts` | Type definition | Type only |
| `src/lib/services/seed.service.ts` | Seed data sets tier="free" | Seed |
| `src/app/api/v1/auth/register/route.ts` | Sets `subscriptionTier: 'free'` on register | Default value |
| Tests (.test.ts) | Test fixtures | Test data |
| `src/app/api/v1/setup-database/route.ts` | Setup script | Setup |

**Critical finding:** ZERO repository files import the `Subscription` model. ZERO service files query `Subscription`. ZERO route handlers enforce entitlements based on `Subscription.tier` or `Shop.subscriptionTier`.

### 2.3 Production DB state — VERIFIED

From `docs/PRODUCTION_READINESS_AUDIT.md:39`: production DB has `Subscription` table present (one of the 10 tables) but it's empty. The `Shop.subscriptionTier` column on the 1 production shop is `free` (default).

---

## 3. Gap analysis (what's missing)

### GAP-001 — `Subscription` model is vestigial
- **Severity:** P1
- **Status:** IMPLEMENTED (schema) / NOT VERIFIED (code)
- **Evidence:** zero repository files import it; zero routes query it; `Subscription` table is empty in prod
- **Reference:** `docs/PRODUCTION_READINESS_AUDIT.md:62-66` (finding M2)

### GAP-002 — No entitlements enforcement middleware
- **Severity:** P1
- **Status:** NOT IMPLEMENTED
- **Evidence:** grep for `requireEntitlement` returns zero matches in `src/`
- **Business rule violated:** rule 5 (entitlements gating)
- **Reference:** `docs/SECURITY_ASSESSMENT.md:97-101` (SEC-009, Phase 2)

### GAP-003 — No launch-cohort tracking
- **Severity:** P2
- **Status:** NOT IMPLEMENTED
- **Evidence:** no `cohortId`, no `isLaunchCohort` flag, no admin tooling to mark first-100 shops
- **Business rule violated:** rule 1 (first 100 shops = launch cohort)

### GAP-004 — No admin "free access" toggle
- **Severity:** P2
- **Status:** PARTIAL — admin can edit `Shop.subscriptionTier` to any string via `src/app/api/v1/admin/shops/[id]/route.ts`, but no validation against allowed tiers (`free`, `pro`, `business`, etc.)
- **Business rule violated:** rule 2 (admin manually selects free-access shops)

### GAP-005 — No paid-plan checkout flow
- **Severity:** P2
- **Status:** NOT IMPLEMENTED
- **Evidence:** no `/api/v1/subscriptions/checkout` route; no plan-pricing config; no payment-provider integration for PrintShop's own revenue (the existing payment pipeline is for shop customer orders, not for shop subscriptions to PrintShop itself)
- **Business rule violated:** rule 3 (paid plans from launch)

### GAP-006 — No subscription expiry enforcement
- **Severity:** P2
- **Status:** NOT IMPLEMENTED
- **Evidence:** `Shop.subscriptionExpiresAt` exists but no cron/checker verifies it; expired subscriptions continue to work
- **Business rule violated:** rule 5 (entitlements gating)

### GAP-007 — `Subscription` model not wired to `Shop.subscriptionTier`
- **Severity:** P2
- **Status:** NOT IMPLEMENTED
- **Evidence:** two sources of truth (`Shop.subscriptionTier` string + `Subscription.tier` on related row) with no sync logic; risk of drift
- **Fix:** pick ONE source of truth (recommend `Subscription` model as authoritative; deprecate `Shop.subscriptionTier`)

---

## 4. Recommended target model

### 4.1 Source of truth

**`Subscription` model is authoritative.** `Shop.subscriptionTier` becomes a denormalized cache (read from `Subscription.tier` on every shop fetch) or is removed entirely.

### 4.2 Tier enum (proposal)

| Tier | Price | Entitlements |
|---|---|---|
| `launch_cohort` | Free (admin-granted) | All features, no expiry |
| `free` | Free | 50 orders/month, 1 print agent, no delivery tracking |
| `pro` | ₹499/month | 500 orders/month, 3 print agents, delivery tracking, daily reports |
| `business` | ₹1499/month | Unlimited orders, unlimited agents, all features, priority support |

### 4.3 Required entitlements middleware

```typescript
// Proposed: src/lib/api/require-entitlement.ts
export function requireEntitlement(feature: EntitlementFeature) {
  return withAuth(async (req, ctx, principal) => {
    const subscription = await repos.subscriptions.findActiveByShop(principal.shopId);
    if (!hasEntitlement(subscription.tier, feature)) {
      throw new ForbiddenError(`Tier '${subscription.tier}' does not include '${feature}'`);
    }
    // ... delegate to handler
  });
}
```

**Features to gate:**
- `print_agents` — number of registered agents per shop
- `delivery_tracking` — `PrintDeliveryAttempt` API access
- `daily_reports` — `/api/v1/shops/me/reports/daily`
- `sync` — `/api/v1/sync/*` endpoints
- `multiple_locations` — multi-shop ownership

### 4.4 Admin tooling

- `POST /api/v1/admin/shops/{id}/subscription` — grant/revoke launch-cohort status
- `GET /api/v1/admin/subscriptions` — list all subscriptions
- Audit-logged: `subscription.grant`, `subscription.revoke`, `subscription.tier_change`

---

## 5. Migration plan (NO EXECUTION — design only)

### Phase A: Wire existing model (no schema change)
1. Create `src/lib/repositories/subscription.repository.ts`
2. Create `src/lib/api/require-entitlement.ts` middleware
3. Wire `Subscription` creation on shop registration (`src/app/api/v1/auth/register/route.ts`)
4. Add admin endpoints for tier management
5. Gate 3 low-risk routes first (e.g., `/sync/*`, `/reports/daily`) to validate

### Phase B: Launch cohort tracking
1. Add `cohortId String?` to `Shop` (additive — safe)
2. Backfill: admin marks first 100 shops with `cohortId = 'launch-2025-11'`
3. `subscription.provider = 'launch_cohort'` for these shops

### Phase C: Paid-plan checkout
1. Add `Subscription.provider = 'razorpay' | 'stripe'` support
2. New route `POST /api/v1/subscriptions/checkout` (shopkeeper-authed)
3. New webhook `POST /api/v1/subscriptions/webhook/{provider}` (signature-verified)
4. Cron: check `currentPeriodEnd` — flip status to `past_due` → `cancelled`

### Phase D: Deprecate `Shop.subscriptionTier`
1. Stop writing to `Shop.subscriptionTier` (read from `Subscription.tier` instead)
2. Backfill: copy `Shop.subscriptionTier` → `Subscription.tier` for all shops
3. Mark `Shop.subscriptionTier` as `@deprecated` in schema
4. Remove in a future migration

---

## 6. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Free-tier shops use all features (no enforcement) | High (current state) | Revenue loss | Phase A gates 3 routes first |
| Subscription state drift between `Shop.subscriptionTier` and `Subscription.tier` | Medium | Reconciliation errors | Phase D consolidates |
| Paid webhook fails → shop locked out | Low | Customer churn | Grace period (7 days) before `past_due` → `cancelled` |
| Launch cohort shops lose free access by accident | Medium | Trust loss | Audit log every tier change; admin-only |

---

## 7. Recommendation

**Start with Phase A (no schema change).** The `Subscription` model and `Shop.subscriptionTier` field already exist. The gap is code, not schema. Wiring the repository + middleware + gating 3 routes is a 1-day effort and immediately closes GAP-001, GAP-002, and partially GAP-004.

Phase B (launch cohort) should follow before public launch — needed for the 100-shop cohort rule.

Phase C (paid checkout) is a larger effort (~1 week) and depends on choosing a payment provider for PrintShop's own revenue (separate from the existing shop-customer payment pipeline).

**Do NOT remove the `Subscription` model.** It's vestigial today, but it's the right shape. Wire it instead.

---

## References
- `docs/PRODUCTION_READINESS_AUDIT.md:62-66` — finding M2 (vestigial)
- `docs/SECURITY_ASSESSMENT.md:97-101` — SEC-009 (no entitlements)
- `docs/KNOWN_LIMITATIONS.md:46-49` — P1-4 (subscription enforcement)
- `prisma/schema.prisma:161-173` — `Subscription` model
- `prisma/schema.prisma:23` — `Shop.subscriptionTier`
