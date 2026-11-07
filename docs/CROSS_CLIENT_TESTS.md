# PrintShop — Cross-Client Acceptance Tests

> Specifications for the 7 cross-client integration tests (TEST A–G).
> Each test verifies that PrintShop SaaS (web) and PrintEXE (Windows
> desktop) function as two interfaces to one unified platform.

**Status:** v1.0 — 2025-11-07.

---

## Honest execution status

**These tests CANNOT be executed in this environment because:**
1. PrintEXE has never been compiled (requires Windows + WPF toolchain)
2. PrintEXE's wire protocol is incompatible with the SaaS backend (see `docs/DESKTOP_INTEGRATION.md`)
3. The `Customer` model exists in schema but the DB table hasn't been pushed
4. No PrintEXE test client can connect to the SaaS backend

**What IS done:**
- The sync endpoints are implemented (`/api/v1/sync/pull`, `/push`, `/status`, `/devices/register`)
- The `Customer` model is in `prisma/schema.prisma`
- The test specifications below are ready to execute once PrintEXE is adapted + compiled

**To run these tests, you need:**
1. A Windows machine with .NET 10 SDK
2. PrintEXE compiled + protocol adapted per `docs/DESKTOP_INTEGRATION.md`
3. `bun run db:push` run on the SaaS DB (to create the `Customer` + `DeviceSyncState` tables)
4. Both clients configured against the same test backend

---

## Test environment

- **Backend:** PrintShop SaaS dev instance (`http://localhost:3000`)
- **Web client:** Browser at `http://localhost:3000`
- **Desktop client:** PrintEXE on Windows, configured to the same backend
- **Test tenant:** Two test shops (`test-shop-a`, `test-shop-b`) with separate owners
- **Test data:** Isolated — no real customer data

---

## TEST A — Customer cross-client sync

**Verifies:** Customer created on desktop → appears on web → edited on web → update appears on desktop.

### Steps

1. **Create customer in PrintEXE:**
   - PrintEXE calls `POST /api/v1/sync/push` with:
     ```json
     { "changes": [{
       "entity": "Customer",
       "id": "<new-uuid>",
       "action": "upsert",
       "data": { "name": "Test Customer A", "phone": "9876543210" },
       "clientRevision": 1,
       "baseRevision": 0
     }] }
     ```
   - Expected: `{ "results": [{ "id": "<uuid>", "accepted": true, "serverRevision": 1, "conflict": false }] }`

2. **Verify on website:**
   - GET `/api/v1/shops/me` → shop dashboard
   - GET customer list (future endpoint) → `Test Customer A` appears
   - Verify: name = "Test Customer A", phone = "9876543210"

3. **Edit on website:**
   - PATCH customer (future endpoint) → change name to "Test Customer A (edited)"
   - Verify: server `revision` increments to 2

4. **Verify in PrintEXE:**
   - PrintEXE calls `GET /api/v1/sync/pull?cursor=<last-cursor>`
   - Expected: returns the Customer change with `action: "upsert"`, `data.name: "Test Customer A (edited)"`, `revision: 2`
   - PrintEXE updates local cache

### Pass criteria
- Customer appears on both clients with identical data
- No data loss in either direction
- `revision` increments correctly

---

## TEST B — Product pricing + order cross-client

**Verifies:** Product created on web → price changed → appears on desktop → order created on desktop → correct price + order on web.

### Steps

1. **Create product on website:**
   - POST product (future endpoint) → "Test Product B", price ₹5.00/page
   - Verify: `revision = 1`

2. **Change price on website:**
   - PATCH product → price ₹7.00/page
   - Verify: `revision = 2`

3. **Verify in PrintEXE:**
   - `GET /api/v1/sync/pull` → product change with `pricePaise: 700`, `revision: 2`

4. **Create order in PrintEXE:**
   - PrintEXE creates a walk-in order via `POST /api/v1/sync/push` (Order entity — future when Orders become pushable)
   - Order: 10 pages × ₹7.00 = ₹70.00
   - Expected: server computes total = `7000` paise

5. **Verify order on website:**
   - GET `/api/v1/shops/me/orders` → order appears
   - Verify: `totalAmountPaise = 7000` (server-computed, not desktop-computed)

### Pass criteria
- Product price change syncs to desktop
- Order total is server-computed (not desktop-computed)
- Both clients show the same total

---

## TEST C — Invoice + partial payment cross-client

**Verifies:** Invoice created on desktop → partial payment recorded → verified on web → another payment on web → updated balance on desktop.

### Steps

1. **Create invoice in PrintEXE:**
   - `POST /api/v1/sync/push` → Invoice entity, total ₹1000.00 (100000 paise)
   - Expected: server creates invoice with `status: "issued"`, `paidPaise: 0`, `outstandingPaise: 100000`

2. **Record partial payment (₹400) in PrintEXE:**
   - `POST /api/v1/sync/push` → Payment entity, amountPaise: 40000
   - Expected: server updates invoice `paidPaise: 40000`, `status: "partial"`, `outstandingPaise: 60000`

3. **Verify on website:**
   - GET invoice → `paidPaise: 40000`, `status: "partial"`, `outstandingPaise: 60000`

4. **Record another payment (₹600) on website:**
   - POST payment → amountPaise: 60000
   - Expected: `paidPaise: 100000`, `status: "paid"`, `outstandingPaise: 0`

5. **Verify in PrintEXE:**
   - `GET /api/v1/sync/pull` → invoice change with `paidPaise: 100000`, `status: "paid"`
   - PrintEXE displays updated balance = ₹0.00

### Pass criteria
- Partial payments accumulate correctly
- Invoice status transitions: issued → partial → paid
- Outstanding balance is server-computed
- Both clients show the same balance

---

## TEST D — Offline operations + reconnect

**Verifies:** Desktop operates offline → queues operations → reconnects → all operations sync → no duplicates.

### Steps

1. **Disconnect PrintEXE:**
   - Disable network on the Windows machine
   - PrintEXE shows "offline" status

2. **Create offline operations:**
   - Create 3 customers locally in PrintEXE
   - Create 1 order locally
   - All queued in local SQLite

3. **Reconnect:**
   - Enable network
   - PrintEXE attempts `POST /api/v1/sync/push` with all 4 changes

4. **Verify synchronization:**
   - All 4 changes accepted by server
   - Each gets a unique `serverRevision`
   - No duplicates (idempotency via UUID + revision)

5. **Verify no duplicates:**
   - `GET /api/v1/sync/pull` → returns exactly 4 changes
   - Web dashboard shows exactly 3 new customers + 1 new order

### Pass criteria
- Offline queue persists across app restart
- All operations sync on reconnect
- Zero duplicate records
- Idempotency keys prevent replay duplicates

---

## TEST E — Concurrent update conflict

**Verifies:** Same record modified from both clients simultaneously → documented conflict policy applied.

### Steps

1. **Both clients fetch the same customer:**
   - Web: GET customer → `revision: 5`, `name: "Original"`
   - PrintEXE: GET customer (via sync pull) → `revision: 5`, `name: "Original"`

2. **Web edits first:**
   - PATCH customer → `name: "Web Edit"`, server `revision: 6`

3. **PrintEXE edits with stale base:**
   - PrintEXE pushes: `{ baseRevision: 5, data: { name: "Desktop Edit" } }`
   - Server detects: `current revision (6) > baseRevision (5)` → conflict

4. **Verify conflict policy:**
   - Server returns `{ accepted: false, conflict: true, serverRevision: 6, serverData: { name: "Web Edit" } }`
   - PrintEXE shows conflict resolution UI
   - Desktop accepts server version OR merges

### Pass criteria
- Conflict detected (no silent overwrite)
- Server version preserved (last-write-wins by default)
- Desktop receives the server's current data for merge
- No data corruption

---

## TEST F — Tenant isolation

**Verifies:** Two separate shops cannot access each other's data.

### Steps

1. **Create two test shops:**
   - Shop A: owner-a@test.com, shop slug `test-shop-a`
   - Shop B: owner-b@test.com, shop slug `test-shop-b`

2. **Create data in each shop:**
   - Shop A: customer "Customer A1"
   - Shop B: customer "Customer B1"

3. **Authenticate as Shop A:**
   - GET `/api/v1/sync/pull` with Shop A's device token
   - Verify: only sees "Customer A1", NOT "Customer B1"

4. **Attempt cross-tenant access:**
   - Shop A tries to GET Shop B's order by ID → 404 (not found, not "forbidden" — existence hidden)
   - Shop A tries to push a change to Shop B's customer ID → `accepted: false, conflict: true, reason: "not found or wrong tenant"`

5. **Verify no data leaks:**
   - Shop A's sync pull returns 0 records from Shop B
   - Shop B's sync pull returns 0 records from Shop A
   - Direct API access to Shop B's resources returns 404

### Pass criteria
- Zero cross-tenant data exposure
- Tenant boundary enforced at auth + query + mutation layers
- No information leak via error messages (404, not 403)

---

## TEST G — Subscription entitlements

**Verifies:** Subscription changes on web → entitlements update on desktop → expired/restricted subscriptions enforced.

### Steps

1. **Shop on free tier:**
   - Shop A: `subscriptionTier: "free"`
   - PrintEXE displays "Free Plan" badge
   - PrintEXE can sync (basic entitlement)

2. **Upgrade on website:**
   - Shopkeeper upgrades to "pro" (future endpoint)
   - `Shop.subscriptionTier: "pro"`, `subscriptionExpiresAt: +30 days`

3. **Verify in PrintEXE:**
   - `GET /api/v1/sync/pull` → Shop change with `subscriptionTier: "pro"`
   - PrintEXE displays "Pro Plan" badge
   - Pro features unlocked (e.g., advanced analytics)

4. **Test expired subscription:**
   - Set `subscriptionExpiresAt` to past date (via admin or test)
   - PrintEXE: `GET /api/v1/sync/status` → returns subscription status
   - PrintEXE shows "Subscription expired" warning
   - Paid features restricted (server rejects with 402 Payment Required)

5. **Test restricted features:**
   - PrintEXE attempts a pro-only operation
   - Server: `402 Payment Required` → `{ error: { message: "Pro subscription required", code: "SUBSCRIPTION_REQUIRED" } }`
   - PrintEXE shows upgrade prompt

### Pass criteria
- Subscription tier syncs to desktop
- Expired subscriptions restrict features
- Server enforces entitlements (desktop never decides locally)
- Graceful degradation (free features still work)

---

## Test execution checklist

| Test | Can execute now? | Blocker |
|---|---|---|
| TEST A (Customer sync) | ❌ | PrintEXE not compiled + protocol incompatible |
| TEST B (Product + order) | ❌ | Product model not in schema + PrintEXE |
| TEST C (Invoice + payments) | ❌ | Invoice model not in schema + PrintEXE |
| TEST D (Offline + reconnect) | ❌ | PrintEXE not compiled |
| TEST E (Conflict) | ❌ | PrintEXE not compiled |
| TEST F (Tenant isolation) | ⚠️ Partial | Can test web-only tenant isolation; desktop adds another vector |
| TEST G (Subscription) | ❌ | Subscription enforcement not implemented + PrintEXE |

## What CAN be tested now (web-only)

- **Tenant isolation (web):** two shopkeepers can't access each other's orders (verified by existing tests)
- **Payment idempotency:** duplicate webhooks don't create duplicate payments (verified by `payments.test.ts`)
- **Order state machine:** race-safe transitions (verified by `atomic-claim.test.ts`)
- **Sync pull (server side):** `GET /api/v1/sync/pull` returns changes since cursor (can test with curl)
- **Sync push (server side):** `POST /api/v1/sync/push` accepts Customer changes (can test with curl)

## Automated test implementation (future)

Once PrintEXE is compiled + adapted, create `tests/cross-client/` with Playwright + a PrintEXE test harness:
- `tests/cross-client/test-a-customer-sync.spec.ts`
- `tests/cross-client/test-b-product-order.spec.ts`
- `tests/cross-client/test-c-invoice-payment.spec.ts`
- `tests/cross-client/test-d-offline-reconnect.spec.ts`
- `tests/cross-client/test-e-conflict.spec.ts`
- `tests/cross-client/test-f-tenant-isolation.spec.ts`
- `tests/cross-client/test-g-subscription.spec.ts`

Each test orchestrates both clients + verifies the server state.
