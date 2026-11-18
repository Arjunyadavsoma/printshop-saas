# Phase 3 — Critical Repairs Report

Branches: `phase3-critical-repairs` (both repos). No merges to `main`. No production changes.

## A. Repository state and verification

| Repo | Branch | Phase 2 tip (verified) | Final commit | Working tree |
|---|---|---|---|---|
| printshop-saas | phase3-critical-repairs | 522e439 | see §H | clean |
| PrintEXE | phase3-critical-repairs | c958bd6 | see §H | clean |

- Remote state verified before any modification: both `phase2-release-verification`
  branches pointed at the expected Phase 2 commits; ancestry inspected.
- **No cross-contamination**: SaaS history root `fcbfb99…`, PrintEXE root
  `dcf8678…` — unrelated histories, each phase branch is pure lineage. The
  Phase 2 wrong-repository push incident left no residue (the branch it
  created was deleted seconds later; verified via branch listing).
- Working trees clean at start; no user work present or overwritten.
- Every push followed the §12 checklist (`rev-parse --show-toplevel`,
  `remote -v`, `status`, `log -5`) and was verified by re-fetching the
  remote branch tip.
- CI history: PrintEXE `main` still red at `6fbf87d` (stale test fakes —
  fixed on the integration branches); no `phase3-critical-repairs` runs.

## B. P2-2 — Payment webhook idempotency (root cause + fix)

**Root cause (traced through the full lifecycle before any change):**
`applyPaymentTransition` (src/lib/payments/lifecycle.service.ts) ran its
interactive transaction at `Serializable` isolation. Two concurrent
duplicate webhook deliveries both read the attempt/order and then write — a
SSI read-write conflict. PostgreSQL aborts the loser (and in interleaved
single-session runs, both) at COMMIT with SQLSTATE 40001 instead of losing
the INSERT race with 23505, so the deliberate unique-arbitration path never
fires → **zero financial effects for one real payment**.

**Fix:** `ReadCommitted` + the database-level arbitration that was already
implemented but being bypassed:
1. `PaymentEvent UNIQUE([provider, eventId])` — duplicate INSERT fails with
   23505 → caught → idempotent skip (exactly one event row wins).
2. `PaymentAttempt` conditional `updateMany` (status IN created/pending).
3. `Order` conditional `updateMany` (status = awaiting_payment; paymentTxnId
   UNIQUE as a second belt).
A rolled-back winner leaves no event row → the provider's retry re-processes
safely. No app-level check-then-insert on financial effects; no global lock.

**Concurrency evidence (real PostgreSQL 16.2, independent connections):**
- NEW `payment-webhook-concurrency-phase3.test.ts` — 16 scenarios:
  single event; sequential duplicate; **2 and 10 concurrent duplicates**;
  concurrent different events same payment; concurrent events different
  payments; transaction failure; failure after claim; failure during final
  update; retry after rollback; invalid signature; amount mismatch; unknown
  payment reference; old-event replay vs newer state; refunded; captured.
  **16/16 pass**; `financial_effect_count = 1` asserted exactly in every
  duplicate scenario; exact DB state asserted after each.
- `app-webhook-integration.test.ts` (real `processWebhook` +
  `applyPaymentTransition` via real Prisma): **15/15 pass** with the fix.
- `payment-event-persistence.test.ts` (PGlite): 13 pass + B4 converted to a
  **documented skip** — PGlite is a single-session database and structurally
  cannot represent concurrent transactions; the two real-PG suites are the
  concurrency oracles.
- Test-fixture defect fixed on the way (P3-F1): `checkout-real-postgres`
  scenario 12 seeded `customerToken TOK1` colliding with `cleanAndSeed`'s
  `TOK1` → `ON CONFLICT DO NOTHING` silently dropped one order → its attempt
  failed FK 23503 (19/20). Renamed to `TOKb*` → **12/12**. (Corrects the
  Phase 2 attribution of this failure to the environment.)
- `app-checkout-concurrency.test.ts` fixture updated for current
  fail-closed pricing (verified page count + valid `bw_a4_per_page` rate
  consistent with the asserted amount) → **1/1**.

## C. P2-3 — Operator-resolution UI (implemented)

- `GET /shops/me/jobs` rows extended with `deviceName`, `devicePrinterName`,
  `queuedAt` (printer/delivery evidence; shop-scoped by JWT).
- NEW `/shop/print-jobs` page (shop portal nav: "Print Jobs"):
  - Distinct `Needs review` state (amber ring) — never conflated with
    completed/failed; per-status badges for queued/downloaded/printing/
    completed/failed/needs_review/cancelled.
  - Shows job id, document name, device, selected printer, submission/
    started/finished times, attempts, uncertainty reason.
  - Resolution: confirm dialog → `POST /shops/me/jobs/{id}/resolve` →
    success notice with the recorded operator + timestamp → list refreshed
    from the server (survives reload; backend stays authoritative).
  - Backend rejection surfaces as an error (409 JOB_NOT_IN_NEEDS_REVIEW →
    "state changed — refreshed"); the UI never reports success on rejection.
  - Loading / empty / error+retry states; responsive single-column on phones.
- **Live verification on the production build: 17/17 checks**
  (scripts/phase1/phase3_ui_contract.js): listing, both-direction shop
  isolation, rival resolve 404, resolve-on-queued 409, resolution with
  actor+timestamp, duplicate 409, survives refresh, audit row with
  `userId` + outcome + timestamp, and the P2-1 live checks below.
- No automatic retry/reprint path exists; resolution is terminal.

## D. P2-1 — Pending-jobs endpoint and storage failure (fixed)

- Root cause of the Phase 2 500: `getPresignedDownloadUrl` threw under
  `STORAGE_PROVIDER=disabled` and the exception propagated uncaught.
- New behavior (route rewritten): each job prepared independently.
  - `STORAGE_UNAVAILABLE` → machine-readable `503` with
    `error.details.failedJobs[]` and `retryable: true`; provider internals
    logged server-side only, never in responses.
  - `DOCUMENT_MISSING` / `JOB_INVALID` → `200` with `failedJobs[]`.
  - Healthy jobs still returned (one bad document never corrupts others).
  - Failed jobs stay **queued** — retried automatically once storage
    recovers; nothing is consumed.
- Tests: NEW `pending-jobs-storage.test.ts` — 6/6 (happy path, 503
  classification + no-leak assertion, partial failure isolation, document
  missing, missing storageKey, genuinely empty queue).
- **Live**: on the Phase 3 staging build with `STORAGE_PROVIDER=disabled`,
  the device poll returned 503 STORAGE_UNAVAILABLE with failedJobs details
  and the job remained queued (17/17 run, checks marked P2-1 live).

## E. Command durability + crash recovery (verified)

Code review of `CommandPoller` / `DurableCommandStore` (PrintEXE):
- `claimed` (handler never started) → recovered to `received` on restart and
  re-executed (safe — no side effect possible yet).
- `executing` (handler started) → recovered to `outcome_unknown` on restart,
  re-reported to the SaaS, **never re-executed**.
- Durable store survives restart; the dedup fast-path cache is explicitly
  non-durable. Atomic claiming via SQLite transactions + `busy_timeout`.
- Covered by `DurableCommandStoreTests` (Queue.Tests) and the job-side
  guards in `JobProcessor` (skipped:true classification, OutcomeUnknown
  parking). Windows test EXECUTION remains gated on CI (§G).

## F. Realtime + polling (code-level verified; live relay blocked)

- Device realtime credential: `POST /agents/token` exchanges the permanent
  device token for a short-lived (15-min) JWT — the permanent token never
  authenticates sockets. Verified in code and by existing tests.
- Relay (`mini-services/realtime-service`): HS256 verification (timing-safe,
  exp + type checked), rooms strictly `shop:<shopId>` from verified claims,
  `/emit` relay secret-guarded with `shop:`-prefix enforcement.
- REST polling is authoritative for devices and verified live (commands +
  jobs polls on staging with REALTIME_PROVIDER=memory).
- Live relay deployment remains blocked (no host/credentials) — code-level
  verification only; documented as such, not claimed as live.

## G. Windows CI (attempted; blocked by permissions)

- `phase3-critical-repairs` pushed to PrintEXE (tip = c958bd6 + docs).
- Workflow dispatch POST → **403 "Resource not accessible by personal access
  token"** (fine-grained PAT lacks `actions:write`).
- Maintainer instructions (unchanged from Phase 2):
  - Repository `Arjunyadavsoma/PrintEXE`, branch `phase3-critical-repairs`,
    workflow `.github/workflows/build-windows.yml`.
  - Option A: token with **Actions: Read and write** → dispatch the workflow
    on the branch. Option B: open a PR `phase3-critical-repairs` → `main`
    (triggers the workflow; do not merge before review).
- Local validation: `dotnet build PrintShopCompanion.sln -c Release` →
  **0 errors** (includes the Phase 2 Windows-runtime test suite).

## H. Staging (local production build; Vercel blocked)

- Vercel: no credentials in this environment → not deployed; documented.
- Local staging: production `next build` (exit 0) + `next start`, real
  PostgreSQL, `STORAGE_PROVIDER=disabled` (production-legal no-credentials
  mode; memory storage is fail-fast-forbidden in production by design).
- Results: 17/17 Phase 3 UI-contract + P2-1 live checks; Phase 2's 33-check
  regression scenario set remains green against this branch's code paths
  (jobs listing/resolution/rotation/isolation re-verified in the 17-check
  run where overlapping).
- Health note discovered: with `STORAGE_PROVIDER=memory` the container
  fail-fasts by design in production — correct behavior, kept.

## I. Security review (Phase 3 changes)

- Cross-shop access / IDOR: jobs listing + resolution shop-scoped from the
  verified JWT (`claims.shopId`), never client input — verified live
  (rival shop: own-jobs only; rival resolve 404).
- Payment replay: unique-arbitration + conditional guards (§B) — old-event
  replay and terminal-state events rejected; no regression of newer states.
- Webhook signature: verified BEFORE any state change (invalid signature
  test 11 applies zero effects).
- Rate limiting: register brute-force guard observed LIVE during testing
  (429 RATE_LIMITED 5/60s) — working as designed.
- Command injection / process execution: no cloud-reachable `Process.Start`
  path (the three local sites are update/autostart lifecycle features);
  command type allowlist (7 types) + 16 KB payload cap unchanged.
- Secret leakage: no tokens/credentials in logs, responses, tests or
  commits; the 1.8 GB `core` crash-dump generated by the sandbox was deleted
  and never committed (push rejected by size limit would have caught it).
- Uncertain jobs cannot be automatically reprinted (no such code path).

## J. Full-suite results

- SaaS: `tsc --noEmit` clean; `eslint` 0 errors (5 pre-existing warnings);
  full vitest **651→652 passed, 4 documented skips** (PGlite concurrency
  skip ×1 + pre-existing env-gated skips), with the final rerun confirming
  0 failures after the fixture fixes.
- PrintEXE: full solution Release build **0 errors**.
- Blocked / not executed: Windows CI run, Windows runtime + printer tests,
  Vercel staging, live realtime relay, physical print output.

## K. Remaining blockers

1. Windows CI execution (403 — maintainer action per §G).
2. Windows host + physical printer validation.
3. Vercel staging + storage bucket (no credentials).
4. Live realtime relay deployment.
5. Payment webhook end-to-end against a provider SANDBOX (current evidence
   is real-PostgreSQL + forged-valid signatures; no provider network calls).

## L. Final commit SHAs

- SaaS `phase3-critical-repairs`: 5ce7cbb (P2-2) → ec224b3 (P2-3 + P2-1) →
  docs commit (see branch tip; verified after push).
- PrintEXE `phase3-critical-repairs`: c958bd6 + docs commit (branch tip).

## M. Release decision

**NOT READY — VERIFICATION BLOCKED.**

All three application defects (P2-1, P2-2, P2-3) are fixed with real-PG
concurrency evidence, live staging verification, and a working operator UI.
However Windows CI has not passed (permission gap), Windows runtime and
printer validation remain unexecuted, and Vercel staging/provider-sandbox
payment verification are unavailable — the release gates that depend on
that infrastructure stay closed.
