# PHASE 3 REPORT — dashboard + customer UX truth (fix/e2e-printshop)

Date: 2026-11-20 · Base: Phase 2 heads (saas `f7a73c8`) · Status: **complete, stopped for review**

## 1) What was found (with file paths)

- **P2-5 (polling)**: the claim was accurate — six bare `setInterval` loops polled while the tab was hidden (dashboard 15s, orders 20s, order detail 5s, payments 20s, shop customers 30s, customer tracking 30s). `/shop/devices` was already visibility-aware from earlier work.
- **P2-6 (route states)**: partially stale — the root `loading.tsx` / `error.tsx` / `not-found.tsx` already existed; the shop portal and customer-flow SEGMENTS had none.
- **P2-7/P2-8 (delivery surfaces)**: accurate — `PrintDeliveryAttempt` was write-only (only `agents/jobs/[id]/received` touched it; no read API anywhere).
- **REAL data bug found while proving P2-7/P2-8 live**: delivery attempt rows were only ever CREATED by the realtime-push dispatch path (`delivery-coordinator.ts:98`). The companion's actual pull-mode flow — `GET /agents/jobs/pending` → claim → `POST /received` — never created a row, and `markDeliveryReceived` fell through to a silent `success: true, "delivery tracking table not available"`. The receipt API reported success while recording NOTHING, which is why the delivery surfaces could never show data.
- Second, subtler bug: `PrintJob` has NO `orderId` column — the order link lives on `PrintFile`. Any join that assumes `printJob.orderId` returns nulls (dispatch code already knew this; my first view-service draft didn't).

## 2) What I changed and why

- **`src/lib/hooks/use-poll.ts` (new)** — shared visibility-aware polling: interval ticks skip while the tab is hidden; refresh fires immediately on re-visible; `enabled` flag (customer page stops polling at terminal order states); `immediate: false` so pages keep their non-silent initial load (spinner) with silent ticks. All six sites converted; intervals unchanged.
- **Route states**: `src/app/shop/loading.tsx`, `src/app/shop/error.tsx` (digest ref + Try again), `src/app/orders/[id]/loading.tsx` added in the existing root-file style.
- **Delivery read path** (`src/lib/services/delivery-view.service.ts`, new): joins attempt → job → **file** (orderId derived from `PrintFile.orderId`) → agent; `getShopDeliveryHistory(shopId, limit)` and `getOrderDeliveryAttempts(shopId, orderId)`.
- **`GET /api/v1/shops/me/deliveries`** (new, owner/staff, limit ≤ 200) — P2-8.
- **Order status payload** now includes `delivery[]` (best-effort try/catch — a delivery-read failure degrades to an empty list, never breaks payment polling) — P2-7.
- **Dashboard**: "Delivery history" Card (file, device, status chip, mode, time; empty state) fed by the new endpoint in the existing `load()` Promise.all.
- **Customer TrackStep**: per-file delivery chips (Queued → Sent to device → Received / Failed / Expired) with device name + error code, shown after payment.
- **`markDeliveryReceived` fix**: when no attempt row exists for the job, it now CREATES one (status `received`, `attemptId = prior + 1`, checksum/fileSize/completedAt recorded) instead of silently succeeding; cleanup scheduling kept best-effort.
- Docs: KNOWN_LIMITATIONS P2-1/5/6/7/8 annotated with what was actually true; BASELINE B-018 → fixed with evidence.

## 3) Commands run and real output

| Check | Result |
|---|---|
| Live delivery E2E probe (`scripts/phase3/delivery_probe.py`) | **13/13 passed** — `docs/audit/phase3/10-delivery.log`: register → pair device → ₹5.00 order → checkout → signed webhook → paid → **agent claims job from pending queue → posts /received →** `shops/me/deliveries` returns the joined row (file=probe.pdf, device=Delivery-Probe-PC-…, mode=cloud, status=received) **and** the customer status payload carries the same delivery attempt |
| Full battery | gen/routes/tsc/lint/pval/migr **0**; vitest **60/60 files, 690 passed / 4 skipped, 0 errors** |
| `next build` | **0** standalone (dev server must be stopped first in this 4 GB sandbox — same environment note as Phase 2) |

## 4) Unverified / manual (unchanged)

B-002 PAT rotation · B-003 production redeploy · B-005 `CRON_SECRET` · B-004 realtime host decision · B-022 Windows-hardware gates. The customer-facing TrackStep UI was verified via the API payload + code; a browser-level screenshot check is Phase-4-adjacent (needs a UI harness).

## 5) Next phase

**Phase 4 — PrintEXE print-truth** (B-008 `HasPrintedAsync` false positives / fabricated spool IDs, B-009 pause/resume honesty, B-010 PDF SHA-256 verification on the print path, B-012 token redaction into Serilog) — requires the Windows toolchain or honest Linux-side limits, on your go.
