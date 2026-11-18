# Laptop End-to-End Deployment Report — PrintShop SaaS + PrintEXE

Date: 2026-11-18 · Executor: autonomous agent in a Linux sandbox (no access to the operator's Windows laptop) · SaaS: Arjunyadavsoma/printshop-saas · EXE: Arjunyadavsoma/PrintEXE

Every result is classified **PASS / FAIL / BLOCKED / NOT EXECUTED**. Nothing blocked or unexecuted is claimed as passed. This session used **no credentials at all** — per the operating rules the previously-exposed GitHub PAT is treated as compromised and was not reused (it was purged from this environment in the prior session). Both repositories are now **public**, so all audit and verification work ran unauthenticated.

---

## 1. Laptop environment

**NOT EXECUTED — the agent has no access to your Windows laptop.** The sandbox is Linux (kernel 5.10.134, x86_64); Windows hardware facts (Windows version, CPU/RAM/disk, .NET runtimes, installed printers, driver/port status, existing PrintEXE installs, existing queue DB) cannot be observed from here.

**Exact next action:** run the read-only audit script delivered with this report —
`powershell -ExecutionPolicy Bypass -File .\laptop_audit.ps1 > audit.txt 2>&1` — and paste `audit.txt` back. It deletes nothing and lists existing app data/queue DBs explicitly so they can be preserved.

## 2. Exact SaaS commit and deployment URL

- **URL:** https://printshop-saas-three.vercel.app — **PASS** (live): HTTP 200 from Vercel edge (`server: Vercel`, `x-vercel-cache: HIT`, `x-vercel-id: hkg1::…`), `/shop/login` HTTP 200, page renders (title "PrintShop SaaS — QR-based print shop management for India").
- **Exact deployed commit:** **BLOCKED** — no Vercel access and the app exposes no commit/version header. Recorded identifiers: Next.js build id `g2F7t4u5QO0WhgRCCAbzz`, deployment id in `x-vercel-id: hkg1::x8mqm-1795010282408-f7fab49e8e3c`.
- **Deployed build bounded by route probing (read-only GETs only):** the deployment **predates the `phase4-release-qualification` branch**:

| Route (GET) | Status | Meaning |
| --- | --- | --- |
| `/api/v1/companion/pair` | 405 | route exists (POST-only) |
| `/api/v1/companion/pairing/begin` | 405 | exists |
| `/api/v1/agents/token` | 405 | exists |
| `/api/v1/agents/heartbeat` | 405 | exists |
| `/api/v1/agents/jobs/pending` | 401 | exists, auth enforced |
| `/api/v1/sync/pull` | 401 | exists, auth enforced |
| `/api/v1/companion/token/rotate` | **404** | **absent from deployed build** (branch-only endpoint) |
| `/api/v1/shops/me/jobs` | **404** | **absent from deployed build** (branch-only endpoint) |

**Impact for the laptop workflow:** pairing → JWT exchange → job fetch → download → print all work against production **as deployed**. But (a) device **token rotation is unavailable** (rc.5 will fail rotation and eventually require re-pairing — documented recovery, not data loss), and (b) the deployed status schema predates `needs_review`, so **uncertain print outcomes are rejected by the backend**; PrintEXE parks them locally as `outcome_unknown` (correct, honest) and the operator resolves in-app by reporting `completed`/`failed` — the backend-level operator-resolution endpoint and audit trail only exist on the reviewed branch.

**Exact next action:** deploy the reviewed `phase4-release-qualification` branch (SaaS head `f3d25bc`, CI-qualified per section 11) to an isolated Vercel staging project first; production promotion needs your explicit authorization (rule 6 honored — nothing was deployed).

## 3. Exact PrintEXE release tag and asset

**PASS** — verified live, unauthenticated, this session:

- Tag: **v0.6.1-rc.5** (latest release on the repo; prerelease flag true, so `/releases/latest` still returns stable `v0.6.0` — the in-app updater cannot offer the RC to stable users).
- Asset verified: `PrintEXE-v0.6.1-rc.5-win-x64.zip`, 62,135,789 bytes, **SHA-256 `6bf32a4b49c748e83aba815c296844e008ed5ef47a7a5106a1b7061efc7c4cc9`** — recomputed on the downloaded file, matching the release's `SHA256SUMS.txt` (`sha256sum -c`: all 3 checksummed assets OK) and GitHub's own asset digest.
- Updater asset `PrintShopCompanion-portable.zip`: present, **byte-identical** to the versioned ZIP (`cmp` exit 0) — the contract `GitHubUpdateService.PortableZipName` (verified in source, `GitHubUpdateService.cs:36`) is now satisfied.
- ZIP contents (298 files, 145,801,299 bytes uncompressed): self-contained win-x64 publish including `PrintShopCompanion.exe` (PE32+ GUI, x86-64), `e_sqlcipher.dll`, `SQLitePCLRaw.provider.e_sqlcipher.dll`, `README.txt`, `BUILD-INFO.txt`.
- BUILD-INFO: Version 0.6.1 · Build 197 · **Commit c92a3dfcf831a3362a4bf10d834d2351dbab3be2** (the Phase 6 tip — the updater-contract fix included) · Tag v0.6.1-rc.5 · Built 2026-11-18T00:42Z.
- Branch tip check: remote `phase4-release-qualification` = `5cac27c` (docs-only commit above the tagged `c92a3df`); `main` unchanged at `6fbf87d`.

## 4. Installation path and installed version

**NOT EXECUTED** — requires your machine. The runbook (delivered) installs to `C:\PrintEXE\` after backup of any existing `%APPDATA%\PrintShop` data, verifies the checksum with `certutil` before opening, and records SmartScreen/publisher behavior without disabling any protection. Expected installed version: 0.6.1 (BUILD-INFO above). Data preservation is explicit: nothing deletes existing queue DBs or credentials.

## 5. Database and storage verification

- **Local validation (prior session, recorded, code unchanged since):** PASS — fresh PostgreSQL 16.2 (same major as CI's `postgres:16`): `prisma migrate deploy` on a brand-new DB → **14 migrations**, exit 0; partial index `PrintJob_active_file_unique` present; re-deploy on an already-migrated DB → no-op, exit 0; `prisma validate` OK. Evidence with commands/exit codes: `p6_saas_validation.log` (workspace) and the committed Phase 6 report §C.1. This session's re-run: **NOT EXECUTED** (sandbox recycle wiped the PG binaries + node_modules; re-run script persisted at `scripts/p6_saas_validate.sh`).
- **Production database/storage:** **BLOCKED** — inspecting the production DB/storage requires credentials; read-only surface probes above are the maximum safe access. No destructive production operation was attempted.
- **Production CI note (from prior session, still true):** `cleanup-cron.yml` scheduled workflow red on `main` ("Call cleanup endpoint") — pre-existing, environment/config-owned, outside the branch diff.

## 6. Pairing and authentication results

- **Code/contract level: PASS** (recorded CI + local suites): deep-link + manual-token pairing, single-use ticket consumption, JWT exchange, DPAPI storage, revocation, rotation — covered by 175 passing Windows-CI tests (run 44209224616) and the SaaS suites (661 passed / 4 skipped).
- **Live against production as deployed: PARTIAL** — pairing core endpoints exist (405/401 probes above), but `token/rotate` is absent (404): rotation will fail against production until the branch is deployed. Replay/expiry and revocation behavior on production: **NOT EXECUTED** (requires authenticated shop session — yours, in the runbook Step 2).
- **Laptop-side pairing:** **NOT EXECUTED** — runbook Step 2 (two paths, explicit approval).

## 7. Realtime and polling results

- **Code level: PASS** (recorded): Socket.IO auth handshake, `shop:<id>` room scoping, REST fallback verified in suites.
- **Production realtime transport:** **NOT EXECUTED** — requires an authenticated device JWT; probing with fabricated credentials would be both impossible and wrong. Runbook Step 5 covers it on your laptop.
- Deployment check that the realtime path exists server-side was not directly probeable (socket endpoints don't answer GET probes meaningfully); recorded as such.

## 8. Print-job lifecycle results

- **Code level: PASS** (recorded suites): state machine (queued→printing→completed/failed/needs_review), first-claim-wins, duplicate-completion idempotency, storage-503 envelopes, no auto-retry of uncertain outcomes.
- **Live production:** **NOT EXECUTED** — job creation requires your authenticated shop session; runbook Step 4 walks it. The deployed build's `shops/me/jobs` listing absence does not block the device flow (device uses `agents/jobs/pending`), only the newer operator dashboard listing.

## 9. Physical printer test evidence

**NOT EXECUTED — no physical printer or laptop access.** The runbook's Step 4/5 define the exact sequence, the spooler-vs-physical distinction to record, and the rule that uncertain outcomes park for operator review (never auto-reprint). Until you paste observations, every physical-print acceptance line stays NOT EXECUTED.

## 10. Updater test results

- **Asset/checksum layer: PASS** (this session, live): portable.zip present and byte-identical; SHA-256 round-trip exact; BUILD-INFO/README inside ZIP; RC excluded from `/releases/latest` (verified: returns v0.6.0); updater constant verified in source.
- **Unit level: PASS** (recorded): GitHubUpdateServiceTests 145-test suite incl. the Phase 6 contract tests (DownloadUrl resolves only with the portable asset; PortableZipName pinned).
- **Interactive laptop tests** (update banner, install swap, rollback, data survival across upgrade): **NOT EXECUTED** — runbook-delivered in the next iteration after rc.5 is installed (rule 13: no stable release is created in this phase).

## 11. Test commands, exit codes, and counts (recorded evidence)

| Suite | Where | Command | Result |
| --- | --- | --- | --- |
| SaaS full suite | local, real PG 16.2 @ `f702d96` | `bunx vitest run` (env `DATABASE_URL`/`TEST_DATABASE_URL` → fresh `phb_p6`) | exit 0 — 58 files, **661 passed / 4 skipped / 0 failed**, 64.37s |
| SaaS migrations | local, fresh DB `phb_p6` | `bunx prisma migrate deploy` | exit 0 — 14 migrations; index PRESENT |
| SaaS migration idempotency | local, existing DB | `bunx prisma migrate deploy` (re-run) | exit 0 — no-op |
| SaaS typecheck | local | `bunx tsc --noEmit` | exit 0 |
| SaaS lint | local | `bun run lint` | exit 0 (0 errors, 5 pre-existing warnings) |
| SaaS build | local | `bun run build` | exit 0 |
| EXE Windows CI | GitHub Actions windows-latest, run 44209224616 @ `c92a3df` | `dotnet test` + publish + smoke + package + release gate | **SUCCESS** — Infrastructure.Tests 145/0/0, Queue.Tests 30/0/0 (175 total), smoke test alive, release gate green |
| Release verification | this session, live downloads | `sha256sum -c SHA256SUMS.txt` + `cmp` | all OK; byte-identical |
| This-session suite re-run | sandbox | — | **NOT EXECUTED** (environment reset; see §5) |

CI runs referenced (recorded in prior session): EXE run 44209224616 SUCCESS (rc.5), 44207432447 FAILED (gate's own GH_TOKEN mechanics; release content verified correct), 44201022962 SUCCESS (rc.2), 44202751419 SUCCESS (rc.3), 44199705627 FAILED (rc.1, no release).

## 12. Defects discovered and fixes

- **(This session) Deployed production build predates the reviewed branch** — missing `companion/token/rotate` + `needs_review`/operator-resolution + `shops/me/jobs`. Owner: deployment, not code. Fix: deploy the reviewed branch to staging, then production with authorization. No code change made (nothing to fix in code — the endpoints exist on the branch and are CI-qualified).
- **(Prior session, carried in the release)** updater asset contract defect — fixed by commits `83210a4` + `c92a3df`, regression-tested, verified live this session (§10).
- No new code defect was introduced or discovered this session; no repository modification was made.

## 13. Security and migration findings

- Credential hygiene: the exposed PAT was **not reused** anywhere this session (rule 5); it was purged from this environment in the prior session. **Rotate it on GitHub** if not already done. No credential was requested, printed, or committed.
- Both repos are now **public** — confirm that is intentional, and re-scan that no secret-bearing file was published with them (prior scans of tracked files/logs/release assets were clean; they should be re-run against the public state by anyone with push access).
- Migrations: additive-only on the branch; no applied migration rewritten (the SQLite-dialect duplicate `20261015172034_init` is a documented no-op repair); fresh + upgrade paths verified on real PostgreSQL (§5, §11).
- Production safety: only unauthenticated GET probes were sent; no writes, no destructive operations, no payment/webhook traffic generated.

## 14. PASS / FAIL / BLOCKED / NOT EXECUTED matrix

| # | Acceptance gate | Status | Evidence / next action |
| --- | --- | --- | --- |
| 1 | SaaS deployment healthy (HTTP layer) | **PASS** | 200 + Vercel headers; §2 |
| 2 | SaaS = reviewed Phase 5/6 build | **FAIL (deployment lag)** | branch-only endpoints 404 on production; deploy branch to staging → production |
| 3 | Database + storage config on production | **BLOCKED** | needs credentials; never probe destructively |
| 4 | Release asset + checksum verification | **PASS** | §3 (live, unauthenticated) |
| 5 | Updater asset contract + RC exclusion | **PASS** | §10 (live + recorded CI) |
| 6 | Laptop environment audit | **NOT EXECUTED** | run `laptop_audit.ps1`, paste output |
| 7 | PrintEXE install + first start | **NOT EXECUTED** | runbook Step 1 |
| 8 | Printer discovery + settings persistence | **NOT EXECUTED** | runbook Step 3 |
| 9 | Pairing (deep-link/manual) + DPAPI storage | **NOT EXECUTED** | runbook Step 2 |
| 10 | Device auth, revocation, rotation on production | **FAIL (rotation)** / rest NOT EXECUTED | `token/rotate` 404 on deployed build; deploy branch |
| 11 | Customer job → queue → device claim → download | **NOT EXECUTED** | runbook Step 4 |
| 12 | Authorized physical test print (spooler vs physical recorded separately) | **NOT EXECUTED** | runbook Step 4 |
| 13 | Backend status + audit trail accuracy | **NOT EXECUTED** | runbook Step 4; needs_review caveat §2 |
| 14 | No duplicate print on retries | **NOT EXECUTED** | runbook Step 5 |
| 15 | Queue recovery (pause/resume/cancel/restart) | **NOT EXECUTED** | runbook Step 5 |
| 16 | Realtime + REST fallback live | **NOT EXECUTED** | runbook Step 5 |
| 17 | Uncertain-outcome handling (no auto-reprint, operator resolution) | **NOT EXECUTED** (code-level PASS recorded) | runbook Step 5 + §2 caveat |
| 18 | Update install/rollback/data survival | **NOT EXECUTED** | after Step 1 install |
| 19 | Code suites (SaaS 661/4/0; EXE 175/0 Windows CI) | **PASS** (recorded) | §11 |
| 20 | Repository/state audit | **PASS** | §3; tips unchanged from Phase 6 report |

## 15. Remaining blockers

1. **Laptop access** — every physical gate (6–12, 14–18) waits on your runbook execution.
2. **Production deployment lag** — reviewed branch (SaaS `f3d25bc`) not deployed; blocks token rotation, honest `needs_review`, operator-resolution endpoint, and the new jobs dashboard on production.
3. **No credentials this session** — pushes and authenticated GitHub/Vercel operations were impossible; this report is committed **locally** on both feature branches and needs a push from an authenticated environment.
4. **PAT rotation** — the previously exposed token must be revoked/rotated on GitHub if not already done.

## 16. Exact next action for each blocker

1. **Laptop:** run `powershell -ExecutionPolicy Bypass -File .\laptop_audit.ps1 > audit.txt 2>&1`, paste the output; then follow `LAPTOP_RUNBOOK.md` Step 1 (checksum-verified install) and paste results per step.
2. **Deployment:** create an isolated Vercel staging project (or preview deployment) for the SaaS, set the staging env vars (`DATABASE_URL` to a dedicated staging Postgres, `DEVICE_TOKEN_PEPPER`, storage + payment test credentials, `APP_BASE_URL`), run `prisma migrate deploy` against it, deploy branch `phase4-release-qualification`, then re-run the §2 route probes against staging (expect `token/rotate` 405 and `shops/me/jobs` 401). Production promotion only on your explicit authorization.
3. **Pushes:** from an authenticated machine: `git push origin phase4-release-qualification` in both repos (or configure `gh auth login` there); the local commits contain `docs/LAPTOP_END_TO_END_DEPLOYMENT_REPORT.md` on both branches.
4. **Security:** revoke/rotate the exposed PAT in GitHub → Settings → Developer settings → Fine-grained tokens; confirm the repos' public visibility is intended.
