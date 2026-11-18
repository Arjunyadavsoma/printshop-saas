# Phase 2 — Release Verification Report

Branches: `phase2-release-verification` (both repos). No merges to `main`. No production changes.

## A. Repository state

| Repo | Branch | Starting commit | Final commit | Working tree |
|---|---|---|---|---|
| Arjunyadavsoma/printshop-saas | phase2-release-verification | d63c66b (= Phase 1 tip, verified on remote) | 7904cc0 + docs fix | clean |
| Arjunyadavsoma/PrintEXE | phase2-release-verification | ab7d660 (= Phase 1 tip, verified on remote) | 101985e | clean |

Incident note: one push briefly created `phase2-release-verification` on the
SaaS remote with PrintEXE history (wrong cwd); it was deleted immediately and
re-pushed correctly. No other branch or history was touched; no force-pushes.

Pre-existing state found: `main` on PrintEXE is RED — run 44023697686
(commit 6fbf87d) fails compiling `JobProcessorPauseResumeTests` fakes
(CS0535 ×6). The integration branch already contains the fix (Phase 1 rebuilt
those fakes; full solution builds 0 errors). Credential scan of both repos:
clean (no .env, no tokens, no keys committed).

## B. Defect register

| ID | Severity | Description | Root cause | Repo | Fix commit | Verification |
|---|---|---|---|---|---|---|
| P2-1 | HIGH | `GET /agents/jobs/pending` returns 500 when storage presigning is unavailable | Pending-jobs route presigns download URLs; STORAGE_PROVIDER=disabled adapter throws | SaaS | not fixed (staging-only config; production rejects disabled storage at startup) | documented; storage-dependent job delivery = UNVERIFIED |
| P2-2 | HIGH | Concurrent duplicate webhook delivery applies ZERO financial effects (expected exactly 1) | race in PAY-002 persistence idempotency — deterministic in current environment; payments/pricing code unchanged since d63c66b (attribution: environment-sensitive pre-existing) | SaaS | not fixed — BLOCKER recorded | `payment-event-persistence.test.ts` B4 fails deterministically |
| P2-3 | MEDIUM | No website UI surface for job-level `needs_review` (operator resolution endpoint exists but no UI calls it) | Phase 1 delivered backend only | SaaS | partially — NEW `GET /shops/me/jobs?status=needs_review` (7904cc0) provides the data source; UI wiring still open | endpoint verified via staging suite (H5) |
| P2-4 | LOW | register tokens were ~244 bits (uuid-uuid) | legacy format | SaaS | 7904cc0 (256-bit CSPRNG, hash-based verification keeps old tokens valid) | test 23 green |
| P2-5 | LOW | realtime-service validates socket JWTs only at auth time; a revoked device keeps receiving shop events until reconnect | token validated once per connection | SaaS mini-service | not fixed (residual; events are non-authoritative; REST dies immediately on revocation) | code review |
| P2-6 | INFO | main-branch CI red (stale test fakes) | fakes not updated on main | PrintEXE | already fixed on integration/phase2 branches | solution builds 0 errors |

## C. Migration evidence

- PostgreSQL 16.2 (disposable local cluster, port 5433).
- Fresh deploy: `prisma migrate deploy` applies all 13 migrations → `prisma
  migrate diff` vs schema.prisma → **"No difference detected."**
- Upgrade path: chain without newest migrations + representative data
  (users, shops, agents, tickets, commands, orders, files, jobs) → newest
  migrations applied → no data loss, RESTRICT/SET NULL actions enforced
  (negative FK tests produce 23503), rotation columns added with NULLs.
- History scenarios (no history / pre-bogus history / original history marked
  via resolve / interrupted migration + resolve): ALL converge, final drift
  check "No difference detected." Original SQLite-dialect init reproduced
  FAILING on fresh PG (42704) — Phase 0 no-op decision re-confirmed.
- `_prisma_migrations` never deleted; no `db push` used; checksum recovery
  exercised on disposable copies only.

## D. Windows CI evidence

- Workflow: `.github/workflows/build-windows.yml` — audited: windows-latest,
  .NET 10 SDK, restore, Release build, `dotnet test` (no continue-on-error),
  publish + native-DLL validation, ZIP + SHA-256SUMS + checksum round-trip,
  release job (tag only).
- **Remote CI: BLOCKED.** The available fine-grained PAT lacks `actions:write`
  (workflow dispatch → 403) and `pull_requests:write` (PR creation → 403).
  Required permissions for the maintainer: a token with **Actions: Read and
  write** (dispatch on `phase2-release-verification`) or open a PR
  `phase2-release-verification` → `main` (triggers build+test, no release).
  Do not merge until Gate A passes.
- Local validation: `dotnet build PrintShopCompanion.sln -c Release` → **0
  errors** (this includes the NEW WindowsRuntimeSecurityTests.cs). Linux
  cross-compile is NOT treated as Windows runtime verification.

## E. Staging evidence

- Vercel staging: **BLOCKED** — no Vercel credentials in this environment.
  Environment-variable presence checklist (actual names): `DATABASE_URL`,
  `DEVICE_TOKEN_PEPPER`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `PAYMENT_ENCRYPTION_KEY`, `STORAGE_PROVIDER` + bucket credentials,
  `STORAGE_CAPABILITY_SECRET`, `REALTIME_PROVIDER`/`REALTIME_EMIT_SECRET`,
  `APP_BASE_URL`, `CRON_SECRET` — validated at startup by the container
  (production build fails fast on memory storage / missing pepper).
- Local production-build staging used instead: `next build` + `next start`,
  real PostgreSQL, `STORAGE_PROVIDER=disabled` (no bucket credentials →
  upload/presign-dependent flows explicitly UNVERIFIED).
- HTTP scenarios: **32/33 checks pass** (`scripts/phase1/phase2_scenarios.js`,
  commit `7904cc0`): registration, login, shop, membership, pairing begin/
  consume/replay-409, shop isolation, heartbeat/online/lastSeen/printerName,
  device rename, cross-shop authorization failures (403/404/401), command
  create×4/poll/delivered/report/duplicate-idempotent/unknown-type-400,
  SQL-seeded job claim→needs_review→operator-resolve (actor recorded,
  terminal 409, duplicate completion skipped), rotation (new token once,
  old-token mutation 403, old-token heartbeat OK, disabled 403,
  revoked 401). The single FAIL is P2-1 (storage presign 500).
- Realtime: REALTIME_PROVIDER=memory (no-op push); REST polling verified
  functional — marked NOT FULLY VERIFIED (relay service not deployed).
- Contract fixtures: 196 PrintEXE DTO JsonPropertyNames checked against REAL
  captured envelopes — **zero required keys absent**; error envelopes
  conform (status codes + codes verified).

## F. Cross-repository integration (actual results)

| Scenario | Result |
|---|---|
| 1 shop setup | PASS (API level) |
| 2 pairing (API) | PASS; PrintEXE UI/DPAPI steps BLOCKED (no Windows host) |
| 3 connectivity/heartbeat | PASS (API); network-interrupt on device BLOCKED |
| 4 commands | PASS (create/poll/deliver/report/dedup/validation) |
| 5 print jobs | PASS through claim→uncertain→operator-resolve (API); physical output BLOCKED (no printer) |
| 6 crash/recovery | PASS at route level (23-case suite: claim-skip parking, uncertain never retried); device-side crash BLOCKED |
| 7 security/lifecycle | PASS (rotation overlap policy, disable, revoke) |
| 8 multi-device entitlement | PASS (second device 403; Phase 1 race fix) |

## G. Remaining blockers

1. Windows CI run (needs authorized trigger — exact steps in §D).
2. Windows runtime + physical printer validation (spec §8 Phase F list) — no Windows host available; WindowsRuntimeSecurityTests added and will execute on CI.
3. Vercel staging deployment (no credentials) + storage bucket → P2-1 and file-upload flows.
4. Realtime relay deployment (device realtime path; REST fallback verified).
5. P2-2 payment idempotency defect (deterministic test failure — fix before any release).
6. P2-3 operator-resolution UI wiring.

## H. Release decision

**NOT READY — VERIFICATION BLOCKED.**

No code defect introduced by Phase 2 remains unfixed except P2-2
(pre-existing, payment integrity — must be fixed) and the recorded UI gap;
however Windows CI, Windows runtime, cloud staging, and storage-dependent
integration remain unverified, so the decision cannot be
`READY FOR RELEASE REVIEW` under the phase rules.
