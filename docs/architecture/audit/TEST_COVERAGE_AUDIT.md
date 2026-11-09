# TEST_COVERAGE_AUDIT

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

Documents the test surface of PrintShop SaaS. Test counts are
VERIFIED by running `npx vitest run` against the actual repository
(output captured to `.vitest/json/output.json` and parsed).

**Evidence labels**
- **VERIFIED** — auditor ran the test or read the file during this pass.
- **CI-VERIFIED** — test runs in `.github/workflows/ci.yml` (the
  auditor did NOT re-run it, but CI does on every push).
- **IMPLEMENTED** — the test file exists (confirmed by `Glob`); not
  necessarily exhaustive on its assertions.
- **BLOCKED** — would require external state (a real DB, a PrintEXE
  binary, a running Windows machine) that's not available in this sandbox.
- **NOT VERIFIED** — no test exists for this concern.

---

## 1. Headline numbers

| Metric | Value | Evidence |
|---|---|---|
| Test files (vitest) | 23 | `vitest.config.ts:21` includes `packages/**/*.test.ts` + `src/**/*.test.ts`; 23 matched |
| Test cases | 244 | `npx vitest run` → `Tests 244 passed (244)` (auditor re-ran in this pass) |
| Pass rate | 100% (244/244) | same |
| Suite duration | 8.4 s | same |
| Playwright spec files | 1 (`tests/smoke.spec.ts`) | `Glob` of `tests/*.spec.ts` |
| Manual harness scripts | 3 (`scripts/*.test.ts`) | `Glob` — NOT included by `vitest.config.ts` |

> FIND-031 (P2): `vitest.config.ts:21` includes only `packages/**` and
> `src/**` test files. The 3 `scripts/*.test.ts` harnesses
> (`postgres-integration`, `concurrency-harness`,
> `printjob-concurrency-harness`) and `tests/smoke.spec.ts` are
> **excluded from `vitest run`** and from CI. They are standalone
> manual-run scripts. CI therefore reports "244 passed" but does NOT
> run the integration / concurrency / smoke tests.

## 2. Per-file test inventory

### 2.1 Packages (5 files, 81 tests)

| File | Tests | Covers | Doesn't cover |
|---|---|---|---|
| `packages/core/src/pricing/pricing-engine.test.ts` | 35 | per-page pricing, color/duplex multipliers, page-range subset pricing, min-order value, currency formatting | tax/GST (not yet implemented in pricing engine) |
| `packages/adapters/src/storage/s3.adapter.test.ts` | 16 | S3 presign round-trip, key validation, content-type, error mapping | actual AWS S3 calls (mocked), multipart upload |
| `packages/adapters/src/payment/upi-deeplink.adapter.test.ts` | 13 | UPI deep-link URL construction, payee vpa, amount encoding, note field, intent URI | real UPI app invocation (cannot test server-side) |
| `packages/adapters/src/storage/r2.adapter.test.ts` | 7 | R2 presign, account-id endpoint construction | actual Cloudflare R2 calls (mocked) |
| `packages/adapters/src/cache/in-memory.adapter.test.ts` | 10 | incr/expire semantics, key eviction, TTL boundary | concurrent incr race (single-threaded env) |

### 2.2 `src/lib/` (18 files, 163 tests)

| File | Tests | Covers | Doesn't cover |
|---|---|---|---|
| `src/lib/printlatch/printlatch.test.ts` | 20 | PrintLatch client ↔ local agent HTTP protocol, retry, timeout, error mapping | actual Windows printer (loopback HTTP only) |
| `src/lib/auth/auth.test.ts` | 17 | JWT issue/verify, PBKDF2 hash/verify, refresh rotation, stale shopId rejection | argon2id (not yet implemented), token revocation list |
| `src/lib/upload-lifecycle.test.ts` | 14 | upload-url → confirm → price flow, page-count parsing, mime validation | actual Supabase/R2 upload (in-memory adapter) |
| `src/lib/repositories/order-token-concurrency.test.ts` | 13 | concurrent order-token generation uniqueness, race conditions | DB-level concurrent INSERT (mocked) |
| `src/lib/payments/phonepe-v2-webhook.test.ts` | 16 | v2 SHA-auth webhook parsing, signature validation, dedup, fail-closed | v1 X-VERIFY format (covered separately) |
| `src/lib/repositories/repositories.test.ts` | 11 | in-memory repository CRUD, tenant scoping, audit log | Prisma adapter behavior |
| `src/lib/container.test.ts` | 8 | production fail-fast for missing secrets, storage provider validation, encryption key validation | actual container behavior in production (env-mocked) |
| `src/lib/services/delivery-coordinator.test.ts` | 10 | delivery attempt state machine, receipt marking, cleanup scheduling | actual file deletion (mocked storage) |
| `src/lib/payments/payments.test.ts` | 7 | UPI checkout intent creation, payment attempt persistence | PhonePe/Paytm provider webhooks (separate files) |
| `src/lib/storage/capability.test.ts` | 7 | HMAC capability signing/verification, expiry, key format | actual PUT to S3/R2 (mocked) |
| `src/lib/token-consistency.test.ts` | 5 | order token uniqueness across rapid creation, JWT-shopId consistency | refresh-token rotation race |
| `src/lib/services/durable-queue.test.ts` | 5 | stale job recovery, queue ordering, retry backoff | concurrent worker claim (separate file) |
| `src/lib/payments/print-job-idempotency.test.ts` | 6 | partial unique index behavior, duplicate job rejection | DB-level enforcement (mocked) |
| `src/lib/api/require-dev.test.ts` | 6 | requireDev() returns 404 in production, passthrough in dev | other api/with-auth guards |
| `src/lib/crypto/credential-encryption.test.ts` | 6 | AES-256-GCM encrypt/decrypt round-trip, key validation, tamper detection | actual key rotation |
| `src/lib/payments/webhook-audit.test.ts` | 4 | webhook event persistence, dedup via (provider, eventId) | multi-provider routing |
| `src/lib/services/atomic-claim.test.ts` | 4 | atomic job claim via conditional UPDATE, first-claim-wins | DB-level row-level locking |
| `src/lib/db.test.ts` | 4 | PrismaClient singleton, query logging config | actual DB connection (in-memory mock) |

> FIND-032 (P2): `src/lib/db.test.ts:4 tests` — the test file exists
> but the audit did NOT inspect its assertions in detail. The
> 4-test count is VERIFIED via the JSON reporter; the **content
> quality** of those 4 tests is IMPLEMENTED but not deeply audited.

## 3. Coverage gaps (NOT VERIFIED)

### 3.1 No route-handler tests in `src/app/`

`Glob` of `src/app/api/**\*.test.ts` returns **zero** matches. None of
the 70 API route handlers have a co-located or sibling test file. The
guards (`withAuth`, `withDeviceAuth`, `withOrderAccess`, `withRateLimit`)
are tested only indirectly through the repository / service tests.

| Gap | Severity | Why it matters |
|---|---|---|
| No `/api/v1/auth/*` route tests | P1 | login/register/refresh are the auth boundary; a regression in `withAuth` or the inline `rateLimit` call would not be caught |
| No `/api/v1/orders/:id/*` route tests | P1 | the SEC-001 IDOR fix lives in `withOrderAccess`; only the helper's unit logic is tested, not its wiring into routes |
| No `/api/v1/admin/*` route tests | P2 | admin RBAC (`['admin']` allowedRoles) is not asserted in any test |
| No `/api/v1/shops/me/*` route tests | P2 | 24 owner-facing routes have zero direct test coverage |
| No `/api/v1/agents/*` or `/api/v1/sync/*` route tests | P2 | device-token flow not exercised end-to-end |
| No `/api/v1/payments/phonepe/webhook` route test | P1 | the v2 detector (`isV2` regex) is in the route file, not the tested `phonepe-v2-webhook.ts` module |

> FIND-033 (P0): Zero tests in `src/app/api/`. The 244 tests cover
> pure-function modules (pricing, repositories, services, adapters,
> auth helper) but **no route handler is tested**. The withAuth /
> withOrderAccess / withRateLimit wrappers are tested only as
> exported functions, not as they are actually wired into routes.
> A regression like "forget to wrap a new route in withAuth" would
> not be caught. CI passes 244/244 but the most security-critical
> code (route guards) is unverified.

### 3.2 No PrintEXE integration tests

The PrintEXE Windows desktop client (`github.com/Arjunyadvsoma/PrintEXE`,
private — see REPOSITORY_INVENTORY §2) has zero integration tests
against the SaaS backend. The sync protocol
(`docs/SYNC_PROTOCOL.md`) is documented but not exercised.

| Gap | Severity |
|---|---|
| No PrintEXE ↔ SaaS sync round-trip test | P1 |
| No PrintEXE device-token auth flow test | P1 |
| No PrintEXE → `/agents/jobs/pending` → `/agents/jobs/:id/status` lifecycle test | P1 |
| No PrintEXE → `/sync/pull` / `/sync/push` round-trip test | P2 |

> FIND-034 (P1): BLOCKED — PrintEXE is private and unverifiable. Even
> if it were public, it requires Windows + .NET 10 to compile. The
> SaaS-side sync endpoints (`/api/v1/sync/*`) are covered by guard
> tests but not by end-to-end tests against a real PrintEXE build.

### 3.3 No E2E tests for authenticated workflows

`tests/smoke.spec.ts` exists (Playwright), but `playwright.config.ts`
configures it as a single smoke spec — there are no E2E tests for:

| Workflow | Tested? |
|---|---|
| Shopkeeper register → dashboard → create agent → print | NOT VERIFIED |
| Customer `/shops/:slug` → create order → upload file → checkout → poll status | NOT VERIFIED |
| Admin login (with `?key=`) → orders list → shop detail | NOT VERIFIED |
| PhonePe webhook → order paid → agent job dispatched → completed | NOT VERIFIED |
| Order token brute force (403 vs 404) | NOT VERIFIED |

> FIND-035 (P1): `tests/smoke.spec.ts` is the only Playwright spec
> file. The CI workflow (`.github/workflows/ci.yml`) does NOT run
> Playwright — only vitest. So even the smoke spec is NOT
> CI-VERIFIED. It must be run manually.

### 3.4 No WCAG / a11y tests

No axe-core, no pa11y, no `@axe-core/playwright` dependency in
`package.json`. The shadcn/ui components are a11y-friendly by default
(Radix UI primitives), but no automated assertion enforces it.

> FIND-036 (P2): No WCAG 2.1 AA conformance tests. For an Indian
> print-shop SaaS targeting shopkeepers + customers on mobile, a11y
> regressions (color contrast, focus traps, ARIA roles) would go
> unnoticed.

### 3.5 No load / soak tests in CI

`load-test.js` and `scripts/printjob-concurrent-worker.ts` exist but
are not run in CI. They are manual stress-test scripts.

> FIND-037 (P3): Load tests exist as scripts but are NOT in CI. The
> `scripts/concurrent-worker.ts` harness has a sibling test
> (`concurrency-harness.test.ts`) that is also excluded from
> `vitest.config.ts` (FIND-031).

## 4. What IS well-tested

The unit-test coverage is genuinely strong for the **pure-function
core**:

- **Pricing engine**: 35 tests, covers every pricing dimension
  (page count, color, duplex, paper size, page range, min order).
- **Auth**: 17 tests, covers JWT issue/verify/rotate, PBKDF2, stale
  shopId rejection.
- **PrintLatch protocol**: 20 tests, covers the local-agent HTTP
  protocol exhaustively.
- **Payment webhooks**: 16 tests for PhonePe v2 + 4 for webhook audit +
  7 for payment flow + 6 for idempotency = 33 payment-related tests.
- **Upload lifecycle**: 14 tests, covers the confirm-and-price flow.
- **Repository tenant scoping**: 13 tests for order-token concurrency
  + 11 for general repository behavior = 24 repository tests.
- **Container fail-fast**: 8 tests for production-validation paths.

## 5. CI-VERIFIED claims

Per `.github/workflows/ci.yml`, every push to `main` runs:
1. `bunx prisma generate` — CI-VERIFIED
2. `bash scripts/check-route-conflicts.sh` — CI-VERIFIED
3. `npx tsc --noEmit` — CI-VERIFIED (TypeScript clean per audit context)
4. `bun run lint` — CI-VERIFIED (ESLint clean per audit context)
5. `bunx vitest run` — CI-VERIFIED (244/244 pass per auditor's re-run)

The `.github/workflows/cleanup-cron.yml` cron is also CI-VERIFIED to
fire every 5 minutes (it's a GitHub Actions schedule, not a Vercel
cron — see PORTABILITY_AUDIT).

## 6. Summary

| Aspect | Status |
|---|---|
| Unit tests for pure-function modules | VERIFIED (244 tests, 23 files, all pass) |
| Route handler tests | **NOT VERIFIED** (zero test files in `src/app/api/`) — FIND-033 |
| PrintEXE integration | **BLOCKED** (private repo, Windows-only) — FIND-034 |
| E2E authenticated workflows | **NOT VERIFIED** (1 Playwright smoke spec, not in CI) — FIND-035 |
| WCAG / a11y | **NOT VERIFIED** (no axe-core dependency) — FIND-036 |
| Load / soak in CI | **NOT VERIFIED** (scripts exist but not wired) — FIND-037 |
| TypeScript clean | CI-VERIFIED |
| ESLint clean | CI-VERIFIED |
| Route-conflict check | CI-VERIFIED (`scripts/check-route-conflicts.sh`) |

The strongest recommendation from this audit is **FIND-033 (P0): add
at least one co-located test per route handler** that asserts (a) the
guard is applied and (b) the happy-path 200 + the unauthorized 401/
403. Even a thin "smoke" test per route would close the largest gap.
