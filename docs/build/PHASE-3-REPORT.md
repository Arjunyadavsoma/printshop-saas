# PHASE 3 REPORT — PrintPlanner + price engine + full unit-test matrix
Date: 2026-11-21 · Status: COMPLETE · Suite: vitest 64/64 files, 766 passed / 4 skipped, tsc 0

## Delivered
- src/lib/printing/page-range.ts — "1-5, 8, 10-12" parser: exact invalid-page errors ("Page 14 is out of range. This file has 12 pages."), reversed/zero/garbage rejection, All/Odd/Even helpers, human re-formatting.
- src/lib/printing/planner.ts — PURE PrintPlanner: pageModes source of truth (SKIP removed) → sides (N-up groups) → PHYSICAL sheets (front+back when duplex; any color page colors the sheet — a physical sheet is never split across printers) → COLOR_SET/BW_SET (or single FULL) preserving order → printer routing (ONLINE+enabled+paper-size+color/duplex capable; defaults honored; B&W prefers a B&W-only printer, falls back to a color printer; no eligible printer ⇒ task still created PENDING + warning) → warnings + collation guide (per-copy interleaving) → per-file pricing lines (duplex billing honors PER_PAGE_ACTUAL vs SHEET_AS_COLOR).
- src/lib/pricing/price-engine.ts — order-level: slab chosen per (size,color,sides,type) group on the TOTAL pages across the order; rate×pages×copies; integer paise everywhere, one rounding per line (exact); add-ons PER_ORDER/PER_COPY/PER_SHEET; urgent surcharge; missing rule ⇒ ruleMissing + null total (honest quote failure).
- src/lib/printing/task-pdf.ts — REAL pdf-lib: per-task PDFs (N-up imposition with hairline cell borders, duplex blank-back padding so sheet pairing survives), assembly slip PDF (interleaving steps + order meta + REAL QR via qrcode).
- src/lib/orders/state-machine.ts — order machine (incl. PRINT_THEN_PAY draft→queued, cancel-before-PRINTING, expire, PAID_ON_PICKUP) + task machine (dispatched/received/printing/spooled/printed/uncertain/failed/cancelled; UNCERTAIN terminal — never auto-retried) + shouldMarkReady (ALL tasks printed).
- src/lib/payments/upi.ts — VPA validation, UTR 12-digit, upi://pay intent from integer paise (am=36.00 style), PaymentVerifier interface (MANUAL default). Verification is NEVER automatic with the default adapter.

## Test matrix (46 tests in src/lib/printing/)
All §5.3 required cases: all-BW; all-color; mixed single-sided (DoD: 10 pages, 3&7 color → COLOR_SET[3,7] + BW_SET[1,2,4,5,6,8,9,10], right printers, ₹36.00); mixed double-sided odd page count (blank-back padding); N-up 2 and 4 with mixed colors; duplex+2-up (back-side color colors the whole sheet); SKIP pages; overlapping/invalid ranges (exact errors); copies with collate on/off (hand-merge warning + guide); no color printer (task created + warning); paper size unsupported; paused/error printers ineligible; duplex capability check; slab boundaries (49/50/99/100/101); SHEET_AS_COLOR vs PER_PAGE_ACTUAL totals; 1-page documents; 500-page document performance (2 ms ≪ 3 s); task PDFs re-validated (page counts 2/8, duplex padding, 2-up packing); assembly slip renders; state machines (happy paths + illegal transitions + UNCERTAIN terminality); UPI builder (integer paise, VPA/UTR validation).

## Bugs caught by the matrix (fixed)
- choosePrinter ignored `status === 'ONLINE'` — paused/error printers were eligible.
- State machine lacked the PRINT_THEN_PAY `draft → queued` path.
- (Design) duplex PER_PAGE_ACTUAL vs SHEET_AS_COLOR line units clarified in tests.
