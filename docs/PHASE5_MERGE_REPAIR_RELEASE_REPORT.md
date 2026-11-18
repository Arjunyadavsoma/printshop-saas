# Phase 5 — Merge, Repair, Windows Build, and PrintEXE Release Report

Branches: `phase4-release-qualification` (both repos). No history rewrites, no force-pushes, no overwrites.

## 1. Repository identity (Phase 0)

| Repo | main SHA | phase4 branch SHA (final) | Working tree |
|---|---|---|---|
| printshop-saas | `48a7261` | `8f8d6b0` | clean |
| PrintEXE | `6fbf87d` | `952fe00` | clean |

- `rev-parse --show-toplevel`, `remote -v`, `branch --show-current`, `log -8` verified for
  both repos before any change; main is a strict ancestor of the phase4 branch in both
  (0 behind; SaaS +14, EXE +10 commits) — no divergence, no mixing.
- Tracked artifact/secret scan: no `.env` (only `.env.example` with
  `generate_with_openssl_*` placeholder values), no tokens/keys/db files/core dumps/large
  binaries tracked in either repo.
- Tags inspected before versioning: EXE tags up to `v0.6.0` exist; releases exist only
  through `v0.4.5`; no release collides with the new tag.

## 2. Independent code review (Phase 1) — findings and repairs

Reviews were performed directly on the code (two read-only review passes + direct
verification of every claim before fixing).

### PrintEXE — repaired defects

| # | Defect | Root cause | Repair | Regression test |
|---|---|---|---|---|
| M1 | **Mandatory SQLite defect**: `SqliteConnectionPragmas.ExecutePragmaAsync` swallowed ALL exceptions — a connection without `foreign_keys=ON` / `busy_timeout` was handed to callers as safe | catch-all with comment | every pragma now APPLIED then VERIFIED via its query form; mismatch/failure throws `InvalidOperationException`; WAL switch retried bounded (2s) under contention then fails visibly; cancellation propagates; `OpenWithPragmasAsync` disposes on failure; `SqliteJobQueue.OpenAsync` uses the factory (no half-configured hand-back); pragma commands run with `CommandTimeout=1` (fail fast, no 30s stall) | `SqliteConnectionPragmasSafetyTests` (6 tests) |
| M2 | Lazy token restore never seeded `_shop` → NRE in `ApiUrl` on first authenticated call of any restored instance (job processor, heartbeat, rotation) | restore set `_token` only | restore seeds `_shop` from `BackendOptions` (same as the paste-token flow pre-validation) | compile + CI; runtime path covered by pairing tests |
| M3 | `MarkOutcomeUnknownAsync` guard `status IN (printed,pending,uncertain)` missed `Spooled/Downloading/Rendering` — crash-recovery parks matched zero rows, stranding jobs outside reconciliation | stale guard list | guard extended to all three pre-spool states | covered by queue tests + CI |
| M4 | SumatraPDF got SEPARATE `-print-settings` flags → last-wins parsing silently discarded copies | flag emission | single comma-separated `-print-settings` | compile + CI |
| M5 | No spooler ID → synthetic random ID → `HasPrintedAsync` "not found → assuming completed and purged" → job reported **completed** with zero physical confirmation | synthetic fallback | `SpoolSubmission.SpoolerJobId` is now `int?`; `PrintAsync` returns 0 when unknown; JobProcessor skips the poll for null IDs and parks the job **outcome-uncertain** (`needs_review`) — never "completed" | compile + CI (printer/physical paths are Windows-runtime-gated) |
| M6 | `QueueKeyStore` overwrote the DPAPI key file on unprotect failure → permanent loss of the encrypted queue.db | fall-through to generate | fail-closed: throws, key file untouched, recovery pointer to docs | compile + CI |

Reviewed-clean areas (evidence noted in review): startup/shutdown lifecycle, DPAPI
persistence (atomic tmp→move, .bak recovery, never logged), URI activation parsing,
pause/resume signal gate, rotation overlap design, SQLCipher fail-closed construction.

Known risks left documented (not blind-patched): transient backend instances keep stale
credentials until restart after mid-session revoke (restart recovers); single-instance
guard does not forward deep links; mid-session pairing requires restart to start the
cloud connection; auto-update rollback .bat checks file presence only; version compare
treats `1.2 < 1.2.0`; retention can delete a Failed job's PDF before a later retry.

### SaaS — repaired defects

| # | Defect | Repair | Regression test |
|---|---|---|---|
| S1 | `POST /agents/register` multi_device gate was check-then-insert with NO post-insert reconciliation — concurrent registrations could both pass | post-insert reconciliation added (parity with `/companion/pair`): over-limit device disabled + audited, request rejected | `http-route-tests` register entitlement test (22/22) |
| S2 | Register entitlement errors returned code `FORBIDDEN` while the companion contract keys on `ENTITLEMENT_REQUIRED` | aligned to `AppError(..., 'ENTITLEMENT_REQUIRED', 403)` on both throws | same test asserts the code |
| S3 | `PrintJob_active_file_unique` partial index existed only in `pg-constraints.sql` (hand-applied) — fresh `migrate deploy` DBs lacked the invariant | NEW additive migration `20251119000000_printjob_active_file_unique` (no existing migration rewritten) | verified on a FRESH database and as an UPGRADE on an existing 13-migration database (index present in both; 14 migrations applied) |
| S4 | Rate limiter: `incr` then `expire` only on first hit — a lost expiry became a permanent per-key lockout | on expire failure the counter is dropped (fail-open) | `rate-limit.test.ts` (3 tests) |
| S5 | **CI defect**: the five real-PostgreSQL suites failed in CI with `ECONNREFUSED 127.0.0.1:5433` (no DB provisioned) — main CI was red | `ci.yml` now provisions a `postgres:16` service on 5433 with `TEST_DATABASE_URL`/`DATABASE_URL` and runs `prisma migrate deploy` before tests | locally equivalent run green (661 passed); validates when CI runs on the PR |

## 3. Windows CI (Phase 3) — actual GitHub Actions runs

| Run | Tag | Result | Evidence |
|---|---|---|---|
| 44199705627 | `v0.6.1-rc.1` | **failure** — "Run tests" step failed (3 test-env issues, see below); release job correctly SKIPPED | gates work: no release from a failed build |
| 44201022962 | `v0.6.1-rc.2` | **success** | build + all tests + publish validation + smoke test + packaging + checksums + release |
| 44202751419 | `v0.6.1-rc.3` | **success** | final release (see §5) |

Runner: `GitHub Actions 1000000338` (`windows-latest`). Version mapping verified:
tag `v0.6.1-rc.3` → `BUILD_VERSION=0.6.1` (valid numeric assembly version).

Test totals on rc.2/rc.3 (windows-latest, Release): **Infrastructure.Tests 142 total
(139 passed, 3 failed→fixed in rc.2), Queue.Tests 30/30 passed**. rc.3: all green
(0 failed). Skipped: none counted as passing; the only skips are Linux-guarded
Windows-only tests that do not run there and are NOT included in the totals above.

rc.1's three failures (all test-environment, no production weakening):
1. SQLCipher test: test project pinned the plain `e_sqlite3` provider → initializer
   correctly failed closed → fixed by referencing `bundle_e_sqlcipher` in tests;
2. WAL-contention test: Microsoft.Data.Sqlite's 30s default CommandTimeout stalled
   pragma attempts → fixed with `CommandTimeout=1`;
3. pooled holder connections kept the exclusive lock after dispose → tests now use
   `Pooling=False`.

## 4. Staging / Vercel (Phase 5 §5) — BLOCKED

No Vercel credentials exist in this environment; the Phase 4 "REST fallback" evidence
was explicitly a LOCAL production build against local PostgreSQL, NOT Vercel staging
(that inconsistency is now stated plainly). Marked BLOCKED — nothing about staging is
claimed. The SaaS CI fix will execute on the PR's own CI run (main/PR trigger).

## 5. Release (Phase 8)

**Release**: `PrintEXE v0.6.1-rc.3` — https://github.com/Arjunyadavsoma/PrintEXE/releases/tag/v0.6.1-rc.3
- `prerelease: true` (explicit pre-release support implemented; excluded from
  `/releases/latest`, so the auto-updater never offers an RC — verified by design of
  the GitHub endpoint the updater polls).
- Assets (all downloaded and verified at least once):
  - `PrintEXE-v0.6.1-rc.3-win-x64.zip` — 62,135,878 bytes, 298 files
  - `SHA256SUMS.txt`, `BUILD-INFO.txt`, `README.txt` (also INSIDE the ZIP)
- **SHA-256 round-trip verified independently**: downloaded ZIP recomputed
  `435ea5a8a0e6daa99192553fc82bf1b48008f79f3a9f1efaa3458d3810b7e1ce` — exact match with
  `SHA256SUMS.txt`; CI additionally verifies the round-trip inside the pipeline.
- ZIP inspection: `PrintShopCompanion.exe`, `appsettings.json`, `e_sqlcipher.dll` +
  `e_sqlite3.dll` natives, `hostfxr.dll`/`*.runtimeconfig.json` (self-contained), 291
  managed DLLs, no `.env`/`.db`/`.pfx`.
- BUILD-INFO inside ZIP: Version 0.6.1, run #195, commit `952fe00`, win-x64, Release.
- Windows startup smoke test passed inside CI (process alive after 20s).
- Earlier attempts: `v0.6.1-rc.1` (failed CI, no release created), `v0.6.1-rc.2`
  (success; superseded by rc.3 for in-ZIP metadata + tag-matched asset name; remains
  published, untouched).

## 6. Pull requests and merge (Phases 6–7) — BLOCKED by permissions

Exact errors (reproduced twice this phase):

```
POST /repos/Arjunyadavsoma/printshop-saas/pulls   → HTTP 403 "Resource not accessible by personal access token"
POST /repos/Arjunyadavsoma/printshop-saas/actions/workflows/.../dispatches → HTTP 403
```

The fine-grained PAT has `contents: read/write` (clone/push/tag work — the tag push is
how Windows CI was triggered) but lacks `pull_requests: write` and `actions: write`.
Per the phase instructions: PR creation, merging into `main`, and Vercel staging are
NOT performed and NOT claimed. Both branches are pushed, clean, and ready:
- SaaS `phase4-release-qualification` @ `8f8d6b0` (14 commits ahead of main, fast-forward)
- PrintEXE `phase4-release-qualification` @ `952fe00` (10 commits ahead, fast-forward)

Maintainer actions: grant `pull_requests: write` (+ optionally `actions: write`) and
open the two PRs (GitHub then runs SaaS CI and the Windows workflow on the PR), or open
them via the web UI from the branch pages.

## 7. Gate status summary

| Gate | Status |
|---|---|
| Independent code review + verified repairs (both repos) | **PASSED** |
| SaaS: typecheck, lint, full suite 58 files (661 passed / 4 documented skips / 0 failed), production build | **PASSED** |
| SaaS migration integrity (fresh + upgrade) | **PASSED** |
| Windows CI on windows-latest (build, ALL test projects, publish validation, smoke test) | **PASSED** (runs 44201022962, 44202751419) |
| Windows distribution ZIP + SHA-256 round-trip + in-ZIP metadata | **PASSED** |
| GitHub pre-release published and verified | **PASSED** |
| SaaS CI on GitHub (postgres service) | **NOT EXECUTED on GitHub** (CI triggers on main/PR only; fix pushed; local equivalent green) |
| PR creation + merge to main | **BLOCKED** (403, exact errors above) |
| Vercel isolated staging | **BLOCKED** (no credentials) |
| Windows runtime on a real host + physical printer | **NOT EXECUTED** (no hardware; CI smoke test is the only runtime evidence) |
| Provider-sandbox payment E2E | **NOT EXECUTED** (real-PG + forged-valid-signature evidence only) |

The release is explicitly a **pre-release**, not production-ready: physical-printer
validation and isolated-staging verification remain open, and the merge to `main` is
pending maintainer permissions.
