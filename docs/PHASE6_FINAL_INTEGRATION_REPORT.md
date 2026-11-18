# Phase 6 — Final Integration, Merge, Staging Validation & Stable Release Qualification

Date: 2026-11-18 · Executor: autonomous agent (z.ai agent mode) · Repos: Arjunyadavsoma/printshop-saas, Arjunyadavsoma/PrintEXE

Every verification result below is classified PASSED / FAILED / BLOCKED / NOT EXECUTED. Nothing BLOCKED or NOT EXECUTED is presented as passed.

---

## A. Repository state

| Item | printshop-saas | PrintEXE |
| --- | --- | --- |
| URL | https://github.com/Arjunyadavsoma/printshop-saas | https://github.com/Arjunyadavsoma/PrintEXE |
| Working branch | phase4-release-qualification | phase4-release-qualification |
| Phase 5 head (start of Phase 6) | f702d965eb4d2e8904f9e221b690b314d5077ecb | c61d61d4d08d2512c785b90216680a1bdc892a08 |
| Phase 6 head (end of Phase 6) | f702d965eb4d2e8904f9e221b690b314d5077ecb (no SaaS code change in Phase 6) | c92a3df (83210a4 updater-asset fix + c92a3df GH_TOKEN gate fix, 2 commits above c61d61d) |
| Release tag built in Phase 6 | — | v0.6.1-rc.4 → 83210a4; v0.6.1-rc.5 → c92a3df |
| PR | NOT CREATED — GitHub API returns 403 (see A.1) | NOT CREATED — same 403 |
| Merge commit | none (merge BLOCKED) | none (merge BLOCKED) |
| main SHA (unchanged) | 48a726131a9533d14495925893d1c8fba54beaba | 6fbf87daa4cf68a8086e96be6719f47d441f0f36 |
| Working tree | clean, on branch | clean, on branch |

### A.1 Pull requests — BLOCKED (exact permission error)

- Existing PRs checked first (state=all, head=phase4-release-qualification, both repos): none existed.
- POST /repos/…/pulls returned **HTTP 403 "Resource not accessible by personal access token"** for both repositories. The token (fine-grained PAT, login `Arjunyadavsoma`) has contents read/write; the missing permission is **pull_requests: write** (actions: write also absent — workflow dispatch 403 verified in the same session).
- No bypass was attempted: nothing was pushed directly to `main`, and branch protection was not touched.
- Manual PR URLs for the maintainer:
  - https://github.com/Arjunyadavsoma/printshop-saas/compare/main...phase4-release-qualification
  - https://github.com/Arjunyadavsoma/PrintEXE/compare/main...phase4-release-qualification
- PR titles and full review-ready descriptions (scope, migration impact, API compatibility, security, test evidence, limitations, rollback) were prepared and are included in the commit messages and section F of the Phase 5 report (`docs/PHASE5_MERGE_REPAIR_RELEASE_REPORT.md`, both repos).

### A.2 Fresh-state verification (Phase 0 of this phase) — PASSED

- Both clones verified: correct toplevel, correct `origin` remote, branch = phase4-release-qualification, `git fetch --all --prune` clean.
- Reported Phase 5 commits exist and are the branch tips (f702d96 / c61d61d).
- Ancestry: `origin/main` is the merge-base of both branch heads — **no divergence** (left-right counts 0/15 and 0/11).
- No uncommitted changes, no untracked sensitive files.
- Secret safety scan: tracked files (git grep for github_pat_/ghp_/ghs_ patterns) — clean; 409 workflow-log files across 6 recent runs (both repos) — clean; release assets (v0.6.1-rc.3 ZIP, all 298 ZIP entries + README.txt + SHA256SUMS.txt + BUILD-INFO.txt) — clean. No token material anywhere; no remediation required. (Chat-transcript hygiene: the PAT was pasted into chat by the operator twice in earlier turns — outside any tracked file; revocation/rotation remains recommended.)

---

## B. Code review (complete diffs vs main, both repos)

### B.1 Scope reviewed

- SaaS: full diff origin/main…origin/phase4-release-qualification — 48 files, +3,659/−245.
- PrintEXE: full diff origin/main…origin/phase4-release-qualification — 37 files, +2,430/−152 (plus the Phase 6 fix commit, 2 files, +139/−2).

### B.2 Findings by severity

| # | Severity | Repository | Finding | Status |
| --- | --- | --- | --- | --- |
| 1 | **HIGH** | PrintEXE | **Updater could never install any release.** `GitHubUpdateService.PortableZipName` selects assets by the literal name `PrintShopCompanion-portable.zip`, but the release pipeline published only `PrintEXE-v<tag>-win-x64.zip` (+ text assets). `DownloadUrl` was therefore null on every release: `CheckForUpdatesAsync` would show "update available", `InstallUpdateAsync` would throw. The stable-gate item "updater behavior is verified" could never pass. | **FIXED** in commits 83210a4 + c92a3df (see B.3) |
| 2 | Medium | SaaS (main only) | Pre-existing red scheduled workflow `cleanup-cron.yml` ("Scheduled Background Jobs" — runs 44204095321 et al.): "Call cleanup endpoint" fails — it targets the deployed backend URL with a token that is not configured. Runs on `main` schedules only; NOT part of the branch diff; the branch's ci.yml fix does not cover it. | DOCUMENTED — must be fixed on main separately (deployment/secret config) |
| 3 | Low | SaaS | `GET /shops/me/jobs` does per-job file/agent lookups (N+1, capped at 100 rows) — acceptable for the operator view; noted for a future single-query refactor. | DOCUMENTED (accepted) |
| 4 | Low | SaaS | `with-auth.ts` device routes rate-limit at 150 req/min/agent/path by default — sized above the companion's worst case (~60/min). Documented, no change needed. | DOCUMENTED (accepted) |
| 5 | Info | SaaS | Migration chain: `20261015172034_init` was a duplicate SQLite-dialect init (would fail immediately on PostgreSQL; the real init is `20251107000000_init`). Phase 0 (commit a2d312c) converted it to a documented no-op (`SELECT 1;`), keeping the folder name so `_prisma_migrations` rows stay consistent; fresh `migrate deploy` and upgrade paths verified. Referenced docs exist (`docs/DATABASE_MIGRATION_AUDIT.md`, `docs/KNOWN_LIMITATIONS.md`). | VERIFIED CORRECT |

No unresolved critical or high-severity defect remains in either diff.

### B.3 Phase 6 fix — PrintEXE 83210a4 "publish PrintShopCompanion-portable.zip updater asset + release gate"

- `.github/workflows/build-windows.yml`: packaging step now also publishes the ZIP byte-identically as `PrintShopCompanion-portable.zip` (the name every shipped updater binary searches for); SHA256SUMS.txt includes it; round-trip verify asserts byte-identity; the release job refuses to publish when the portable asset is missing or its hash differs; a new post-release step fails the run unless ALL required assets exist (tag ZIP, portable ZIP, SHA256SUMS.txt, README.txt, BUILD-INFO.txt).
- `tests/…/GitHubUpdateServiceTests.cs`: regression tests pin the `PortableZipName` contract and prove `DownloadUrl` resolves only when the portable asset is published (null otherwise).
- Follow-up commit c92a3df: the new post-release gate step initially invoked `gh` without `GH_TOKEN` and failed its own mechanics on tag rc.4 (exit 4, before evaluating any asset); fixed by exporting `GH_TOKEN: ${{ github.token }}` for the step. rc.4's release content itself was verified correct externally (prerelease=true, all five assets present, GitHub-side digests prove the portable ZIP byte-identical to the tag ZIP); rc.5 re-ran the full pipeline green.
- Scope discipline: release pipeline only; no printing/queue/pairing behavior changed; rc.1–rc.3 releases untouched (rc.4/rc.5 are new tags).

### B.4 SaaS review conclusions (no new fixes needed)

All reviewed areas behaved as intended and were confirmed against the diff: entitlement race repair (pre-check + post-insert reconciliation + audit + contract code `ENTITLEMENT_REQUIRED`), additive partial-index migration (`20251119000000_printjob_active_file_unique`, PostgreSQL-dialect, idempotent `IF NOT EXISTS`), rate-limit lost-expire fail-open, versioned device-token hashing (v2 HMAC + legacy compat + timing-safe compare + production fail-fast pepper), rotation with optimistic lock (`ROTATION_CONFLICT` 409) and a method-scoped read-only overlap allowlist, webhook idempotency by database arbitration under READ COMMITTED (unique event row + guarded conditional updates; Serializable was demonstrably wrong), honest `needs_review` state machine (printing|queued → needs_review, conditional updates, 409 on races), storage-failure envelopes (per-job failedJobs, 503 `STORAGE_UNAVAILABLE`, no provider internals leaked), FK-aware agent deletion, corrected realtime event list, and CI PostgreSQL provisioning. No applied migration was rewritten (see B.2 #5); no `db push` substitute; uniqueness remains database-enforced.

### B.5 PrintEXE review conclusions (one fix, B.3)

Confirmed correct: fail-visible apply-and-verify SQLite pragmas (WAL/NORMAL/busy_timeout=5000/foreign_keys, connection disposed on init failure), widened `MarkOutcomeUnknownAsync` guard (crash-recovery park no longer a silent no-op), fail-closed SQLCipher key store (a DPAPI load failure no longer overwrites/destroys the key file), crash-leftover claim handling (parks as OutcomeUnknown + reports needs_review, never cancels or reprints), single comma-joined `-print-settings` argument, no synthetic spooler ID (id 0 → honest uncertain path instead of fake "completed"), `needs_review` (not `failed`) reporting for uncertain outcomes, bounded 3-attempt completion reporting, lazy DPAPI credential restore seeding the shop context, atomic DPAPI persist with .tmp/.bak/round-trip-verify, per-user AppData settings override, both pairing schemes accepted with explicit user confirmation (no auto-pair), revocation clearing local credentials, 30-day rotation policy, installer registering both URL schemes, SemVer prerelease tag → valid AssemblyVersion mapping, in-ZIP README/BUILD-INFO, tag-matched ZIP name, fail-visible release collision, prerelease flag.

### B.6 Remaining risks (accepted, documented)

- Rate-limit keying with unset `TRUSTED_PROXY` collapses to a per-scope "unknown" bucket (deployment configuration decision).
- EXE surfaces SaaS error messages but does not branch machine-readably on `ENTITLEMENT_REQUIRED` (current flows show the message in the pairing UI; no behavioral branch required).
- Pre-existing `cleanup-cron.yml` red on main (B.2 #2).
- Cross-compilation caveat: Windows execution evidence comes exclusively from GitHub Actions windows-latest runs; the Linux sandbox cannot run the WPF app.

---

## C. CI and tests

### C.1 printshop-saas (commit f702d96 — exact Phase 6 head)

| Check | Kind | Result |
| --- | --- | --- |
| Fresh PostgreSQL 16.2 (user-space server, 127.0.0.1:5433 — same major version as the CI postgres:16 service) — `prisma migrate deploy` on brand-new database `phb_p6` | local, real engine | **PASSED** — 14 migrations applied, exit 0 |
| Partial index `PrintJob_active_file_unique` present after fresh deploy | local SQL verification | **PASSED** (pg_indexes) |
| Upgrade idempotency — `migrate deploy` re-run on already-migrated `phb_app` | local, real engine | **PASSED** — no-op, exit 0 |
| `prisma validate` | local | **PASSED** |
| Full test suite (`bunx vitest run`, real PostgreSQL for the five integration suites) | local, real engine | **PASSED** — 58 test files, **661 passed / 4 skipped / 0 failed** (64.37s) |
| `tsc --noEmit` (strict) | local | **PASSED** (exit 0) |
| ESLint | local | **PASSED** (0 errors, 5 pre-existing warnings, exit 0) |
| Production build (`next build`) | local | **PASSED** (exit 0) |
| GitHub Actions CI on this exact head | CI | **NOT EXECUTED** — CI triggers on push-to-main and PRs; PR creation is 403-blocked (A.1). The branch's ci.yml fix provisions the PostgreSQL service the current main-head runs lack (runs 44099609616 et al. failed with ECONNREFUSED). |
| Playwright E2E | — | **NOT EXECUTED** — no Playwright configuration exists in the repository. |
| Vercel staging validation | — | **BLOCKED** — see section D. |

The 4 skipped tests are the documented environment-conditional skips from the Phase 5 baseline (SQLite-file-dependent checks that require a configured path); they are unchanged and intentional.

### C.2 PrintEXE (commit c92a3df — exact Phase 6 head; tag v0.6.1-rc.5)

| Check | Kind | Result |
| --- | --- | --- |
| windows-build workflow (windows-latest): restore, Release build, full test suite, publish, startup smoke test, packaging, checksums | CI (real GitHub Actions, run 44209224616, head=c92a3df, tag v0.6.1-rc.5) | **PASSED** — Build/test/package job green |
| Full test suite on Windows, exact per-suite counts (one `dotnet test` invocation, two DLLs) | CI (same run) | **PASSED** — PrintShopCompanion.Infrastructure.Tests: **145 passed / 0 failed / 0 skipped**; PrintShopCompanion.Queue.Tests: **30 passed / 0 failed / 0 skipped** (175 total) |
| Startup smoke test (published EXE alive after 20s on the Windows runner) | CI (same run) | **PASSED** |
| Release job: artifact download, re-verification, portable-asset byte-identity, GitHub Release creation, post-release updater-contract asset gate | CI (same run) | **PASSED** — release published with all 5 required assets; gate exited 0 |
| rc.4 run 44207432447 (head=83210a4) | CI | **FAILED** — build job green incl. the new packaging steps; release created correctly; the post-release gate failed on its own missing `GH_TOKEN` (B.3, fixed by c92a3df). Release content verified correct externally (see F.1). |
| Prior baseline runs (unchanged code) | CI | rc.2 run 44201022962 PASSED; rc.3 run 44202751419 PASSED; rc.1 run 44199705627 FAILED (release-workflow defects — no release created; fixed by 952fe00/bb285a9 lineage) |
| SHA-256 round-trip of the downloaded rc.5 ZIP + portable asset vs SHA256SUMS.txt and GitHub asset digests | post-download verification | **PASSED** (values in section F.2) |
| Local Windows validation (build/run on a real Windows machine) | local | **NOT EXECUTED** — Linux sandbox; cross-compile only. All Windows evidence is from real GitHub Actions runners (no local simulation). |
| Physical printer validation | hardware | **BLOCKED** — see section E. |

Run URL: https://github.com/Arjunyadavsoma/PrintEXE/actions/runs/44209224616

### C.3 Counting discipline

Counts are never mixed across suites: the SaaS numbers are one vitest invocation (58 files); the EXE numbers are one `dotnet test` invocation inside the windows-build run; smoke test and packaging are workflow steps, not test counts; checksum verification is a separate workflow step.

---

## D. Staging environment and cloud integration — BLOCKED

**Status: BLOCKED — no Vercel/staging credentials exist in the environment.** No staging project, deployment token, or staging database was provided; per the phase rules no production data or production credentials were used, and no staging claim is made. The Phase 4 REST-fallback evidence remains a local production build, explicitly NOT a staging validation.

Setup required to unblock (maintainer actions):
1. Create an isolated Vercel project (or preview deployment channel) for staging; grant a Vercel token with `deployments: write` scoped to it.
2. Provision a dedicated staging PostgreSQL (not a copy of production) and set `DATABASE_URL`.
3. Set required env vars on the staging project: `DEVICE_TOKEN_PEPPER` (≥16 chars), `APP_BASE_URL` (staging URL), storage credentials (`STORAGE_PROVIDER` + keys), payment adapter test credentials, realtime secret(s).
4. Run `prisma migrate deploy` against the staging database once, then deploy the `phase4-release-qualification` head (SaaS f702d96).

Required cloud scenarios — all **NOT EXECUTED (BLOCKED)**: 1 shop registration/auth; 2 shop/device pairing; 3 pairing-ticket expiry + replay rejection; 4 device-token→JWT exchange; 5 device disable/revoke enforcement; 6 heartbeat/online-offline; 7 job creation + file upload; 8 storage presigning/download; 9 storage provider failure behavior; 10 job retrieval/status updates; 11 device command creation/delivery; 12 command authorization + shop isolation; 13 realtime event delivery; 14 REST polling fallback; 15 payment webhook duplicate delivery; 16 concurrent duplicate payment events; 17 payment retry after rollback; 18 subscription entitlement changes; 19 token rotation; 20 operator resolution of uncertain outcomes; 21 audit event creation; 22 API compatibility with existing clients.

Cross-cutting staging assertions (tokens never in URLs/logs; long-lived credentials never used as realtime JWTs; no cross-shop subscriptions; exactly-one financial effect for duplicate payments; no automatic reprint of uncertain outcomes; storage errors never expose provider secrets; operator resolution recorded as an operator assertion) — all **NOT EXECUTED (BLOCKED)** for the deployed environment. The code-level equivalents of these assertions ARE verified by the automated suites (661 passed locally + 171 on Windows CI), which is evidence about the code, not about a deployed staging system.

---

## E. Physical Windows printer validation — BLOCKED

**Status: BLOCKED — no physical Windows machine or printer is available in this environment.** Per the phase rules no success is inferred from mocks, spooler-level tests, or the Windows-runner smoke test. The startup smoke test (real Windows runner, app alive after 20s) is the only executed Windows-runtime evidence and is explicitly NOT a hardware print result.

Hardware test matrix — all 20 scenarios **NOT EXECUTED**: 1 fresh install/first startup; 2 pairing with staging shop; 3 printer discovery/selection; 4 test print with operator confirmation; 5 normal PDF print; 6 large PDF print; 7 printer offline before submission; 8 printer disconnect during printing; 9 PrintEXE crash during a job; 10 Windows restart with queued jobs; 11 queue pause with job in flight; 12 resume after pause; 13 cancellation before dequeue; 14 cancellation during in-flight operation; 15 duplicate command delivery; 16 network loss/recovery; 17 device token rotation; 18 device revocation; 19 SQLCipher database reopen/recovery; 20 app shutdown/restart.

Uncertain-outcome handling (preserve OutcomeUnknown, no auto-reprint, operator resolution, never label spooler acceptance as physical output) is enforced in code and covered by automated tests (JobProcessor, SqliteJobQueue, status route); its PHYSICAL behavior remains unverified — hardware gate BLOCKED.

---

## F. Release

### F.1 RC releases (all pre-releases; none overwritten)

| Tag | Commit | CI run | Status | Assets verified |
| --- | --- | --- | --- | --- |
| v0.6.1-rc.1 | bb285a9 | 44199705627 (FAILED) | superseded — workflow defects; no release published | — |
| v0.6.1-rc.2 | 3c87367 | 44201022962 (PASSED) | published, prerelease=true | yes (Phase 5) |
| v0.6.1-rc.3 | 952fe00 | 44202751419 (PASSED) | published, prerelease=true | yes (Phase 5 + re-verified this phase: SHA-256 round-trip exact, ZIP self-contained incl. e_sqlcipher.dll, README+BUILD-INFO inside ZIP) |
| v0.6.1-rc.4 | 83210a4 | 44207432447 (FAILED — gate GH_TOKEN mechanics; content correct) | published, prerelease=true | yes — verified externally: all five assets incl. the NEW PrintShopCompanion-portable.zip, GitHub digests prove byte-identity (sha256 bd94b8f9935b… for both ZIPs) |
| **v0.6.1-rc.5** | **c92a3df** | **44209224616 (PASSED)** | published, prerelease=true | yes — see F.2 |

### F.2 v0.6.1-rc.5 verification (downloaded from the published release)

- Asset list: PrintEXE-v0.6.1-rc.5-win-x64.zip, PrintShopCompanion-portable.zip (NEW — updater contract), SHA256SUMS.txt, README.txt, BUILD-INFO.txt.
- SHA-256 round-trip exact: recomputed hashes of BOTH downloaded ZIPs = `6bf32a4b49c748e83aba815c296844e008ed5ef47a7a5106a1b7061efc7c4cc9` = SHA256SUMS.txt line = GitHub asset digest. The portable updater asset is byte-identical to the canonical ZIP, so the updater can now find, digest-verify, download, and install a release.
- BUILD-INFO.txt in SHA256SUMS: `53590b02ef3fb7857af74e53d923d9daa865cd10da37c9bec267974fc7813b95`.
- ZIP contents: self-contained win-x64 publish (runtime + e_sqlcipher.dll + README.txt + BUILD-INFO.txt).
- Prerelease exclusion LIVE-verified: `GET /releases/latest` returns **v0.6.0** (the last stable), not rc.5 — the updater (`GitHubUpdateService.CheckForUpdatesAsync` polls exactly that endpoint, evidence: src/PrintShopCompanion.Infrastructure/Update/GitHubUpdateService.cs:107) can never offer an RC to stable users. Enforced for future tags by the workflow's prerelease-detection step + `prerelease:` flag on the release.
- Updater behavior (stable-gate item): now satisfied for the first time — the asset the updater requires exists on the release, is checksum-identical to the canonical ZIP, and the updater's semver comparison / digest verification / install flow are covered by GitHubUpdateServiceTests (145 passed incl. the 3 Phase 6 contract tests).
- Next stable version (from existing tags — not guessed): the repository's stable tags end at **v0.6.0**; the RC series v0.6.1-rc.1…rc.5 targets the numeric core **v0.6.1** as the next stable version. The stable release itself is NOT created (gates incomplete, F.3). Note for that future release: an rc user's AssemblyVersion is already 0.6.1.0 (stripped core), so IsNewer will treat a same-numeric stable 0.6.1 as "not newer" by design — RC users upgrade by manual download or wait for the next higher stable version; documented, accepted.

### F.3 Stable release — BLOCKED (gates incomplete)

Stable release gates: both PRs merged (BLOCKED A.1) · post-merge CI green (NOT EXECUTED — depends on merge) · staging validated (BLOCKED D) · physical printer validated (BLOCKED E). Per the phase rules the stable release is **not created**, rc.5 is retained as the qualification pre-release, and no RC was overwritten.

Rollback procedure (documented): revert the merge commit on either repo; the SaaS additive index may remain (drop SQL in the Phase 5 report §migration); EXE users reinstall a prior release ZIP; updater only offers versions newer than the installed one.

---

## G. Final decision

**BLOCKED — PERMISSIONS OR ENVIRONMENT**

Evidence supporting the decision:
- All code-level work is complete and verified: full-diff senior review of both repositories (section B), one HIGH defect found and fixed with regression tests (B.3, 83210a4 + c92a3df), SaaS suite 661/4/0 on real PostgreSQL 16 at the exact head with fresh + idempotent migration evidence (C.1), and real Windows CI green on the exact Phase 6 head (175/0 tests) with the updater-contract release gate passing end-to-end (C.2, F.2).
- The remaining gates are all environment-gated, not code-gated: PR creation/merge (HTTP 403 — missing `pull_requests: write`), Vercel isolated staging (no credentials), physical printer hardware (no machine/printer), and consequently the stable release (correctly withheld).
- Nothing was faked: no direct push to main, no bypassed protection, no simulated Windows or staging result, no stable release without authorization, and every BLOCKED/NOT EXECUTED item is labeled as such.
