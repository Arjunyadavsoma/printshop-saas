# PrintShop SaaS — API Test Coverage Report

> Coverage map for the test suite at `/home/z/my-project`. Every count is
> verified against the source files; per-test-file summaries list what is
> and isn't covered. Findings use the same FIND-### convention as the
> companion `PRODUCTION_READINESS_AUDIT.md`.

## 0. Test runner + file discovery

**FIND-038 — Runner (VERIFIED).** `vitest.config.ts:20–23` declares:
```ts
test: { include: ['packages/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' }
```
Glob of `src` + `packages` for `*.test.ts` returns **25 files** (24 under
`src/` + `packages/` — actually 5 under `packages/`, 20 under `src/`).
Environment is `node`; aliases map `@platform/*` and `@/*` to source roots.

**FIND-039 — Total test count = 276 (VERIFIED).** Per-file `it()` counts
(grep `^\s*it\(|^\s*test\(`):

| Tests | File |
|------:|------|
| 35 | `packages/core/src/pricing/pricing-engine.test.ts` |
| 21 | `src/lib/api/http-route-tests.test.ts` |
| 20 | `src/lib/printlatch/printlatch.test.ts` |
| 17 | `src/lib/auth/auth.test.ts` |
| 16 | `src/lib/payments/phonepe-v2-webhook.test.ts` |
| 16 | `packages/adapters/src/storage/s3.adapter.test.ts` |
| 14 | `src/lib/upload-lifecycle.test.ts` |
| 13 | `src/lib/repositories/order-token-concurrency.test.ts` |
| 13 | `packages/adapters/src/payment/upi-deeplink.adapter.test.ts` |
| 11 | `src/lib/repositories/repositories.test.ts` |
| 11 | `src/lib/api/api-routes.test.ts` |
| 10 | `src/lib/services/delivery-coordinator.test.ts` |
| 10 | `packages/adapters/src/cache/in-memory.adapter.test.ts` |
| 8  | `src/lib/container.test.ts` |
| 7  | `src/lib/storage/capability.test.ts` |
| 7  | `src/lib/payments/payments.test.ts` |
| 7  | `packages/adapters/src/storage/r2.adapter.test.ts` |
| 6  | `src/lib/payments/print-job-idempotency.test.ts` |
| 6  | `src/lib/crypto/credential-encryption.test.ts` |
| 6  | `src/lib/api/require-dev.test.ts` |
| 5  | `src/lib/token-consistency.test.ts` |
| 5  | `src/lib/services/durable-queue.test.ts` |
| 4  | `src/lib/services/atomic-claim.test.ts` |
| 4  | `src/lib/payments/webhook-audit.test.ts` |
| 4  | `src/lib/db.test.ts` |

**Sum: 35+21+20+17+16+16+14+13+13+11+11+10+10+8+7+7+7+6+6+6+5+5+4+4+4 = 276.**

The task description's decomposition:
- 21 real HTTP route-handler tests → `http-route-tests.test.ts` (**VERIFIED**)
- 11 API utility tests → `api-routes.test.ts` (**VERIFIED**)
- 10 delivery coordinator tests → `delivery-coordinator.test.ts` (**VERIFIED**)
- 234 unit/integration tests → the other 22 files combined: 276 − 21 − 11 − 10 = **234** (**VERIFIED** by subtraction)

## 1. Real HTTP route-handler tests — `src/lib/api/http-route-tests.test.ts`

**FIND-040 — File header (VERIFIED).** Lines 22–30: "REAL HTTP Route-Handler
Tests … invoke the ACTUAL exported route handler functions (GET, POST, etc.)
with real NextRequest objects and real JWT tokens." References **FIND-033
(P0)**: previously zero real HTTP route-handler tests.

**FIND-041 — Setup (VERIFIED, lines 38–107).** `beforeEach` builds a full
in-memory container (db, cache, storage, payment, realtime, queue, email,
sms, logger, auth) via `setContainerForTesting(container)`. Creates a test
user (`owner@test.com`), shop, links user→shop, issues a real JWT via
`auth.issueAccessToken(...)`. `authedReq()` and `unauthedReq()` helpers
build `NextRequest` objects with the right `Authorization` header.

**FIND-042 — Coverage breakdown (VERIFIED).**

| # | Route | What it asserts | Lines |
|--:|---|---|---|
| 1 | `GET /api/v1/health` | 200 + `success:true` + `status:'ok'` | 128–137 |
| 2 | `GET /api/v1/shops/me` (authed) | 200 + shop profile + subscription `{tier:'free', state:'active'}` | 141–152 |
| 3 | `GET /api/v1/shops/me` (no auth) | 401 | 154–159 |
| 4 | `GET /api/v1/shops/me` (invalid token) | 401 | 161–168 |
| 5 | `GET /api/v1/shops/me/analytics` (authed, free tier) | 403 + `error.code:'FORBIDDEN'` (entitlement enforced) | 172–181 |
| 6 | `GET /api/v1/shops/me/analytics` (no auth) | 401 | 183–188 |
| 7 | `GET /api/v1/shops/me/reports/daily` (authed, free tier) | 403 (entitlement enforced) | 192–202 |
| 8 | `GET /api/v1/shops` (public) | 200 + shop array | 205–215 |
| 9 | `GET /api/v1/shops/me/agents` (authed) | 200 + array | 218–227 |
| 10 | `GET /api/v1/shops/me/agents` (no auth) | 401 | 229–234 |
| 11 | `GET /api/v1/shops/me/orders` (authed) | 200 | 238–246 |
| 12 | `GET /api/v1/shops/me/orders` (no auth) | 401 | 248–253 |
| 13 | `GET /api/v1/sync/status` (no device token) | 401 | 257–263 |
| 14 | `GET /api/v1/sync/status` (invalid device token) | 401 | 265–272 |
| 15 | `GET /api/v1/cron/cleanup` (no secret) | 401 | 276–283 |
| 16 | `GET /api/v1/db-health` (key configured, no `?key=`) | 401 | 286–300 |

The remaining 5 tests (lines 303–365) form a separate `describe` block
covering subscription states (free tier denied, pro tier allowed, grace
period, expired, suspended).

**FIND-043 — What is NOT covered (VERIFIED by absence).**

- **70 routes exist (FIND-001 in audit); only ~7 unique routes are exercised.** 21
  tests but high redundancy (multiple auth-failure variants per route).
- **No POST/PUT/DELETE happy-path tests for write routes.** Order creation,
  checkout, file upload, mark-paid, complete, cancel, verify-payment,
  register, login — none are exercised end-to-end.
- **No `withDeviceAuth` happy-path test** — only 401 cases for `/sync/status`.
  No test issues a valid device token + asserts the agent can pull jobs.
- **No admin route tests** — `/api/v1/admin/*` is not touched.
- **No webhook route tests** — `/api/v1/payments/phonepe/webhook` POST is
  not invoked through the route handler (it's tested at the service layer
  in `phonepe-v2-webhook.test.ts` and `payments.test.ts`).
- **No `withOrderAccess` happy-path test** — customer-token flow is not
  exercised through the route handler.
- **No cross-tenant isolation test at the HTTP layer** — the audit's
  FIND-003 three-layer isolation is NOT verified end-to-end.

## 2. API utility tests — `src/lib/api/api-routes.test.ts`

**FIND-044 — File header (VERIFIED, lines 22–44).** "FIND-033 regression —
API route guard / validation test coverage. The original audit found ZERO
tests under `src/app/api/`." Coverage claims: entitlements middleware,
db-health auth, receipt rate-limit wrap, webhook payment-session lookup.

**FIND-045 — Mocking strategy (VERIFIED, lines 46–85).** Uses `vi.hoisted`
+ `vi.mock('@/lib/db', …)` to inject mocks for `db.paymentAttempt.findUnique`
and `db.$queryRaw`. This is necessary because the entitlements code uses
the in-memory container, but the webhook.service's DB fallback + db-health
route both call the Prisma singleton directly.

**FIND-046 — Coverage breakdown (VERIFIED).**

| # | Suite | What it asserts | Lines |
|--:|---|---|---|
| 1 | Entitlements | `isEntitled` false for free + pro-only feature | 180–185 |
| 2 | Entitlements | `isEntitled` true for pro + pro-tier feature | 187–195 |
| 3 | Entitlements | `requireEntitlement` throws `ForbiddenError` with `code:'FORBIDDEN'`, `statusCode:403` | 197–205 |
| 4 | Entitlements | `getSubscriptionStatus` active + correct tier + ~30 days to expiry | 207–218 |
| 5 | Entitlements | `getSubscriptionStatus` grace-period flag for expired 3 days ago | 220–230 |
| 6 | db-health | 401 when SETUP_KEY configured but no `?key=` | 239–249 |
| 7 | db-health | 200 + health report when `?key=` correct | 251–265 |
| 8 | Receipt rate-limit | `GET` is a function (wrapped via `withRateLimit`) | 275–282 |
| 9 | Webhook lookup | `lookupPaymentSession` returns null on cache + DB miss | 292–301 |
| 10 | Webhook lookup | `rememberPaymentSession` + `lookupPaymentSession` round-trip via cache | 303–316 |
| 11 | Webhook lookup | DB fallback when cache misses but PaymentAttempt row exists; re-populates cache | 318–341 |

**FIND-047 — What is NOT covered (VERIFIED by absence).**

- **`withAuth` itself is not directly unit-tested.** The 401/403 behaviour
  is verified indirectly through `http-route-tests.test.ts` route tests.
- **`withDeviceAuth` is not unit-tested directly.**
- **`withOrderAccess` is not unit-tested directly** — only the receipt
  GET's wrap is asserted as a function (test 8).
- **`rateLimit` function (`src/lib/api/rate-limit.ts`) is not unit-tested.**
  Test 8 only asserts the wrap exists, not that throttling actually fires
  at the limit boundary.
- **`requireDev()` is tested in a separate file** (`src/lib/api/require-dev.test.ts`, 6 tests).
- **The envelope helpers (`ok`, `fail`, `toAppError`, `requestId`,
  `logRequest`) are not unit-tested** in `api-routes.test.ts`.
- **No `origin.ts` tests** (CORS/origin validation, `src/lib/api/origin.ts`).

## 3. Delivery coordinator tests — `src/lib/services/delivery-coordinator.test.ts`

**FIND-048 — File header (VERIFIED, lines 26–36).** "Delivery coordinator
contract tests — verifies the actual service logic with authenticated
test fixtures (not just HTTP 401 responses)." Tests:
`findEligibleAgents`, `markDeliveryReceived`, `processCleanupTasks`.

**FIND-049 — Fixture (VERIFIED, lines 65–164).** `createTestFixture()`
builds: shop → agent → order → print file → print job, all via the
in-memory DB (`container.db.insert`).

**FIND-050 — Coverage breakdown (VERIFIED).**

| # | Suite | What it asserts | Lines |
|--:|---|---|---|
| 1 | findEligibleAgents | Finds agents with fresh heartbeats | 167–179 |
| 2 | findEligibleAgents | Excludes agents with stale heartbeats (>30s) | 181–192 |
| 3 | findEligibleAgents | Excludes agents with no heartbeat | 194–199 |
| 4 | findEligibleAgents | Tenant isolation — only returns specified shop's agents | 201–216 |
| 5 | markDeliveryReceived | Acknowledges receipt for a valid job | 220–231 |
| 6 | markDeliveryReceived | Idempotent — duplicate receipt returns success | 233–252 |
| 7 | markDeliveryReceived | Does not interpret receipt as print completion | 254–266 |
| 8 | processCleanupTasks | Returns zeros when no tasks exist | 270–275 |
| 9 | processCleanupTasks | Handles missing FileCleanupTask table gracefully | 277–283 |
| 10 | cross-tenant isolation | findEligibleAgents does not return other shops' agents | 287–302 |

**FIND-051 — What is NOT covered (VERIFIED by absence).**

- **`markDeliveryReceived` cross-tenant rejection is NOT tested** — the
  test 7 verifies "doesn't interpret receipt as completion" but not that
  an agent from shop B can't acknowledge a job from shop A.
- **`processCleanupTasks` happy path** (actual deletion of a real
  FileCleanupTask) is NOT tested — only the empty/missing-table graceful
  degradation. The actual delete-from-storage path is not exercised.
- **Cleanup grace period (15 min default)** is not asserted.
- **`markDeliveryReceived` with bad checksum / wrong fileSize** is not tested.
- **The HTTP routes that wrap these functions** (`/agents/jobs/[id]/received`,
  `/cron/cleanup`) are not exercised through the route handler.

## 4. Other 22 test files (234 tests) — summary

| File | Tests | What it covers | NOT covered |
|---|---:|---|---|
| `packages/core/src/pricing/pricing-engine.test.ts` | 35 | Rate resolution, breakdown math, edge cases | NOT VERIFIED — did not re-read |
| `src/lib/printlatch/printlatch.test.ts` | 20 | Printlatch client/protocol | NOT VERIFIED |
| `src/lib/auth/auth.test.ts` | 17 | JWT issue/verify, password hash, refresh rotation | NOT VERIFIED |
| `src/lib/payments/phonepe-v2-webhook.test.ts` | 16 | SHA auth, event handling, idempotency | NOT VERIFIED |
| `packages/adapters/src/storage/s3.adapter.test.ts` | 16 | S3 presigned URL generation | Real S3 endpoint NOT exercised |
| `src/lib/upload-lifecycle.test.ts` | 14 | Upload capability sign/verify, size limits | NOT VERIFIED |
| `src/lib/repositories/order-token-concurrency.test.ts` | 13 | Race-safe tokenNumber allocation under concurrent inserts | NOT VERIFIED |
| `packages/adapters/src/payment/upi-deeplink.adapter.test.ts` | 13 | UPI deep-link payload generation | NOT VERIFIED |
| `src/lib/repositories/repositories.test.ts` | 11 | Generic repository CRUD | NOT VERIFIED |
| `packages/adapters/src/cache/in-memory.adapter.test.ts` | 10 | Cache incr/expire/get/set | NOT VERIFIED |
| `src/lib/container.test.ts` | 8 | Container construction + provider selection | NOT VERIFIED |
| `src/lib/storage/capability.test.ts` | 7 | HMAC capability verification | NOT VERIFIED |
| `src/lib/payments/payments.test.ts` | 7 | Payment adapter dispatch | NOT VERIFIED |
| `packages/adapters/src/storage/r2.adapter.test.ts` | 7 | R2 presigned URL generation | Real R2 endpoint NOT exercised |
| `src/lib/payments/print-job-idempotency.test.ts` | 6 | PrintJob two-layer idempotency guard | NOT VERIFIED |
| `src/lib/crypto/credential-encryption.test.ts` | 6 | AES-GCM encrypt/decrypt of payment credentials | NOT VERIFIED |
| `src/lib/api/require-dev.test.ts` | 6 | `requireDev()` returns 404 unless NODE_ENV='development' | NOT VERIFIED |
| `src/lib/token-consistency.test.ts` | 5 | customerToken + tokenNumber allocation consistency | NOT VERIFIED |
| `src/lib/services/durable-queue.test.ts` | 5 | Durable queue job recovery | NOT VERIFIED |
| `src/lib/services/atomic-claim.test.ts` | 4 | Atomic claim (compare-and-set) | NOT VERIFIED |
| `src/lib/payments/webhook-audit.test.ts` | 4 | Webhook audit-log entry creation | NOT VERIFIED |
| `src/lib/db.test.ts` | 4 | Prisma client + isUniqueConstraintError | NOT VERIFIED |

## 5. Cross-cutting coverage gaps

**FIND-052 — E2E / Playwright (VERIFIED exists, NOT VERIFIED executed).**
`playwright.config.ts` exists at the repo root; `tests/smoke.spec.ts`
exists. These are NOT in the vitest include glob (`vitest.config.ts:21`)
so they run via a separate `playwright test` invocation. NOT VERIFIED —
did not run the playwright suite.

**FIND-053 — Coverage of the 70 API routes (VERIFIED).** Of 70 routes
under `src/app/api/v1`:
- ~7 are touched by `http-route-tests.test.ts` (mostly 401/403 cases).
- 0 are touched with happy-path POST/PUT/DELETE assertions.
- 0 admin routes are tested at the HTTP layer.
- 0 webhook routes are tested at the HTTP layer (service-layer only).
- 0 `withOrderAccess` customer-token routes are tested at the HTTP layer.

**Effective HTTP-layer route coverage: ~10% by route count, ~0% by write-path.**

**FIND-054 — Migration tests (VERIFIED existence).**
`scripts/postgres-integration.test.ts` exists — NOT in the vitest include
glob (scripts/ not in `src/` or `packages/`). Run via separate invocation.
`scripts/printjob-concurrency-harness.test.ts` and
`scripts/concurrency-harness.test.ts` similarly out-of-band.

**FIND-055 — No mutation/property tests.** All 276 tests are example-based
`it(...)` assertions; no property-based testing (fast-check, etc.) is in
use. NOT a gap per se but noted.

## 6. Honest summary

**What the suite does well:**
- Auth + entitlement middleware is exercised against real JWT issuance
  (`http-route-tests.test.ts`) — defends against the FIND-033 regression.
- Payment idempotency is tested at the service layer (3 separate files,
  26 tests total).
- Repository invariants (tokenNumber allocation, atomic claims) have
  dedicated concurrency tests.
- Adapter contracts (S3, R2, UPI) have isolated unit tests.

**What the suite does NOT cover (high-priority gaps):**
1. Write-path route handlers (POST/PUT/DELETE) — order creation, checkout,
   file upload, mark-paid, complete, cancel, register, login.
2. Webhook HTTP route — only the service layer is tested.
3. Admin routes — no HTTP-layer tests at all.
4. `withOrderAccess` customer-token happy path.
5. `withDeviceAuth` happy path (only 401 cases).
6. `rateLimit` function actual throttling at the boundary.
7. Cross-tenant isolation at the HTTP layer (only at the service layer
   in `delivery-coordinator.test.ts`).

**Recommended next actions (in priority order):**
1. Add POST happy-path tests for `/api/v1/auth/register`,
   `/api/v1/auth/login`, `/api/v1/shops/[slug]/orders`,
   `/api/v1/orders/[id]/checkout`.
2. Add a webhook HTTP-route test that exercises the full
   `processWebhook` pipeline with a signed payload.
3. Add admin-route tests (create shop, list orders cross-tenant,
   access-check with correct/wrong key).
4. Add a `withOrderAccess` happy-path test (valid `?t=` token → 200).
5. Add a `withDeviceAuth` happy-path test (valid device token → 200).
6. Add a `rateLimit` boundary test (n-th call throws `RateLimitError`).

---

*All file paths relative to `/home/z/my-project`. Test counts verified by
grep against source. "NOT VERIFIED" marks files I did not re-read in full
for this report — counts come from the `it()` grep in §0. No source code
was modified.*
