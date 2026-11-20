# PHASE 2 REPORT — SaaS money + ops hardening (fix/e2e-printshop)

Date: 2026-11-20 · Base: Phase 1 heads (saas `675156c`) · Status: **complete, stopped for review**

## 1) What was found (with file paths)

The Phase-2 audit discovered the money/ops layer was **already hardened by the merged phase1–6 work** — the limitation docs were stale:

- **B-007 (P1 money) RESOLVED**: checkout persists `PaymentAttempt` BEFORE provider contact and aborts without it (`orders/[id]/checkout` STEP 2); `lookupPaymentSession` = cache → **PaymentAttempt DB fallback** (`webhook.service.ts:32-66`); `applyPaymentTransition` is transactional + idempotent via UNIQUE(provider,eventId) (`lifecycle.service.ts`). KNOWN_LIMITATIONS P2-1 prescribed exactly this fix — it was already implemented.
- **B-006 (P1 entitlements) RESOLVED**: `multi_device` enforced at 5 sites, `analytics` + `reports` gated; `delivery_tracking`/`advanced_pricing` are forward-declared flags with no product surface — nothing to enforce.
- **B-020 (P2 db-health) RESOLVED**: the route requires Bearer `ADMIN_ACCESS_KEY` and fails CLOSED when unset (FIND-011/F-04 already fixed).
- **Two REAL bugs in the dev simulate route** (`payments/dev/phonepe/simulate`), surfaced by the new live probe:
  1. schema `merchantOrderId: z.string().uuid()` rejected every real checkout merchantOrderId (`checkout-<uuid>-<ts>`) → route unusable for its documented purpose;
  2. signature scheme `sha256(body + '/pg/v1/status' + salt)` never matched the adapter's `sha256(body + salt)`, and the payload lacked the top-level `code: PAYMENT_SUCCESS` field UPIPay's `mapStatus` reads → every simulate would have verified as FAILED even with a correct salt.
- Order lifecycle nuance confirmed live: a paid order advances `awaiting_payment → printing` synchronously (print jobs enqueue inside the webhook pipeline) — `paidAt` + attempt status are the financial invariants, not the intermediate order status.

## 2) What I changed and why

- **Fixed the dev simulate route** (dev-only, unblocks local webhook testing): schema accepts checkout-format merchantOrderIds; signature = `sha256(base64Body + saltKey)`; payload carries top-level `code` (+ `paymentInstrument`). Verified one-off: `"summary":"attempt already in terminal status 'paid' (stale event skipped)"` — signature verifies, idempotent skip works.
- **New live E2E probe** (`scripts/phase2/payment_e2e_probe.py` + `db_step.js`, copied into the repo): 17 checks over real HTTP + real PG — register → credentials (plaintext-JSON dev path) → draft order → seeded ₹5.00 file (upload path is Phase 3) → checkout with `X-Order-Token` → **attempt persisted pre-provider** → correctly-signed v1 webhook through the production route (format per UPIPay: `{code, data}` + `sha256(body+salt)`) → order paid (`paidAt` set, print jobs enqueued) → PaymentEvent processed+signatureValid → **replay idempotent** (processed events 1→1, attempt stays paid) → tampered signature 401 → token rotate §15 4/4 (new token, 10-min old-token overlap, garbage 401).
- **BASELINE.md**: B-006/B-007/B-020/B-015 → closed with evidence (B-015 included the `docs/API_CONTRACT.md` supersede banner added this phase).

## 3) Commands run and real output

| Check | Result |
|---|---|
| Live money E2E probe | **17/17 passed** — `docs/audit/phase2/10-payment-e2e.log` |
| Simulate-route fix verification | 200, `applied:false` "stale event skipped" (sig verifies) |
| Full battery | gen/routes/tsc/lint/pval/migr **0**; vitest **60/60 files, 690 passed / 4 skipped, 0 errors** |
| `next build` | **0** (standalone; inside the shared 4 GB sandbox it needs the dev server stopped — environment constraint, noted for future phases) |

## 4) Unverified / manual (unchanged from Phase 0/1)

- B-002 PAT rotation, B-003 production redeploy, B-005 `CRON_SECRET` in Vercel (it is what reddens the cleanup-cron workflow on main), B-004 realtime host decision, B-022 Windows-hardware gates.

## 5) Next phase

**Phase 3 — dashboard + customer UX truth** (B-018: loading/empty/error states, polling pause on hidden tab, delivery history) — the last SaaS surface before switching to **Phase 4 PrintEXE print-truth** (B-008/009/010/012).
