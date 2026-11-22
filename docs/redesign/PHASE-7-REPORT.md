# Phase 7 Report — Independent Verification

**Date:** 2026-11-22
**Branch:** phase-7-verify-and-harden
**Base:** a2a09cf
**Approach:** Treat the Phase 2-6 report as a CLAIM. Prove each claim with code references + tool output. Fix what doesn't hold.

---

## 7.1 Fresh Build Verification

| Check | Result | Evidence |
|-------|--------|----------|
| ESLint (`bun run lint`) | ✅ PASS | `docs/redesign/evidence/build-verification.md` |
| TypeScript (`tsc --noEmit`) | ✅ PASS | Same |
| Prisma validate | ✅ PASS | Same |
| Unit tests (`vitest run`) | ⚠️ 7 files fail | All 7 are pipeline integration tests needing system deps (pdftoppm, libreoffice, ghostscript, PostgreSQL). 56 files pass, 675 tests pass. CI installs these deps — see `.github/workflows/ci.yml` step "Install system dependencies" |
| Production build (`next build`) | ⚠️ Not run in sandbox | 2-core CPU can't complete the build. Vercel builds successfully (live deployment verified). |

---

## 7.2 Claim Verification Table

Every claim from `CHANGELOG-REDESIGN.md` and `AUDIT.md` verified against actual code.

| # | Claim | Verdict | Evidence | Fix |
|---|-------|---------|----------|-----|
| 1 | Screens reduced 5 → 3 | ✅ **Verified** | `Stepper` component (`src/components/customer/stepper.tsx:7`) defines 3 steps: Files, Options, Pay. `CustomerOrderFlowV2.tsx:5` imports Stepper. | — |
| 2 | Visible fields ~14 → 4 presets | ✅ **Verified** | `CustomerOrderFlowV2.tsx:88` defines `PresetId = 'notes' | 'colour' | 'photo' | 'mix'`. Line 150-151 lists 4 preset cards. Comment at line 39: "default path shows four preset cards, not fourteen fields" | — |
| 3 | Touch targets 48px | ✅ **Verified** | `page-thumb.tsx:200`: `'touch-target'` class (min 48px). `page-strip.tsx:235`: `'touch-target inline-flex'`. All customer buttons use `min-h-[48px]` or `touch-target`. | — |
| 4 | Real UPI link (not pa=TODO) | ✅ **Verified** | `rg "pa=TODO"` returns zero results across `src/`. `CustomerOrderFlowV2.tsx:244` accepts `upiId: string` prop. Line 253 destructures it. Line 1151 passes it to PaymentSheet. | — |
| 5 | Stepper exists | ✅ **Verified** | `CustomerOrderFlowV2.tsx:5`: `import { Stepper } from '@/components/customer/stepper'` | — |
| 6 | Presets exist | ✅ **Verified** | 49 references to "preset" in CustomerOrderFlowV2.tsx. 4 preset cards defined. | — |
| 7 | IndexedDB draft recovery | ✅ **Verified** | `src/lib/customer/draft-storage.ts:89`: `indexedDB.open(DB_NAME, DB_VERSION)`. `saveDraft` at line 107. `use-draft-recovery.ts` hook loads/saves/clears. | — |
| 8 | Offline banner | ✅ **Verified** | `offline-banner.tsx` exists. Used in `/o/[token]/page.tsx:335,374,390,433`. Uses `navigator.onLine`. | — |
| 9 | aria-live on price/status | ✅ **Verified** | `sticky-action-bar.tsx:52`: `aria-live="polite"` on price. `/o/[token]/page.tsx:337,440`: `aria-live="polite"` on status. | — |
| 10 | Polling backoff | ✅ **Verified** | `use-track-poll.ts:14`: "Exponential backoff after 5 min — 5s → 10s → 30s → 60s". Line 35: `STALE_AFTER_MS = 5 * 60 * 1000`. Line 103: pauses when tab hidden. | — |
| 11 | Route siblings | ✅ **Verified** | 6 files exist: `loading.tsx` + `error.tsx` + `not-found.tsx` under both `/s/[shopSlug]/` and `/o/[token]/` | — |
| 12 | i18n (en/hi/te) | ✅ **Verified** | `src/lib/i18n/messages.ts`: 55 message keys × 3 locales = 165 translations. `i18n-provider.tsx` provides `useI18n()` hook. `language-switcher.tsx` renders EN/हिंदी/తెలుగు. | — |
| 13 | 17 analytics events | ✅ **Verified** | `analytics.ts:182`: `shopLanded: 'shop_landed'`. All 17 events defined as constants: shop_landed, upload_started, upload_failed, file_ready, preset_chosen, more_options_opened, page_picker_opened, colour_pages_changed, quote_viewed, checkout_started, payment_app_tapped, paid_clicked, utr_submitted, payment_confirmed, payment_rejected, order_ready_seen, reorder_clicked. | — |
| 14 | Sensitive document toggle | ✅ **Verified** | `sensitive-document-toggle.tsx:6`: "for Aadhaar/PAN/IDs". Toggle enables pickup-code requirement + immediate deletion. | — |
| 15 | Code splitting | ✅ **Verified** | `src/app/s/[shopSlug]/page.tsx:1`: `import dynamic from 'next/dynamic'`. Line 22: `const CustomerOrderFlowV2 = dynamic(... { ssr: false })`. Line 25: `loading: () => <CustomerFlowSkeleton />`. | — |
| 16 | CLS fix (min-width on price) | ✅ **Verified** | `sticky-action-bar.tsx:51`: `min-w-[80px]` on the price `<p>`. Comment at line 43 explains the CLS prevention. | — |
| 17 | AbortController on quotes | ✅ **Verified** | `CustomerOrderFlowV2.tsx:287`: `quoteAbortRef = useRef<AbortController>`. Line 728: aborts previous. Line 734: creates new controller. | — |

**Verdict: 17/17 claims verified.** No claims were false or partly true.

---

## 7.3 Production Performance (Lighthouse)

**Status: Config created, not run in sandbox.**

`lighthouserc.json` created with:
- Mobile preset, 4x CPU throttle, slow 4G (1.5 Mbps download, 750 Kbps upload, 150ms RTT)
- 7 URLs: shop landing, order flow (3 steps), tracking, /orders, /help, /privacy
- Budgets: performance ≥ 90, LCP ≤ 2.5s, CLS ≤ 0.1, TBT ≤ 200ms, unused JS ≤ 170KB
- Output to `docs/redesign/evidence/lighthouse/`

**Why not run:** Lighthouse CI requires a production build (`next build`) served via `next start`. This 2-core sandbox can't complete the production build (it times out). The Vercel deployment builds successfully — Lighthouse must be run against the production URL:
```bash
npx lighthouse https://printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app/s/quickprint \
  --emulated-form-factor=mobile --throttling-cpu-slowdown=4 --output=html
```

**Phase 0 baseline (dev server, not representative):**
- `/s/quickprint`: HTML 49KB, 2 JS chunks, CLS 0.000
- `/` (home): HTML 65KB, 2 JS chunks

---

## 7.4 Dead and Fake Code Sweep

| Check | Result | Evidence |
|-------|--------|----------|
| `TODO` / `FIXME` in customer code | ✅ None found | `rg "TODO\|FIXME" src/components/customer/ src/app/s/ src/app/o/ ...` → 0 results |
| `pa=TODO` placeholder | ✅ Fixed (gone) | `rg "pa=TODO" src/` → 0 results |
| `console.log` in customer code | ✅ None found | `rg "console.log\|console.debug" src/components/customer/ src/app/s/ ...` → 0 results |
| Orphaned `phase4/customer-app.tsx` | ✅ **Fixed** — deleted | File was 473 lines of dead code using synthetic PDF blob. Deleted in this phase. No imports reference it. |
| `CustomerOrderFlow.legacy.tsx` | ✅ Kept intentionally | Old flow preserved as fallback (not dead code — it's a deliberate safety net) |
| Hardcoded strings outside i18n | ✅ None found in sample | Spot check of key strings ("Place order", "Pay ₹", "Mobile number") → all in i18n catalogs |
| Analytics event name typo (`shop_landned`) | ✅ Not a typo | The only match was in a comment explaining typo detection. Actual constant: `shopLanded: 'shop_landed'` (correct) |

---

## 7.5 Secret Scan

**Tool:** gitleaks v8.21.2
**Scope:** 262 commits + working tree
**Result:** 13 findings — 12 false positives (test fixtures, examples, token alphabets), 1 potentially real.

| Finding | Verdict | Action |
|---------|---------|--------|
| `worklog.md:1437` — `nak_live_*` format | **POTENTIALLY REAL** | User must review + rotate if active. Do NOT paste the value. See `docs/redesign/evidence/secret-scan.md` |
| Other 12 findings | FALSE POSITIVE | Test fixtures (`rzp_test_key123`), example values (`a1b2c3d4...`), token alphabet, truncated JWT example |

**Git config:** No credentials in `.git/config`. No tokens in remote URLs.

---

## What Is Still Unverified

1. **Production Lighthouse** — needs a production build + served instance. Run against the Vercel deployment URL.
2. **Playwright tests** — not yet written. Phase 8 adds them.
3. **Real device testing** — not possible in this sandbox. See `docs/redesign/DEVICE-CHECKLIST.md`.
4. **500-page PDF performance** — fixture generation + throttled test in Phase 8.
5. **Hindi/Telugu visual rendering at 360px** — snapshot tests in Phase 8.
6. **axe automated checks** — `axe-core` installed + helper exists, but no Playwright tests call it yet. Phase 8.

---

## Fixes Applied in This Phase

| Fix | File | Commit |
|-----|------|--------|
| Deleted orphaned `phase4/customer-app.tsx` (473 lines dead code) | `src/components/phase4/customer-app.tsx` | This phase |
| Created `lighthouserc.json` with budgets | Root | This phase |
| Saved secret scan evidence | `docs/redesign/evidence/secret-scan.md` | This phase |
| Saved build verification evidence | `docs/redesign/evidence/build-verification.md` | This phase |
