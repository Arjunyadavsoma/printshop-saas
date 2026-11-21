# PHASE 4+5 REPORT — PrintEXE print-truth, delivery integrity, companion UX polish

Date: 2026-11-20 · Base: saas `3c8b61b` / exe `861a6c2` → Heads: saas `90c9dfe` / exe `b746ae3`+ (Phase 5 commit) · Status: complete

## Phase 4 — print-truth + delivery integrity (saas 90c9dfe, exe b746ae3)

### Real bugs found and fixed
1. **`delivery-coordinator.ts` bypassed the container entirely** — it used the raw Prisma client (`import { db } from '@/lib/db'`), so receipt/cleanup writes ignored test containers. The two `processCleanupTasks` tests "passed" only while the shared dev DB happened to have no pending cleanup tasks; the Phase-3 probes created some and the suite went red. Fully rewritten onto `getContainer().db` (adapter API, in-memory-compatible). Coordinator tests 10/10; full battery 60/60 files, 690 passed / 4 skipped, build 0.
2. **Companion dropped the checksum** — `MapToRecord` hard-coded `PdfSha256 = null` even though the DTO carried the field; combined with the SaaS having NO `PrintFile.sha256` column, pre-print content verification could never fire. Fixed end-to-end (below).

### B-008 — honest print confirmation (companion)
- `IPrinterService.HasPrintedAsync` bool → **3-state `SpoolConfirmation`** (Printed / Failed / Unknown). "Job vanished" is no longer evidence of printing unless the job was ever seen alive (`_everSeenAlive` tracking; vanished-after-seen ⇒ purged print; never-seen ⇒ Unknown). Spooler error statuses (Error/Deleted/Offline/PaperOut/Blocked/UserIntervention) ⇒ **Failed**.
- `JobProcessor` confirm loop: Failed ⇒ `FailAsync` (attempt budget + honest backend "failed" report); Unknown ⇒ polls to the deadline ⇒ UncertainSpooled (needs_review) — the operator contract is unchanged.
- Two of the three original claims were **stale**: Sumatra already returns 0 (no synthetic id) and RawGdi has a real winspool raw-byte passthrough (StartDocPrinter/WritePrinter) — the placeholder is only the GDI fallback.

### B-010 — SHA-256 on the print path (cross-repo)
- SaaS: `PrintFile.sha256` column (migration `20261120093000_printfile_sha256`), server-side hashing at confirm time (`node:crypto` over the same bytes the parser reads), `pdfSha256` in the agent pending payload, receipt checksum **audit** (mismatch ⇒ `checksum-mismatch` errorCode on the delivery attempt; store-on-null = trust-on-first-use, documented in KNOWN_LIMITATIONS).
- Companion: `PrintJobDto.PdfSha256` + mapping carried into the job so `DownloadPdfAsync`'s existing mismatch-throw verifies BEFORE printing.
- **Live probe 14/14** (`docs/audit/phase3/10-delivery.log`) — includes two new checks: the pending payload carries the server-side hash, and the receipt audit passes on matching checksums.

### B-012 — token redaction (companion)
- `DeviceTokenRedactor` existed but was **never wired**. Now a sink decorator (cascading logger: outer config → redactor → inner rolling File logger) that scrubs sensitive property values AND message-template text (x-printshop-device-token / authorization / bearer / token= patterns). Balloon-severity plumbing fixed on the way.

### B-009 — STALE
`CommandExecutor` routes pause/resume to the JobProcessor's cooperative gate with honest idempotent semantics — the claim predated the Phase-F wiring. Closed with evidence.

## Phase 5 — companion polish (exe)

- **B-016 verified ALL-STALE**: printer choice persists via `LocalSettingsStore.Set` (atomic, %AppData%); the override file is loaded from both exe-dir and %AppData%; `TokenStillValid: true` is only reachable after an authenticated heartbeat (401 throws first).
- **B-017 fixed (verifiable parts)**: real brand assets generated (`app.ico` multi-resolution, `app.png`, 512px, tray state variants) + `<ApplicationIcon>`; **tray connection states** (green/gray/red status dots + state-named tooltips) driven by the heartbeat loop; the **empty "Pause queue" stub now drives the real `IQueueController` gate** with a truthful toggle header; balloon severity actually passed. First-run: the existing Login/pairing flow already covers unpaired startup (stale claim part).
- **B-021 decided**: tests stay net10.0-windows, CI-gated (windows-latest runs the authoritative 216-test suite); Linux builds of the full solution incl. test-project compile pass, so compile errors surface before push. Multi-targeting would fork the suite for zero coverage gain.

## Verification summary

| Check | Result |
|---|---|
| SaaS battery | vitest **60/60 files, 690 passed / 4 skipped, 0 errors**; tsc/lint/prisma-validate/migrate/build all **0** |
| Live delivery probe | **14/14** (`docs/audit/phase3/10-delivery.log`) |
| Companion solution | `dotnet build` **0** on Linux (net10.0-windows compile); test execution = windows CI on push |
| Coordinator tests | **10/10** after container-scoped rewrite |

## Unverified (unchanged, Windows-hardware / production)
B-002 PAT rotation · B-003 production redeploy · B-005 `CRON_SECRET` · B-004 realtime host decision · B-011 installer assets (needs Windows packaging) · rendered-icon/visual checks (Windows-only) · windows CI result for this push.

## Where this leaves the branch
All P0/P1 baseline items are now fixed-or-closed with live evidence; remaining open items are production/credential/Windows-hardware gates listed above. The branch is ready for review + CI.
