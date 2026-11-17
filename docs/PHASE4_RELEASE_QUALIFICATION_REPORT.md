# Phase 4 — Independent Release Qualification Report

Branches: `phase4-release-qualification` (both repos). No history rewrites. No merges. No production changes.

## 1. Repository state

| Repo | Phase 3 tip (verified) | Final commit | Working tree |
|---|---|---|---|
| printshop-saas | `fc622b0` on `phase3-critical-repairs` | see §12 | clean |
| PrintEXE | `6f1c068` on `phase3-critical-repairs` | see §12 | clean |

- Roots verified: SaaS `fcbfb99…`, PrintEXE `dcf8678…` — unrelated histories;
  no cross-repository commits.
- Correct roots/remotes/branch names verified before every push
  (`rev-parse --show-toplevel`, `remote -v`, `status --short`, `log -5`);
  every push re-fetched and matched the local tip.
- Large-artifact scan: no tracked file >5 MB in either repo (an untracked
  `.next` build cache in the SaaS working copy was removed before push).
- Credential scan (`git grep -I` for PAT/AKIA/sk-/private-key patterns): clean
  in both repos.
- Documentation placement verified: PHASE3 report present in both repos.

## 2. Payment correctness (independent verification)

Fresh PostgreSQL 16.2 instance (`phb_p4`), independent connections.

**Transaction design re-inspected** (not assumed from Phase 3): the
interactive transaction in `lifecycle.service.ts` runs `ReadCommitted` with
database-level arbitration — `PaymentEvent UNIQUE([provider, eventId])`
INSERT (23505 → idempotent skip), conditional `PaymentAttempt` update
(status IN created/pending), conditional `Order` update (status =
awaiting_payment). Constraints verified directly in `pg_constraint`:
PaymentEvent→PaymentAttempt FK, PaymentAttempt→Order FK, both shop FKs.

**Independent suites (97 passed + 1 documented skip across 9 files):**
- NEW `payment-connection-loss-phase4.test.ts` — 3/3:
  - backend connection **killed mid-transaction** (`pg_terminate_backend`)
    → zero partial state, retry applies exactly once;
  - constraint failure mid-transaction → full rollback INCLUDING earlier
    benign writes in the same transaction, retry exactly once;
  - duplicate delivery after commit → zero additional effects.
- 16-scenario webhook concurrency suite: 16/16 (single, sequential duplicate,
  2 and 10 concurrent duplicates, different-event same-payment, different
  payments, transaction failure, failure-after-claim, retry-after-rollback,
  invalid signature, amount mismatch, unknown reference, old-event replay,
  refunded, captured) — `financial_effect_count = 1` asserted exactly.
- App-level real-PG webhook integration (real `processWebhook` +
  `applyPaymentTransition` + real Prisma): 15/15.
- checkout real-PG partial-unique-index suite: 12/12; FK suite: 6/6;
  checkout-concurrency: 1/1; persistence (PGlite): 13 + 1 documented skip;
  rotation/job-state: 23.

**Per-provider inspection (semantics NOT assumed to be shared):**
- **PhonePe** — dedicated webhook route; `x-verify` signature verified before
  any state change; server-side `verifyPayment` before transition
  (fail-closed); funnels into the shared transactional core.
- **Paytm** — callback route, form-urlencoded `CHECKSUMHASH` verification,
  HTML response to the customer's browser; same transactional core, distinct
  transport and failure surfaces.
- **UPI deep-link** — NO webhook by design; customer polls
  `GET /payments/upi/verify/:orderId`, which is order-token-guarded
  (SEC-001/C2) and reads authoritative DB state. The design correctly does
  not reuse webhook assumptions.

## 3. Uncertain-job resolution (independent, live on the production build)

17/17 checks against the Phase 4 branch's production build (real PostgreSQL,
`STORAGE_PROVIDER=disabled` — production-legal mode):
- jobs listing carries deviceName/devicePrinterName/queuedAt/fileName;
- shop isolation both directions (rival sees only own jobs; A-list excludes
  B's);
- rival resolve → 404; resolve on non-needs_review → 409; duplicate resolve
  → 409;
- resolution returns + persists the actual actor (`AuditLog.userId`),
  timestamp, outcome, job id;
- resolution survives refresh; UI refreshes from backend state;
- job-level uncertainty is distinct from document/page-level review
  (separate endpoints and data — PrintJob vs PrintFile pricing review);
- no automatic retry/reprint path exists; resolution is terminal;
- the UI never equates operator assertion with verified physical printing
  (the resolve response message explicitly says to create a fresh print
  request if another physical attempt is needed).

## 4. Pending-job storage handling (independent)

Unit (route-level, memory container): **8/8** — no pending jobs; valid
document; missing document (DOCUMENT_MISSING); storage unavailable
(503 STORAGE_UNAVAILABLE, machine-readable, retryable, no provider
internals); storage **timeout** (ETIMEDOUT-shaped, same classification,
internals not leaked); invalid job state (JOB_INVALID); unauthorized device
rejected by device auth; one failed document among multiple valid jobs
(healthy jobs still delivered); **recovery after temporary failure** (the
same job delivered on the next poll — never discarded or marked consumed).
Live: device poll on the production build returned the documented 503 with
`failedJobs[]` and the job remained queued.

## 5. Windows CI (release-blocking — BLOCKED)

- Workflow dispatch attempted on `phase4-release-qualification` →
  **403 "Resource not accessible by personal access token"** (the fine-grained
  PAT lacks `actions:write`). Not bypassed; no fabricated evidence.
- Both EXE test projects target `net10.0-windows` (WPF testhost) — they
  structurally cannot execute on Linux; execution is Windows-CI-only.
- Maintainer action (unchanged): repository `Arjunyadavsoma/PrintEXE`, branch
  `phase4-release-qualification`, workflow
  `.github/workflows/build-windows.yml`; grant **Actions: Read and write** to
  a fine-grained PAT and dispatch, or open a PR from the branch (triggers the
  workflow). Do not merge before review. Do not share credentials in chat.

## 6. Windows host + physical printer (BLOCKED)

This environment is a Linux sandbox: no Windows machine, no printer, no
spooler. Nothing was executed; no results are claimed. Maintainer action:
run PrintEXE on a supported Windows machine against staging and walk the
17-step checklist (first-run setup → shutdown) with a real printer,
inspecting actual paper output.

## 7. Vercel staging (BLOCKED)

No Vercel credentials in this environment. Verification performed on the
local production build + real PostgreSQL instead; a deployment with storage
disabled is NOT counted as full staging verification (per spec). Maintainer
action: `vercel deploy` of the Phase 4 commit with isolated PostgreSQL/
storage/auth/realtime env vars, then run the flows from §3–4 against it.

## 8. Realtime

- Code-level audit of `mini-services/realtime-service`: timing-safe HS256
  verification, exp enforcement (expired → reject), rooms strictly
  `shop:<shopId>` from verified claims, `/emit` relay secret-guarded with
  `shop:`-prefix anti-spoofing. Device permanent tokens never authenticate
  sockets — `POST /agents/token` exchanges them for a short-lived JWT
  (verified live; `accessToken` + `expiresIn` wire shape confirmed).
- Messages are notifications only; authoritative state changes flow through
  REST (device claims jobs/commands via REST and reports via REST).
- REST polling fallback verified live on staging (jobs/commands polls).
- Live multi-instance relay deployment remains blocked (no host) —
  documented as code-level verification only.

## 9. API compatibility

NEW drift harness (`scripts/phase4-contract-app`, Linux `net10.0` console
compiling the PrintEXE DTO sources **verbatim**): **14/14** — LIVE fixtures
captured from the current production build deserialize through the actual
DTOs with `JsonSerializerDefaults.Web` (permissive to added fields → additive
changes safe): pairing begin/pair (deviceToken 64-hex, agentId,
protocolVersion 1), heartbeat, jobs/pending 503 error envelope
(`details.retryable`, `failedJobs[]`), agents/token JWT exchange
(`accessToken`/`expiresIn`), `companion/commands` poll, error envelopes
(`success=false` + `error.code` + `error.message`).
- Compatibility note: the `jobs/pending` 503-with-details shape is additive
  (Phase 3); older released clients that only read `jobs[]` must treat
  non-200 as "keep polling with backoff" — which is exactly what the
  existing client does on non-success. Minimum supported PrintEXE version
  for the full resolution + storage-error behavior: **0.4.7.x** (Phase 2/3
  contract set); upgrade path documented in `docs/UPGRADE_FROM_V047.md`.

## 10. Final security audit

- Authentication/shop isolation: JWT shop scoping verified live (§3).
- Device authorization: device-token + pepper validation; **disabled devices
  rejected** (`DEVICE_DISABLED` in `with-auth.ts` H2 fix); revocation =
  delete (device list + revoke verified live during fixture capture —
  entitlement gate `multi_device` also observed enforcing plan limits).
- Command allowlist: exactly 7 types via `z.enum`
  (refresh_printers/pause/resume/cancel_job/retry_job/test_print/diagnostics)
  — no arbitrary process execution; payload size bounded (Phase 2 §11
  hardening); idempotency keys honored.
- Webhook signature: verified before any state change (invalid signature →
  zero effects, suite 11 of the concurrency set).
- Payment replay: unique-arbitration + conditional guards (§2).
- Secret hygiene: no PAT/AKIA/sk-/private-key patterns in either repo
  (tracked content) or in staging logs (log scan matched only request paths);
  credentials for local staging are generated at start, never persisted.
- Local credential storage: DPAPI on Windows (persistence seam covered by
  Windows-only test projects — execution blocked with CI, §5); SQLite
  pragmas reviewed in code (`busy_timeout`, WAL) — SQLCipher runtime tests
  are Windows-CI-only.
- Rate limiting: register brute-force guard observed live (429, 5/60s).
- Migration safety: `prisma migrate deploy` clean on fresh databases;
  migration chain unmodified in Phase 4.

## 11. Final regression

SaaS (commit in §12):
- `tsc --noEmit` — clean.
- `eslint src --ext .ts,.tsx` — 0 errors, 5 pre-existing warnings.
- Full `vitest run --no-file-parallelism` — **57 files: 657 passed, 4 skipped
  (documented), 0 failed** on this exact commit.
- Production `next build` — exit 0.
- Real-PG integration + payment concurrency + resolution + storage — §2–4.

PrintEXE:
- `dotnet build PrintShopCompanion.sln -c Release` — **0 errors** (42
  pre-existing warnings).
- Test projects — **blocked on Linux** (`net10.0-windows`); execution gated
  on Windows CI (§5). Local Linux build is NOT counted as a substitute.
- Installer/DPAPI/SQLCipher/queue-recovery/realtime-startup/physical
  printing — all gated behind Windows CI/host; not executed, not counted.

## 12. Final commit SHAs

- printshop-saas `phase4-release-qualification`:
  `23a7f55` (qualification suites) → `0697a24` (fixture carry-over) →
  docs commit (branch tip; verify after push).
- PrintEXE `phase4-release-qualification`: `6f1c068` + docs commit (tip).

## 13. Passed / Failed / Blocked / Not executed

| Status | Items |
|---|---|
| **Passed** | SaaS typecheck; lint; full test suite (see counts); real-PG payment suites (97 + 3 new connection-loss + 16 + 15 + 12 + 6 + 1 + 8 + 23 across files, 1 documented skip); live 17-check resolution/storage suite; contract drift 14/14; EXE Release build 0 errors; repository-integrity scans |
| **Failed** | None |
| **Blocked** | Windows CI run (403 permission); EXE test execution (Windows-only TFMs); Windows host + physical printer; Vercel staging; live multi-instance realtime relay; provider-sandbox payment E2E |
| **Not executed** | Installer validation; URI registration check on a real host; DPAPI/SQLCipher runtime tests; heartbeat lifecycle on Windows; physical print output inspection |

## 14. Outstanding risks

1. Windows CI has never executed on the Phase 3/4 branches — the EXE test
   suite (DPAPI, SQLCipher, queue recovery, rotation) has compile-level
   evidence only (0-error Release build) and Windows-runtime tests remain
   unproven on Windows itself.
2. No physical-printer validation ever occurred.
3. Payment E2E against provider SANDBOX remains unexecuted (evidence is
   real-PostgreSQL + forged-valid signatures; no provider network calls).
4. Live multi-instance realtime relay unproven (single-process memory
   provider exercised; relay code audited).

## 15. Release decision

**NOT READY — VERIFICATION BLOCKED.**

No code defects remain: every defect raised in Phases 2–3 is fixed with
independently reproduced evidence, and the full SaaS suite plus live
production-build checks are green. However the mandatory Windows CI gate
(§5), Windows-host/physical-printer gate (§6), and isolated Vercel staging
gate (§7) have no evidence because the required infrastructure access was
not available. Per the qualification rules, a ready-for-review decision
requires actual evidence for every mandatory gate.
