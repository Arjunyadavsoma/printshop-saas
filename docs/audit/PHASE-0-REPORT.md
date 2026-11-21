# PHASE 0 REPORT — Baseline (fix/e2e-printshop)

Date: 2026-11-20 · Base: origin/main (saas `556043d`, PrintEXE `6684363`) · Status: **complete, stopped for review**

## 1) What was found (with file paths)

Full work list with severities: **docs/audit/BASELINE.md** (identical copy in both repos). Headlines:

- **B-001 (P0) divergent lineages**: origin/main does not contain the phase1–6 work (it lives on `phase4-release-qualification`, remote branch `09aa7c1`, unmerged), and the laptop clones cherry-picked a lineage that lacks the v0.6.1 companion fixes (proof: `shop-snapshot` route absent → probe 404; `GetShopSnapshotAsync` absent from IPrintShopBackend). Both halves are real, tested work; reconciliation is the first Phase 1 task.
- **PrintEXE prints are not trustworthy** (B-008/B-010/B-012, P1): false-positive "printed" paths, missing hash verification, redactor unwired — exactly the invariants the brief calls out.
- **Mock backend is a dead end for E2E** (B-014): different contract + https-only dev cert (measured: real `/api/v1/companion/pair` → 404).
- **Realtime secret wiring is undocumented** (B-013): mini-service rejects valid dashboard JWTs unless started with the SaaS's `JWT_ACCESS_SECRET` (measured 4/6 → 6/6 once shared).
- Everything else measured green: SaaS battery 9/9 with 664 tests, fresh-DB migrations, companion contract 18/18, realtime 6/6, customer flow 3/3, PrintEXE build 0 errors, Windows CI 216/216.

## 2) What was changed and why

- **No product code changed** (Phase 0 is fix-free by definition).
- Created `fix/e2e-printshop` in both repos, based on **origin/main** (deployable truth) after discovering the divergence; the laptop-lineage work was left untouched on `phase4-release-qualification`.
- Added `docs/audit/` (BASELINE.md + PHASE-0-REPORT.md + phase0 evidence logs + reproducible scripts under `scripts/phase0/`) to both repos.

## 3) Commands run and real output summary

| step | command | result |
|---|---|---|
| SaaS deps | `bun install --frozen-lockfile` | exit 0 |
| SaaS battery | generate / route-conflicts / `tsc --noEmit` / eslint / `prisma validate` / `prisma migrate deploy` (fresh PG 16.2 on 127.0.0.1:5433) / `vitest run` / `next build` | **9/9 exit 0**, 664 tests passed, 4 skipped — `docs/audit/phase0/01..09*.log` |
| PrintEXE build | `dotnet restore` + `dotnet build` (SDK 10.0.404) | restore 0, build **0 errors** — `docs/audit/phase0/01,02` |
| PrintEXE tests (Windows) | windows-latest CI run 44552138078 @ 6684363 | **186/186 + 30/30** — full logs in `docs/audit/phase0/ci-windows-run-44552138078/` |
| Local stack | portable PG 16.2 (no docker/root available), `migrate deploy` → dev DB, realtime-service, `next dev` | health 200; realtime 3003/3004 up — `phase0/10,12,13,14` |
| Companion probe | 18-check end-to-end probe (register/login/session, pairing, paste-token, cross-device sync incl. shop-snapshot, commands, ack, jobs feed) | **18/18 PASS** — `phase0/15-companion-probe-local.log` |
| Realtime probe | socket.io auth → /emit relay → room delivery → bad-secret rejection | **6/6 PASS** (after shared-secret boot) — `phase0/17-socket-probe.log` |
| Customer flow | order create → shop page → tracking page | **3/3 PASS** — `phase0/18-customer-flow-probe.log` |
| Mock backend | `dotnet run` (runs on Linux!) + contract probes | serves different contract; real pair route 404 — `phase0/16-mock-backend.log` |

## 4) What remains unverified / manual steps for you

1. **B-002 (you)**: revoke/rotate the exposed GitHub PAT on GitHub; confirm repo visibility intent; then we re-scan tracked history for secrets.
2. **B-003 (you + me)**: redeploy Vercel from reconciled main (after Phase 1 merges), then I re-probe rotation/status routes.
3. **B-022 (you, Windows PC)**: the 13 laptop gates (install MSI, pair from website, physical print with paper in hand, unplug/retry for no-duplicate-print, revoke mid-print, service restart). Exact checklist arrives with the Phase 5 report; nothing in Phase 0 depends on it.
4. Real Windows `dotnet test` output (mine comes from CI logs; local Linux cannot run `net10.0-windows` test projects — B-021).
5. Velopack/code-signing behavior — Phase 6.

## 5) Next phase (proposed, awaiting your review of BASELINE.md)

**Phase 1 — One contract**: reconcile the two lineages into `fix/e2e-printshop` (merge `phase4-release-qualification`, port the two hardcoded `z@` test URLs, keep CI green), then make `docs/integration/COMPANION_V1_CONTRACT.md` the single SSOT with Zod schemas → JSON Schema, contract tests in both repos that fail CI on drift, canonical token path `%AppData%\PrintEXE\device-token.dat` with the 3-tier migration, and stale-doc fixes.
