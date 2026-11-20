# BASELINE — Phase 0 work list (both repos)

Date: 2026-11-20 · Branch: `fix/e2e-printshop` (both repos) ·
Base: **origin/main** (deployable truth): printshop-saas `556043d`, PrintEXE `6684363`.

Evidence lives in `docs/audit/phase0/` (both repos; cross-repo copies where relevant).
Every item marked **[measured]** was produced by a command run during this phase;
items marked **[docs]** come from existing audit docs and are re-verified in later phases.

## Verified-green baseline (so we know what NOT to break)

| Area | Evidence |
|---|---|
| SaaS: install, prisma generate, route-conflicts, tsc, eslint, prisma validate, migrate deploy (fresh PG 16.2), vitest **664 passed / 4 skipped**, next build — **9/9 exit 0** | `printshop-saas/docs/audit/phase0/01..09*.log` [measured] |
| SaaS live stack on local PG 16.2: `/api/v1/health` 200 | `phase0/13-boot-probes.log`, `14-nextdev.log` [measured] |
| Companion contract end-to-end on local stack: register→login→session, pairing begin→pair→heartbeat→single-use, paste-token validation, cross-device sync (web order → device snapshot → command → poll → ack → jobs feed) — **18/18** | `phase0/15-companion-probe-local.log` [measured] |
| Realtime mini-service (3003/3004): auth-ok, room delivery, secret enforcement — **6/6** (once secrets wired, see B-013) | `phase0/17-socket-probe.log` [measured] |
| Customer QR flow: order create → shop page → order tracking page — **3/3** | `phase0/18-customer-flow-probe.log` [measured] |
| PrintEXE: dotnet restore exit 0, build **0 errors** (597 pre-existing warnings), net10.0 | `PrintEXE/docs/audit/phase0/01-restore.log`, `02-build.log` [measured] |
| PrintEXE on windows-latest CI (run 44552138078 @ 6684363): **186/186 + 30/30 tests**, packaging green | `PrintEXE/docs/audit/phase0/ci-windows-run-44552138078/` [measured] |
| Production SaaS + v0.6.1 release assets verified live earlier this cycle (pre-Phase-0 session) | conversation record; re-verify in Phase 7 |

## Work list

### P0 — must fix before DONE is possible

| id | repo | area | symptom | evidence | severity |
|---|---|---|---|---|---|
| B-001 | both | release-engineering | **Divergent lineages.** origin/main (deployable, contains v0.6.1 companion fixes + shop-snapshot route) does NOT contain the phase1–6 work (payment-webhook idempotency, operator-resolution UI, entitlement reconciliation, partial-index migration, rate-limit durability, PG service CI, release gates) — that work sits on `phase4-release-qualification` (remote branch 09aa7c1, unmerged). Local laptop clones cherry-picked a different lineage; commit hashes from the v0.6.1 session are not even valid objects in those clones. Reconciliation plan required before Phase 1. | [measured] git refs + reflog; saas `git ls-files` missing shop-snapshot on laptop tree; probe 404 `phase0/15-*.log` (first run); PrintEXE greps missing `GetShopSnapshotAsync`/`TogglePairingPanel_Click` on laptop tree | P0 |
| B-002 | both | security | Previously-exposed GitHub PAT treated as compromised; repos public; no post-exposure secret re-scan of tracked history. **Manual action: revoke/rotate the PAT on GitHub, then re-scan.** | [docs] LAPTOP_END_TO_END_DEPLOYMENT_REPORT §13/§15 (both repos) | P0 |
| B-003 | saas | deployment | Production deployment predates current main: `/companion/token/rotate` 404, `needs_review` status rejected, `/shops/me/jobs` 404 → token rotation and job listing broken in production. **Manual action: redeploy Vercel from reconciled main, then re-probe.** | [docs] LAPTOP report §2 route-probe table, §12 | P0 |
| B-022 | both | verification | 13 laptop gates never run on a real Windows PC (install MSI, pairing, physical print + spooler evidence, no-duplicate-print on retry, revocation propagation, update/rollback, data survival). These are DONE-criteria items, not code bugs. Exact checklist delivered with the Phase 5 report. | [docs] LAPTOP §15 gates 6–18; PHASE2_FINAL_REPORT §10 | P0 |

### P1 — feature-broken / contract / ops

| id | repo | area | symptom | evidence | severity |
|---|---|---|---|---|---|
| B-004 | saas | realtime-deploy | Socket.IO mini-service needs a long-lived process; on Vercel serverless the dashboard silently falls back to polling. Local self-host works 6/6 (B-013 fixed wiring), so the gap is deployment topology, not the service. | [docs] KNOWN_LIMITATIONS P1-3; [measured] `phase0/17-socket-probe.log` | P1 |
| B-005 | saas | ops | `CRON_SECRET` unset in production → `/api/v1/cron/cleanup` 401; uploads accumulate past retention; cleanup-cron.yml red on main. | [docs] KNOWN_LIMITATIONS P1-1/P1-2 | P1 |
| B-006 | saas | billing | Subscription tiers informational only — no plan→feature gating across the app (analytics entitlement IS enforced on the dashboard + snapshot; everything else is not gated). | [docs] KNOWN_LIMITATIONS P1-4; [measured] snapshot entitlement path in `companion/shop-snapshot` | P1 |
| B-007 | saas | money | PaymentAttempt/PaymentEvent persistence not wired; webhook uses cache-only session lookup (10-min TTL) → delayed webhooks can lose merchantOrderId→orderId mapping. Integer-paise correctness itself is tested (664 green). | [docs] KNOWN_LIMITATIONS P2-1 (severity raised — money path) | P1 |
| B-008 | PrintEXE | printing | `HasPrintedAsync` treats "job disappeared" as printed (false positives for purged jobs); `SumatraPdfPrinter` fabricates a spooler ID when `-print-stat` parsing fails; `RawGdiPrinter` prints a placeholder string, not real raw/ESC-POS via winspool. Violates invariant "never report printed until spooler confirms". | [docs] AUDIT §8/§9/§16 items 8–10; HONEST-STATUS | P1 |
| B-009 | PrintEXE | commands | `pause`/`resume` device commands report "succeeded" with "wiring pending" — JobProcessor is not actually paused/resumed. | [docs] PHASE2_FINAL_REPORT §4/§10 item 7 | P1 |
| B-010 | PrintEXE | integrity | `PdfSha256` is null for backend-delivered jobs → SHA-256 content verification is skipped on the print path. | [docs] AUDIT §4/§16 item 18 | P1 |
| B-011 | PrintEXE | installer | `Installer.wxs` cannot build (missing `.exe.manifest`, `SumatraPDF.exe`, `dotnet-runtime` redist, `app.ico/png`); CI ships ZIP only; no code-signing; no per-user URL-scheme registration. | [docs] AUDIT §12/§16 item 16 | P1 |
| B-012 | PrintEXE | logging | `DeviceTokenRedactor` exists but is not wired into Serilog — device tokens can reach logs (invariant: tokens never appear in logs). | [docs] AUDIT §11/§16 item 13 | P1 |
| B-013 | both | realtime-wiring | `mini-services/realtime-service` must run with the SAME `JWT_ACCESS_SECRET` as the SaaS or every dashboard auth fails with `invalid or expired token`. Nothing documents this; default boot fails. (Probe: 4/6 with default secret → 6/6 once shared.) | [measured] saas `phase0/17-socket-probe.log` (both runs); boot script comment | P1 |
| B-014 | PrintEXE | mock-backend | Mock backend serves a different contract (root lists `/pair`,`/heartbeat`,`/jobs/*`; real `POST /api/v1/companion/pair` → 404) and binds **https-only** with a dev cert — it cannot stand in for the SaaS in local E2E of the current companion. | [measured] PrintEXE `docs/audit/phase0/16-mock-backend.log` | P1 |
| B-015 | saas | contract-docs | Three contract docs compete (COMPANION_V1_CONTRACT.md frozen v1.0, PRINTEXE_INTEGRATION_GUIDE.md 2025-11-07, API_CONTRACT.md v1.1); brief requires ONE machine-readable SSOT with contract tests both sides. Phase 1 task. | [docs] digest of docs/integration/*; API_CONTRACT.md header | P1 |

### P2 — polish / portability / hardening

| id | repo | area | symptom | evidence | severity |
|---|---|---|---|---|---|
| B-016 | PrintEXE | settings | `OptionsWriter.Update` stub (printer choice not persisted); `appsettings.Local.json` not loaded; `TokenStillValid` hardcoded true. | [docs] AUDIT §16 items 11/14/19 | P2 |
| B-017 | PrintEXE | ux | No real `app.ico`/`app.png`; tray has no connected/offline/error states; no first-run Setup screen. | [docs] AUDIT §16 item 15 | P2 |
| B-018 | saas | ui | Missing loading/empty/error states on several screens; polling doesn't pause on hidden tab; customer delivery tracking + dashboard delivery history missing. | [docs] KNOWN_LIMITATIONS P2-5..P2-8 | P2 |
| B-019 | laptop-branch | tests | Two suites hardcode `postgresql://z@127.0.0.1:5433/...` (laptop's OS user) — unrunnable on any other machine. Must be fixed when phase work merges (Phase 1). On origin/main these suites pass (TEST_DATABASE_URL honoured). | [measured] saas `phase0/08-tests.laptop-lineage.log` vs `08-tests.log` | P2 |
| B-020 | saas | security | `/api/v1/db-health` publicly reachable (minor info disclosure). | [docs] KNOWN_LIMITATIONS P3-7 | P2 |
| B-021 | PrintEXE | testing | Test projects target `net10.0-windows` → impossible to run on Linux dev/CI; Windows-only loop. (windows-latest CI covers it: 216/216.) | [measured] PrintEXE `docs/audit/phase0/03-tests-linux.laptop-lineage.log` | P2 |

## What remains unverified in Phase 0 (→ later phases / manual)

- Physical printer path end-to-end (spooler confirmation, paper output) — Windows PC with a real printer (B-022 checklist, Phase 5).
- Production redeploy + rotation/status routes after lineage reconciliation (B-003).
- Auto-update (Velopack) and code-signing behavior — Phase 6.
- Chaos suite (network drop mid-job, duplicate dispatch, revoke during print, disk full) — Phase 5.
- WPF app process itself (heartbeat timer, tray, reconnect backoff) — Windows-only; verified via CI tests + code audit until then.
