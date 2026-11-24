# Baseline Test Results — rebuild/clear-final

**Branch:** `rebuild/clear-final` · **Base commit:** `a5aeabd` (latest origin/main at task start)
**Run date:** 2026-11-24, 13:09–13:18 IST (07:39–07:48 UTC)
**Runner:** this VM (bun 1.4.4, node v24.22.1, Python 3.12.3, 1.5 shared CPUs)

> **Caveat — the tree was moving during the run.** Four other rebuild workers were
> editing the tree in parallel. At 07:39 UTC `git status` showed 16 modified files;
> by 07:42 it showed 27 modified + 4 new untracked files; by 07:47, 46 changed
> paths. A truly "unmodified base" baseline was therefore not achievable — the
> checks below ran against the live working tree, and two of the failures are
> demonstrably mid-edit parse errors in files other workers were touching (see
> Lint). Where a result is an environment limitation rather than a code defect,
> that is stated explicitly. Nothing was committed, stashed, reset, or checked
> out; no file under `src/**` was edited by this worker.

## 0. Commands run (exact)

```bash
cd /home/hatch/workspace/printshop-saas-clear
bun install                                   # 1042 packages installed [10.02s]
npx tsc --noEmit                              # run 1
npx prisma generate                           # 3 attempts, all failed (see §1)
npx tsc --noEmit                              # run 2 (after generate failed)
bun run lint                                  # run 1
bun run lint                                  # run 2 (re-run per mid-edit rule)
./node_modules/.bin/vitest run                # full default tier (187 s)
./node_modules/.bin/vitest run src/lib/security/idor.test.ts src/lib/container.test.ts
./node_modules/.bin/vitest run src/app/api/v1/cron/reconcile-payments/route.test.ts
npx playwright --version
npx playwright test --list --project=chromium   # (fails: no such project)
npx playwright test --list --project=mobile-360
```

No `.env` file existed in the repo at run start, and none was created.
`node_modules/` was absent at start (`bun install` created it; it is gitignored).

## 1. Results summary

| Check | Result | Counts |
|---|---|---|
| `npx tsc --noEmit` (run 1, 07:39:57 UTC) | **FAIL** | 3 errors, all `TS2305` |
| `npx tsc --noEmit` (run 2, 07:40:30 UTC) | **FAIL** | same 3 errors |
| `bun run lint` (run 1, 07:41:20 UTC) | **FAIL** | 1 error — parse error, `src/app/help/page.tsx:123:78` |
| `bun run lint` (run 2, 07:42:08 UTC) | **FAIL** | 1 error — parse error, different file: `src/app/download-app/download-app-client.tsx:134:25` |
| `bunx vitest run` (07:43:15 UTC, 187 s) | **FAIL** | 27 failed / 40 passed test files (67); **10 failed / 613 passed / 33 skipped tests (656)** |
| `npx playwright --version` | OK | Version 1.65.0 (see §5) |

### 1.1 TypeScript — FAIL, but the cause is environmental, not code

All 3 errors are identical in kind:

```
prisma/seed.ts(13,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
src/lib/adapters/prisma-database.adapter.ts(2,15): error TS2305: ... 'PrismaClient'.
src/lib/db.ts(1,10): error TS2305: ... 'PrismaClient'.
```

The generated Prisma client was never produced: `npx prisma generate` (3 attempts)
crashes with `Error: aborted … code: 'ECONNRESET'` while downloading the Prisma
engine binaries (the engine cache dir `~/.cache/prisma/master/<hash>/debian-openssl-3.0.x`
exists but is empty). The TLS connection to the engine host is reset in this
sandbox. CI runs `bunx prisma generate` before `tsc` (`.github/workflows/ci.yml`),
so on CI this step is expected to succeed — **the tsc failure is a blocker of this
sandbox, not evidence of a type error in the code**. Re-run `tsc` after a successful
`prisma generate` (on a machine/network where the engine download works) before
treating any tsc result as a code verdict.

Note: tsc did *not* report the mid-edit parse errors that lint found in
`help/page.tsx` / `download-app-client.tsx` — those files were in flux between
the tsc and lint runs, so tsc's clean-besides-Prisma result is also a snapshot
of a moving tree, not a guarantee.

### 1.2 ESLint — FAIL on both runs, both mid-edit parse errors

- **Run 1:** `src/app/help/page.tsx:123:78 — Parsing error: Unterminated string literal`
- **Run 2:** `src/app/download-app/download-app-client.tsx:134:25 — Parsing error: ')' expected`
  (the file at that moment contained an unclosed `{/* … */}` comment block
  inside `{qrUrl && ( …` — a worker was mid-edit)

Both files are modified in the working tree vs `HEAD` (`git show HEAD:…` shows
different content), and the failing file *changed between the two runs* — the
signature of parallel edits, not a committed defect. Per the task rule the check
was re-run once and both runs are recorded here. **Do not treat either lint
failure as a baseline defect; re-run lint once the tree is quiet.** No other
lint errors or warnings were reported in either run (eslint stops at the first
parse error, so further lint findings are unknown until the tree parses).

### 1.3 Vitest — FAIL: 27 failed files / 10 failed tests

Full run: `Test Files 27 failed | 40 passed (67)` ·
`Tests 10 failed | 613 passed | 33 skipped (656)` · duration 187.04 s.

Failure taxonomy (from `/tmp/baseline-vitest.log`, cleaned copy
`/tmp/baseline-vitest-clean.log` — logs are ephemeral, in `/tmp`, not committed):

**A. 25 failed suites (0 tests ran each) — missing generated Prisma client.**
Every sampled suite fails at collection with the same error, verified by
re-running two of them in isolation plus the error visible in the full log:

```
Error: Cannot find module '.prisma/client/default'
Require stack:
- …/node_modules/@prisma/client/default.js
```

Verified individually: `src/lib/container.test.ts`, `src/lib/security/idor.test.ts`,
`src/lib/services/durable-queue.test.ts`. The other 22 failed suites are
attributed to the same cause (they all transitively import `@prisma/client`
via `src/lib/db.ts` / the container), but were **not** individually re-run —
treat the attribution as strong but sampled, not exhaustive. Full list:

```
src/lib/container.test.ts
src/lib/token-consistency.test.ts
src/lib/api/cross-tenant-tests.test.ts
src/lib/api/http-route-tests.test.ts
src/lib/api/product-tenant-isolation.test.ts
src/lib/auth/auth.test.ts
src/lib/orders/order-flow.integration.test.ts
src/lib/payments/phonepe-v2-webhook.test.ts
src/lib/payments/print-job-idempotency.test.ts
src/lib/pipeline/pipeline.integration.test.ts
src/lib/pricing/price-file.test.ts
src/lib/repositories/order-token-concurrency.test.ts
src/lib/repositories/repositories.test.ts
src/lib/security/idor.test.ts
src/lib/security/order-token.test.ts
src/lib/security/payment-validation.test.ts
src/lib/security/pii-scan.test.ts
src/lib/security/retention.test.ts
src/lib/security/upload-validation.test.ts
src/lib/services/atomic-claim.test.ts
src/lib/services/delivery-coordinator.test.ts
src/lib/services/durable-queue.test.ts
src/lib/pricing/checkout-postgres-concurrency.test.ts        (see B)
src/lib/payments/payment-connection-loss-phase4.test.ts       (see B)
src/lib/payments/payment-webhook-concurrency-phase3.test.ts   (see B)
```

(25 suites = the 22 above + the 3 in group B. 27 failed files total = 25 suites
+ `payment-event-persistence.test.ts` + `reconcile-payments/route.test.ts`.)

**B. 3 suites need a real PostgreSQL server that is not running here.**
`payment-connection-loss-phase4` and `payment-webhook-concurrency-phase3` fail
with `Error: connect ECONNREFUSED 127.0.0.1:5433`; `checkout-postgres-concurrency`
fails with `Error: Hook timed out in 10000ms` in `beforeAll` (same cause — it
waits on the absent DB). These suites expect the local trust-auth cluster
(`phb_p3`/`phb_p4` on `127.0.0.1:5433`, see `.env.example` `TEST_DATABASE_URL`).
No Postgres was running on this VM. CI provisions that DB before the postgres
tier; the default-tier exclusion list in `vitest.config.ts` covers 5 other
real-Postgres files but **not** these three, so they fail in a plain
`bunx vitest run` on any machine without the local cluster. This is a
pre-existing environment/tiering gap, not a rebuild regression.

**C. 9 failed tests in `src/lib/payments/payment-event-persistence.test.ts` —
PGlite `beforeEach` hook timeout.**
A1, A3, A6 (Part A) and B1, B2, B3, B6, B7, B8 (Part B) all fail with
`Error: Hook timed out in 10000ms` at `beforeEach` (fresh PGlite instance per
test). PGlite is in-memory, so no external DB is involved; the likely cause is
CPU starvation on this 1.5-CPU VM (vitest spawned 67 workers, one per file).
**Needs a re-check on a less loaded runner before calling it a code defect.**

**D. 1 genuine, reproducible test failure —
`src/app/api/v1/cron/reconcile-payments/route.test.ts`.**
Test 6, "overlapping invocations do not double-process (concurrent cron
calls)": `AssertionError: expected 500 to be 200` — the first concurrent call
returns 200, the second returns 500 (`route.test.ts:394`). Reproduced in
isolation (single-file run, 8 s, same failure; the file's other 8 tests pass),
so this is **not** caused by the missing Prisma client or by load. This is the
one baseline failure that looks like a real code defect and should be
re-checked after the rebuild.

## 2. How to run the app locally for E2E (memory providers, test shop)

No production credentials are involved anywhere below. There was **no `.env`
file** in the repo at baseline time; the procedure below uses only dev/test
values. **Never point `DATABASE_URL` at the production Supabase project and
never run any seed against the live site.**

### 2.1 Minimal dev run (in-memory everything — the Playwright default)

`src/lib/container.ts` is the composition root. The relevant defaults:

- `DATABASE_PROVIDER` — default `prisma`, **but** in non-production, if
  `DATABASE_URL` is missing or not a `postgresql://` URL, the container logs a
  warning and **falls back to `InMemoryDatabaseAdapter`** (`container.ts:284-299`).
  Set `DATABASE_PROVIDER=memory` explicitly to silence the warning.
- `STORAGE_PROVIDER` — default `memory` (`InMemoryStorageAdapter`).
  `memory` is refused only in production (`container.ts:105-110`).
- `CACHE_PROVIDER` / `REALTIME_PROVIDER` — default `memory`.
- Secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REALTIME_EMIT_SECRET`)
  fall back to dev defaults outside production; `PAYMENT_ENCRYPTION_KEY`
  missing → warning + dev fallback key. `DEVICE_TOKEN_PEPPER` falls back to
  the legacy pepper in dev/test.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are **not needed** when
  `STORAGE_PROVIDER=memory` (or `local`).

Exact steps:

```bash
cd /home/hatch/workspace/printshop-saas-clear
bun install
# Optional: cp .env.example .env   (only needed if you want to override defaults;
#                                   with no .env at all the app still boots on memory providers)
DATABASE_PROVIDER=memory STORAGE_PROVIDER=memory bun run dev
# → http://localhost:3000  (package.json "dev": next dev -p 3000)
```

This is exactly what `playwright.config.ts` does for E2E (`webServer.command:
'DATABASE_PROVIDER=memory bun run dev'`, port 3000, `reuseExistingServer: true`).
**Caveat:** in-memory state lives in the dev-server process; restarting the
server wipes shops, orders, and uploaded files. Uploads go to the in-memory
storage adapter, which is sufficient for the upload pipeline E2E (presign →
chunk PUT → complete → page-count parse).

### 2.2 Seeding a TEST shop (never the real Arjun shop)

Use the dev-only seed endpoint — it creates **demo shops only**:

```bash
# With the memory dev server running (step 2.1):
curl -s http://localhost:3000/api/v1/dev/seed
# or POST the same URL; GET is accepted as a convenience.
```

- Route: `src/app/api/v1/dev/seed/route.ts` → `seedDemoData()`
  (`src/lib/services/seed.service.ts`). Idempotent — safe to re-run.
- **Gated by `requireDev()`** (`src/lib/api/require-dev.ts`): returns 404 unless
  `NODE_ENV=development`. It cannot run against production.
- Creates three demo shops (all with default pricing config, UPI deep-link
  payment, demo payment credentials):
  - `quickprint` — QuickPrint Demo Shop — owner `owner@quickprint.demo`
  - `copycenter` — CopyCenter — owner `owner@copycenter.demo`
  - `prinithub` — PrintHub Express — owner `owner@prinithub.demo`
  - plus admin `admin@printshop.demo`
- Demo password for all demo accounts is `demo1234` (documented in the login
  page's dev-only "Demo accounts" panel and `src/app/shop/login/page.tsx:91`;
  deliberately **not** returned by the seed API response).
- Customer flow URL after seeding: `http://localhost:3000/s/quickprint`
  (the E2E specs use the homepage "Discover print shops" section and click
  the first "Visit shop" card — `tests/consumer-journey.spec.ts:74-88`).
- Shopkeeper login: `http://localhost:3000/shop/login` with
  `owner@quickprint.demo` / `demo1234`.

### 2.3 Full Postgres seed (only against a LOCAL Postgres, never production)

`bun prisma/seed.ts` (`prisma/seed.ts`, script `db:seed`) requires a real
PostgreSQL `DATABASE_URL` (it uses `PrismaClient` directly, so it also needs a
successful `prisma generate` first — blocked in this sandbox, see §1.1).
It creates two **different** test shops, idempotently (deletes prior seed data
for those slugs first):

- `sai-xerox` — Shri Sai Xerox — owner `owner@sai-xerox.test` / `Shop@123`
- `ganesh-digital` — Ganesh Digital Studio — owner `owner@ganesh-digital.test` / `Shop@123`

each with 3 printers, price rules, add-ons, and 15 sample orders across the
status machine. **Do not run this with the production `DATABASE_URL`.**
For E2E upload testing the memory seed in §2.2 is the intended path; the
Prisma seed is for exercising the dashboard/orders board with populated data.

### 2.4 Env vars required, by mode

| Variable | Memory dev (§2.1) | Real local Postgres + Supabase storage |
|---|---|---|
| `DATABASE_URL` | not needed (fallback to memory) | required, `postgresql://…` local DB |
| `DATABASE_PROVIDER` | `memory` (recommended) | `prisma` (default) |
| `STORAGE_PROVIDER` | `memory` (default) | `supabase` (+ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=printshop-uploads`); or `local` (+ `STORAGE_LOCAL_DIR=./storage-data`) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | optional (dev defaults) | required for real auth |
| `PAYMENT_ENCRYPTION_KEY` | optional (dev fallback) | required (32-byte base64) |
| `APP_BASE_URL` | defaults to localhost | set to the dev URL for QR/payment callbacks |
| `CRON_SECRET` | not needed locally | only for `/api/v1/cron/*` |
| `DEVICE_TOKEN_PEPPER` | optional in dev | required in production |

Production env (Vercel + Supabase) is documented in `docs/DEPLOYMENT_RUNBOOK.md`
§2 — read-only reference; do not copy production values into a local `.env`.

## 3. Test PDF fixtures

### 3.1 New fixture (created by this worker)

- **`tests/fixtures/test-1page.pdf`** — 1,064 bytes, genuine PDF 1.7, **1 page**,
  A4 (595 × 842 pt), text "PrintShop E2E Fixture — 1 page / Page 1 of 1".
  Generated with `pdf-lib` (already a repo dependency) via a throwaway script
  in `/tmp/gen-test-1page.ts` (not committed). Verified by re-loading with
  pdf-lib: `getPageCount() === 1`, page size 595×842; `file` reports
  `PDF document, version 1.7`, trailer ends `%%EOF`. Use it for single-page
  upload-pipeline E2E (init → chunk PUT → complete → page-count parse).
  **Note: `*.pdf` is gitignored (`.gitignore:55`, "Test fixtures generated on
  demand"), so this fixture will not be committed by a normal `git add` — it
  must be force-added (`git add -f`) or regenerated on each checkout, exactly
  like the existing `sample-3-page.pdf` (see §3.2).**

### 3.2 Existing fixtures / generators already in the repo

- **`tests/fixtures/generate-pdf.ts`** — generator script (committed) that
  writes `tests/fixtures/sample-3-page.pdf` (3 pages, "Page N of 3", A4) via
  pdf-lib; run with `bun run tests/fixtures/generate-pdf.ts`. **Note: the
  generated `sample-3-page.pdf` itself is NOT in the repo** — `git ls-files
  tests/fixtures/` lists only `generate-pdf.ts` (the PDF is gitignored or was
  never committed). Regenerate it before running the consumer-journey E2E.
  Used by `tests/consumer-journey.spec.ts:511` and `tests/_debug-pdf.spec.ts:35`.
- **`src/lib/pipeline/fixtures/sample.docx`** — committed DOCX fixture used by
  `src/lib/pipeline/pipeline.integration.test.ts:124` (DOCX → PDF normalization
  path). No PDF equivalent exists there.
- No other PDF fixtures exist under `tests/` or `src/`.

## 4. Playwright / headless Chromium availability

- **Playwright is installed:** `@playwright/test@1.65.0` (devDependency);
  `npx playwright --version` → `Version 1.65.0`.
- **Headless Chromium is available:** browser binaries cached at
  `~/.cache/ms-playwright/` — `chromium-1255`, `chromium_headless_shell-1255`,
  `ffmpeg-1013`. (Matches the AGENTS.md note of Playwright Chromium
  158.0.8127.18; the on-disk build here is the 1255 revision.)
- **Config:** `playwright.config.ts` — `testDir: ./tests`, `baseURL:
  http://localhost:3000`, webServer `DATABASE_PROVIDER=memory bun run dev`
  (port 3000, `reuseExistingServer: true`), 3 projects: `mobile-360`
  (360×800, Pixel 5), `mobile-390` (390×844, iPhone 14), `mobile-412`
  (412×915). Screenshot on failure, video retained on failure, trace on
  first retry.
- **⚠️ `bun run test:e2e` is currently broken:** package.json defines
  `"test:e2e": "playwright test --project=chromium"`, but **no project named
  `chromium` exists** in the config. Verified:
  `Error: Project(s) "chromium" not found. Available projects: "mobile-360",
  "mobile-390", "mobile-412"`. Use `--project=mobile-360` (which is also what
  `test:audit` uses) until the script or the config is aligned.
- **Minor:** `npx playwright test --list --project=mobile-360` printed a load
  error for `tests/security/security.test.ts:1:1` and listed `Total: 0 tests` —
  Playwright's `testDir: ./tests` picks up vitest `*.test.ts` files alongside
  the `*.spec.ts` E2E files. Worth a config cleanup (restrict `testMatch` to
  `*.spec.ts`), but it does not block running the `*.spec.ts` suites.

## 5. What still needs a re-run (after the tree is quiet / env fixed)

1. `npx prisma generate` on a network where the Prisma engine download works,
   then `npx tsc --noEmit` and the full `bunx vitest run` — expected to clear
   the 3 tsc errors and the 25 failed suites (group A, §1.3).
2. `bun run lint` once no worker is mid-edit.
3. The 9 PGlite hook-timeout failures in `payment-event-persistence.test.ts`
   (§1.3 C) on a less loaded runner.
4. The 3 real-Postgres suites (§1.3 B) with the local `127.0.0.1:5433`
   cluster provisioned (`bunx prisma db push --skip-generate` per CI) or via
   `bun run test:postgres`.
5. The genuine `reconcile-payments` concurrent-cron failure (§1.3 D) — needs
   a code look, not just a re-run.
6. E2E smoke (`tests/smoke-public.spec.ts`, `tests/consumer-journey.spec.ts`)
   against the memory dev server + `POST /api/v1/dev/seed` + the new
   `tests/fixtures/test-1page.pdf` — not run in this baseline (no dev server
   was started; the task was baseline checks + harness, and the tree was
   mid-edit throughout).
