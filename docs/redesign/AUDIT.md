# PrintShop Customer Mobile Experience — Phase 0 Audit

**Date:** 2026-11-22
**Auditor:** Principal product designer + senior front-end engineer
**Method:** Code review (every customer-facing file read end-to-end), agent-browser screenshots at 3 viewport widths, Performance API + curl page-weight capture, heuristic walkthrough against WCAG 2.2 AA + the Simplicity Law.
**Dev environment:** Next.js 16 Turbopack dev server, `DATABASE_PROVIDER=memory`, seeded with 3 demo shops (quickprint, copycenter, printrib).

---

## 1. Route + Component Inventory

### Customer-facing routes (8 active + 5 missing)

| # | URL | File | Type | What it does | Screenshots | States covered |
|---|-----|------|------|--------------|--------------|----------------|
| 1 | `/` | `src/app/page.tsx` (457 lines) | Client | Marketing + shop discovery grid. Fetches `/api/v1/shops?limit=50`. Footer links to `/shop/login`, `/shop/register`. | `360x800/home.png`, `390x844/home.png`, `412x915/home.png` | empty ✅, loading ✅ (skeleton grid), error ✅ ("couldn't load shops"), offline ❌ |
| 2 | `/s/[shopSlug]` | `src/app/s/[shopSlug]/page.tsx` (103 lines) | **Server** | QR landing. Shop name + open/closed badge + rate board + wait estimate. Renders `<CustomerOrderFlow>` if open. **NEW flow (Razorpay PR).** | `360x800/s_quickprint.png`, `390x844/s_quickprint.png`, `412x915/s_quickprint.png` | closed-shop ✅ ("not accepting orders right now" + hours), loading ❌ (no `loading.tsx`), error ❌ (falls to root), offline ❌ |
| 3 | `/s/[shopSlug]` flow | `src/app/s/[shopSlug]/CustomerOrderFlow.tsx` (599 lines) | Client | Upload → page-strip color picker → sticky price bar → details → UTR/counter payment. **The centerpiece.** | (rendered inside route 2's screenshot) | upload progress ✅, quote error ✅, pay error ✅, payment-pending ✅ (UTR length hint), offline ❌ |
| 4 | `/o/[token]` | `src/app/o/[token]/page.tsx` (186 lines) | Client | Order tracking by 128-bit token. Polls `/api/v1/o/[token]` every 5s. Pickup code + numbered timeline + payment state + per-task progress. | `390x844/o_tracking_error.png` (invalid-token error state) | loading ✅ (pulse), error ✅ ("Open the full link from your receipt"), payment-pending ✅ (3 sub-states: UTR/confirmed/rejected), offline ❌ |
| 5 | `/orders/[id]` | `src/app/orders/[id]/page.tsx` (2143 lines) | Client | **OLD flow** — full 6-step wizard (Upload/Configure/Preview/Checkout/Pay/Track). Token-gated via header/sessionStorage. | (not captured — orphaned route, no inbound links from new flow) | All states well-covered ✅ (the most complete screen set in the project) |
| 6 | `/shops/[slug]` | `src/app/shops/[slug]/page.tsx` (394 lines) | Client | **OLD flow** shop landing. Pricing table + "Start an order" CTA. | `360x800/shops_quickprint.png`, `390x844/shops_quickprint.png`, `412x915/shops_quickprint.png` | loading ✅ (ShopSkeleton), error ✅, closed-shop ❌, offline ❌ |
| 7 | `/download-app` | `src/app/download-app/page.tsx` + `download-app-client.tsx` (330 lines) | Server + Client | APK download landing. Fetches GitHub releases API. | `360x800/download-app.png`, `390x844/download-app.png`, `412x915/download-app.png` | loading ✅, error ✅ ("No APK available yet" + GitHub Actions link), offline ❌ |
| 8 | `/not-found` | `src/app/not-found.tsx` (22 lines) | Server | 404 page | `390x844/not-found.png` | — |

### Missing routes (referenced in code but don't exist)

| Route | Referenced from | Impact |
|-------|-----------------|--------|
| `/shops` (index) | `/s/[shopSlug]/page.tsx:99` footer "All shops" link | **404** — broken link on every shop landing |
| `/help` | Nowhere (brief requires it) | No help/FAQ page exists |
| `/privacy` | Nowhere (brief requires it) | No privacy/file-retention policy page |
| `/s/[shopSlug]/loading.tsx` | — | No loading sibling (falls to root spinner) |
| `/s/[shopSlug]/error.tsx` | — | No error sibling (falls to root "Something went wrong") |
| `/o/[token]/loading.tsx` | — | No loading sibling |
| `/o/[token]/not-found.tsx` | — | Invalid token shows generic error, not a dedicated "order not found" page |

### Component inventory (customer-flow-specific)

| Component | File | Lines | Role | Notes |
|-----------|------|-------|------|-------|
| `CustomerOrderFlow` | `src/app/s/[shopSlug]/CustomerOrderFlow.tsx` | 599 | Upload + page strip + options + pay | **Centerpiece of the new flow.** Has the signature page-color strip. |
| `TrackOrderPage` | `src/app/o/[token]/page.tsx:58` | 128 | Tracking + pickup code + timeline | Polls every 5s, no aria-live on status changes |
| `HomePage` + `ShopCard` | `src/app/page.tsx:102` | 355 | Shop directory + search | — |
| `ShopDetailPage` | `src/app/shops/[slug]/page.tsx:74` | 320 | OLD flow shop landing | — |
| `OrderFlowPage` | `src/app/orders/[id]/page.tsx:199` | 1944 | OLD flow 6-step wizard | The most complete but heaviest screen set |
| `PdfPreview` | `src/components/portal/pdf-preview.tsx:54` | 482 | PDF.js thumbnail grid + page selection | Used by OLD flow only; NEW flow uses server-side thumbnails |
| `PageRangeBuilder` | `src/components/portal/page-range-builder.tsx:27` | 324 | Page range text builder | Used by OLD flow only |
| `customer-app.tsx` | `src/components/phase4/customer-app.tsx` | 473 | **Orphaned** — not routed anywhere | Uses synthetic PDF blob; candidate for deletion |

### API endpoints used by customer flow (17 total)

**NEW flow (8 + 2 payment):**
- `POST /api/v1/s/[slug]/uploads/init` — creates draft order + file row + resumable upload session (50 MB limit)
- `PUT /api/v1/s/[slug]/uploads/chunk?uploadId=` — appends one 2 MB chunk (resumable)
- `POST /api/v1/s/[slug]/uploads/complete` — assembles chunks, validates magic bytes, kicks off background processing
- `GET /api/v1/s/[slug]/files/[fileId]?token=` — polls file status (uploading/converting/ready/failed), returns pageCount + colorSuggestion + signed thumbnail URLs
- `PUT /api/v1/s/[slug]/specs` — attaches print options (copies/sides/paper/range/colorPages/skipPages)
- `POST /api/v1/s/[slug]/quote` — stateless server-side price computation (debounced 400ms client-side)
- `POST /api/v1/s/[slug]/orders` — places order from draft (server recomputes price; 409 PRICES_CHANGED if mismatch)
- `GET /api/v1/o/[token]` — customer tracking (token IS the credential; 240/60s rate limit)
- `POST /api/v1/o/[token]/payment` — customer submits UTR or picks counter payment (does NOT mark paid)
- `POST /api/v1/o/[token]/cancel` — customer cancel (only before printing)

**OLD flow (7):** `/api/v1/shops/[slug]`, `/api/v1/shops/[slug]/orders`, `/api/v1/shops/[slug]/upi-qr`, `/api/v1/orders/[id]/status`, `/api/v1/orders/[id]/files/upload-url`, `/api/v1/orders/[id]/files`, `/api/v1/orders/[id]/checkout`

**Shared (2):** `/api/v1/shops?limit=50` (home directory), `/api/v1/qr?data=` (QR PNG generator)

---

## 2. Mobile Performance Baseline

> **Honest caveat:** These numbers are from the **dev server** (Turbopack dev mode + in-memory DB). Production numbers (minified + gzipped + Vercel edge CDN) will be significantly better. Full Lighthouse CI must be run on the deployed Vercel app (`printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app`) to get definitive LCP/INP/CLS. The dev numbers below are indicative of relative page weight, not absolute performance.

### Page weight (dev server, unminified, ungzipped)

| Route | HTML | JS chunks | Notes |
|-------|------|-----------|-------|
| `/` (home) | 65 KB | 2 chunks | Client-rendered; fetches `/api/v1/shops?limit=50` on mount |
| `/s/quickprint` | 49 KB | 2 chunks | Server-rendered landing (fast TTFB); `<CustomerOrderFlow>` is client-side |
| `/shops/quickprint` | 45 KB | 2 chunks | Client-rendered (old flow) |
| `/download-app` | — | 2 chunks | Client-rendered; fetches GitHub releases API |

### Production estimates (based on code analysis)

| Metric | `/s/[shopSlug]` (NEW) | `/orders/[id]` (OLD) | Target (brief) |
|--------|----------------------|----------------------|----------------|
| Client JS (gzipped, estimated) | ~30 KB (React + lucide icons, no heavy deps) | ~150 KB + lazy PDF.js (~2.5 MB on demand) | ≤ 170 KB gzip |
| LCP (estimated, production) | ~1.5–2 s (server-rendered landing) | ~2.5–3.5 s (client-rendered + data fetch) | ≤ 2.5 s |
| CLS (measured) | **0.000** (no layout shift — server-rendered, no images without dims) | Not measured (likely > 0 due to skeleton→content transitions) | ≤ 0.1 |
| INP | Not measured (needs real interaction testing) | Not measured | ≤ 200 ms |
| Font weight | ~80 KB (3 Google Font families via `next/font`, self-hosted, `display: swap`) | Same | — |
| Image weight | ~0 on load (thumbnails lazy-loaded on demand) | ~0 on load (PDF.js lazy) | — |

### Key performance findings

1. **The NEW `/s/[shopSlug]` flow is significantly lighter** than the OLD `/orders/[id]` flow because:
   - Server-rendered landing (no client JS for the shop info)
   - No PDF.js shipped to client (uses server-side rendered thumbnails via signed URLs)
   - No `useApiClient` auth context overhead (raw `fetch()`)
   - `CustomerOrderFlow.tsx` has zero heavy imports (just React + lucide icons)

2. **The OLD flow ships PDF.js (~2.5 MB)** to the client when the Configure or Preview step is reached. It's lazy-loaded (`const pdfjs = await import('pdfjs-dist')`) but still a significant download on slow 4G.

3. **Font loading is well-optimized** — `next/font/google` self-hosts 3 families (`Space_Grotesk` display, `Plus_Jakarta_Sans` body, `Geist_Mono`), all with `display: 'swap'` (no FOIT). Only Latin subset is loaded — **no Devanagari or Telugu subset** (i18n gap).

4. **Quote requests are debounced 400ms** (`CustomerOrderFlow.tsx:195`) — avoids hammering `/api/v1/s/[slug]/quote` on every page-toggle tap. Good.

5. **`/o/[token]` polls every 5s indefinitely** — no exponential backoff, no max retries, no pause on `document.hidden` (unlike the old flow's `usePoll` hook which DOES pause when tab hidden). This wastes battery on abandoned tabs.

6. **Root layout loads `/native-bridges.js` `beforeInteractive`** on EVERY page — ~3 KB of inert JS even for web-only visitors. Minor but worth noting.

7. **No `<Suspense>` boundaries** in the customer flow — `CustomerOrderFlow` is statically imported, no streaming/route-level code splitting.

### Lighthouse CI baseline (TO BE CAPTURED on production)

> ⚠️ **Not yet run.** The dev server doesn't produce representative Lighthouse numbers. Once the redesign is deployed to Vercel, run:
> ```bash
> npx lighthouse https://printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app/s/quickprint \
>   --emulated-form-factor=mobile --throttling-cpu-slowdown=4 \
>   --throttling-download-throughput-kbps=1500 --output=html --output-path=./docs/redesign/lighthouse-baseline.html
> ```
> Record: LCP, INP, CLS, total JS (gzip), image weight, font weight.
> **Baseline targets to beat:** LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

---

## 3. Heuristic Review

Severity: **P0** = blocks a core job or causes a costly mistake; **P1** = friction/confusion on the default path; **P2** = polish.

### P0 — Critical (blocks core job or causes costly mistakes)

| # | Screen | Problem | Why it hurts the customer | Fix |
|---|--------|---------|---------------------------|-----|
| P0-1 | `/s/[shopSlug]` `CustomerOrderFlow.tsx:327` | **UPI deep-link is a placeholder**: `upi://pay?pa=TODO&pn=TODO&am=0` | Customer taps "Pay via UPI" → opens their UPI app with `pa=TODO` → payment fails or goes to a wrong/invalid VPA. The customer can't pay. This is the #1 blocker. | Wire the real `shop.upiId` + `shop.name` + `order.totalAmountPaise` into the UPI URI. The checkout API already returns the correct `upiIntentUrl` for the OLD flow — reuse it. |
| P0-2 | `/` Home `page.tsx:142` | **Home page routes to OLD flow** (`/shops/${slug}`) not NEW flow (`/s/${slug}`) | Customer discovers a shop via the home page → gets the old 9-screen flow instead of the new 5-screen flow. Inconsistent experience depending on entry point. | Change `/shops/${slug}` → `/s/${slug}` in the home page ShopCard. OR decide on one flow + redirect the other. |
| P0-3 | `/s/[shopSlug]` footer `page.tsx:99` | **"All shops" link points to `/shops`** which 404s | Customer taps "All shops" at the bottom of the shop landing → 404 page. Dead end. | Point to `/` (the home page shop directory) or create a `/shops` index route. |
| P0-4 | `CustomerOrderFlow.tsx` page strip buttons `L432-447` | **Touch targets are `min-h-9` (36px)** — below WCAG 2.5.5 (44px) and the brief's 48px minimum | Customer taps the wrong page toggle on a 360px screen with a thumb. The page strip is the signature interaction — mis-taps here corrupt the order (wrong pages in color = overcharge). | Bump all page-strip action buttons to `min-h-12` (48px). The page tile buttons in the grid have NO min-height (they're `aspect-[3/4]`) — ensure they're ≥ 48px tall. |
| P0-5 | Entire customer flow | **No offline detection** — `navigator.onLine` is never checked | Customer at the shop counter with patchy 4G loses connection mid-upload → generic "network error" message → customer doesn't know if their order went through → re-uploads → double order. | Add an `OfflineBanner` component + `online`/`offline` event listeners. Show "You're offline. Your draft is saved — reconnect to continue." Queue mutations for replay on reconnect. |
| P0-6 | `/o/[token]` `page.tsx:74` | **Polls every 5s indefinitely** with no backoff + no pause when tab hidden | Customer opens tracking link → switches to another app → tracking page keeps polling every 5s for hours → drains battery + wastes server quota (240/60s rate limit → will hit 429 after 4 min of background polling). | Add `document.hidden` pause (like the old flow's `usePoll` hook). Exponential backoff after 5 min: 5s → 10s → 30s → 60s. Stop entirely after 30 min of no status change. |

### P1 — High friction / confusion on the default path

| # | Screen | Problem | Why it hurts | Fix |
|---|--------|---------|--------------|-----|
| P1-1 | `CustomerOrderFlow.tsx` entire | **No step indicator / progress** — the flow is one long scroll with no sense of "where am I" | Customer doesn't know how many steps remain. The brief requires a 3-step Stepper (Files, Options, Pay). | Add a sticky `Stepper` at the top: Files → Options → Pay (numbered because it's a sequence). |
| P1-2 | `CustomerOrderFlow.tsx` options | **All options visible at once** — copies, paper, sides, pages-per-sheet, paper type, orientation, collate, add-ons, note | Violates the Simplicity Law: "at most 5 to 7 visible choices at once." The customer faces ~10 fields on one screen. | Show 3-4 presets as large cards (Notes BW / Colour / Photo / Mix). Hide the rest behind "More options" (progressive disclosure). |
| P1-3 | `CustomerOrderFlow.tsx` labels | **Technical terms** — "Single" / "Double" (should be "One-sided" / "Double-sided"), "A4" without "paper", "Collate" | Customer doesn't know what "Collate" means. The brief says "never show a technical term." | Rename: "Single" → "One-sided", "Double" → "Double-sided", "Collate" → "Keep in order (1,2,3,1,2,3)", "A4" → "A4 paper". |
| P1-4 | `/o/[token]` `page.tsx:27-43` | **9 statuses mapped to 6 timeline steps** — `partially_printed`, `paid_on_pickup`, `expired` collapse into existing steps | Customer can't distinguish "partially printed" (some pages done) from "printing" (in progress). | Add a 7th step for "Partially printed" or show a per-set progress bar (color set vs BW set) within the "Printing" step. |
| P1-5 | `CustomerOrderFlow.tsx` inputs | **Input text size < 16px** — `text-xs` (12px) and `text-sm` (14px) on form inputs | iOS Safari auto-zooms when input text is < 16px, causing a layout shift + disorientation. The brief explicitly calls this out. | All text inputs must be `text-base` (16px) or larger. Labels can be smaller. |
| P1-6 | `/o/[token]` `page.tsx` | **No `aria-live` on status changes** — polls every 5s but screen readers don't announce updates | Blind customer using TalkBack doesn't know their order status changed from "Printing" to "Ready." | Add `aria-live="polite"` on the status span + `aria-atomic="true"`. |
| P1-7 | `CustomerOrderFlow.tsx` page strip | **No running totals** — the brief requires "12 black & white, 3 color" summary | Customer toggles 20 pages and can't see how many are BW vs color without counting manually. | Add a summary line above the strip: "12 Black & white · 3 Colour · 2 skipped" with a live price. |
| P1-8 | Entire flow | **No draft persistence** — refresh loses everything | Customer fills 10 pages of color choices → accidentally refreshes → all work lost. The brief requires IndexedDB draft recovery. | Persist the draft (files + pageModes + options) to IndexedDB on every change. Restore on mount. |
| P1-9 | `/s/[shopSlug]` + `/o/[token]` | **No `loading.tsx` / `error.tsx` siblings** — falls to generic root | A loading shop page shows a generic spinner instead of a shop-themed skeleton. An error shows "Something went wrong" instead of "Couldn't load this shop — try again." | Add route-specific `loading.tsx` (shop skeleton) + `error.tsx` (shop-themed error with retry). |
| P1-10 | `CustomerOrderFlow.tsx` | **No "Pay" button disable after tap** — the brief says "Never double-charge: the Pay button disables after tap and survives refresh" | Customer taps "Place order" → network is slow → taps again → double order created (if the idempotency key doesn't catch it). | Disable the button on tap + persist "order already placed" to sessionStorage/IndexedDB so a refresh doesn't re-enable it. |

### P2 — Polish (doesn't block but degrades quality)

| # | Screen | Problem | Fix |
|---|--------|---------|-----|
| P2-1 | `/` Home | Marketing hero + features + how-it-works is heavy for a customer who just scanned a QR code (they want the shop, not the pitch) | For `/s/[shopSlug]` visitors, skip the marketing — they're already at the shop. The home page marketing is fine for direct visitors. |
| P2-2 | `CustomerOrderFlow.tsx` | No preset cards — the brief requires 3-4 one-tap presets (Notes BW / Colour / Photo / Mix) | Build preset cards as the primary options UI, with "More options" as progressive disclosure. |
| P2-3 | `/download-app` QR code | Uses third-party `api.qrserver.com` for QR generation (external SPOF) | Generate QR server-side via the existing `/api/v1/qr` endpoint (already exists in the codebase). |
| P2-4 | `phase4/customer-app.tsx` | 473-line orphaned component, not routed anywhere, uses synthetic PDF blob | Delete it. It's dead code that confuses the codebase. |
| P2-5 | Root layout `layout.tsx:124` | `/native-bridges.js` loaded `beforeInteractive` on every page (~3 KB inert JS for web-only visitors) | Acceptable for now (3 KB is negligible). Could be conditionally loaded only on customer routes if needed. |
| P2-6 | `CustomerOrderFlow.tsx` labels | No `htmlFor`/`id` pairing on form labels (relies on wrapping) | Add explicit `htmlFor`/`id` pairing for screen reader correctness. |
| P2-7 | Font subsetting | Only Latin subset loaded — no Devanagari or Telugu | Add `subsets: ['latin', 'devanagari', 'telugu']` to the `next/font` config once i18n is implemented. |
| P2-8 | `CustomerOrderFlow.tsx` | No "double-sided saves Rs X" money nudge | Add a one-line nudge when double-sided is cheaper (only when true, per the brief). |
| P2-9 | `/o/[token]` | No "Share order link" (WhatsApp share intent) | Add a share button that triggers `navigator.share()` or a WhatsApp deep-link. |
| P2-10 | Entire flow | No safe-area inset handling (`env(safe-area-inset-*)`) for notched phones | Add `viewport-fit=cover` (already set) + `padding-bottom: env(safe-area-inset-bottom)` on sticky bars. |

---

## 4. Step + Field Count (Baseline to Beat)

### NEW flow (`/s/[shopSlug]`) — current baseline

| Step | Screen | Fields visible | Taps to advance |
|------|--------|---------------|-----------------|
| 1 | Shop landing + upload dropzone | 0 (just the dropzone) | 1 (tap to pick file) |
| 2 | Upload progress + page strip | ~10 (copies, paper, sides, pages-per-sheet, paper type, orientation, collate, add-ons, note, page modes) | N (toggle each page) + 1 (scroll down) |
| 3 | Details form | 3 (name, phone, note) | 1 (tap "Place order") |
| 4 | Pay (UTR or counter) | 1 (UTR 12 digits) or 1 (counter button) | 1 (submit) |
| 5 | Tracking (auto-redirect) | 0 | 0 |

**Total: 5 screens, ~14 fields visible (only 3 are required), ~5-6 core taps + page toggles.**
**Time estimate (returning customer, 1 PDF): ~90 seconds** (above the 60s target — the page-strip toggling + the lack of presets + the UTR entry add friction).

### OLD flow (`/shops/[slug]` → `/orders/[id]`) — for comparison

| Step | Screen | Fields |
|------|--------|--------|
| 1 | `/shops/[slug]` shop landing | 0 |
| 2 | `/orders/[id]` Upload step | 1 (file picker) |
| 3 | Configure step | ~8 per file (copies, color, paper, sides, page range, page count) |
| 4 | Preview step | N (page checkboxes) |
| 5 | Checkout step | 0 (review) |
| 6 | Pay step | 1 (Razorpay/UPI/QR) |
| 7 | Track step | 0 |

**Total: 7 screens, ~9 fields, ~12+ taps. Time: ~3-4 minutes.**

### Target after redesign (per brief)

| Metric | Current (NEW) | Target |
|--------|---------------|--------|
| Screens (returning customer, 1 PDF) | 5 | ≤ 3 |
| Time (returning customer) | ~90s | ≤ 60s |
| Time (first-time customer) | ~2-3 min | ≤ 2 min |
| Fields on default path | ~14 visible | ≤ 5 visible (presets + progressive disclosure) |
| Core taps (scan → paid) | ~6 + page toggles | ≤ 4 + page toggles |

### How to hit the target

1. **Merge upload + options into one screen** with presets (eliminates 1 screen)
2. **Presets** eliminate field choices (1 tap vs 5+ fields)
3. **Smart defaults** (BW double-sided for multi-page PDFs) eliminates the page strip for most orders
4. **Auto-submit UTR** if pasted (eliminates the "Submit" tap)
5. **Remember last choices** on the device (eliminates re-configuring for returning customers)

---

## 5. Additional Findings

### Two parallel flows exist (consolidation required)

The codebase has **two complete but disconnected customer flows**:
- **NEW:** `/s/[shopSlug]` (Razorpay PR) → `/o/[token]` — 5 screens, server-rendered landing, page strip, UTR payment
- **OLD:** `/shops/[slug]` → `/orders/[id]` — 7 screens, client-rendered, PDF.js, Razorpay Checkout.js

The home page (`/`) routes to the OLD flow. QR codes presumably route to the NEW flow. **A customer arriving via the home page gets a different experience than one arriving via QR.** This must be consolidated before any redesign work begins.

**Recommendation:** Adopt the NEW flow as the single customer experience. Migrate the OLD flow's strengths into it:
- PdfPreview component (for customers who want page-level preview)
- Razorpay Checkout.js integration (for shops with a payment provider)
- Comprehensive state banners + error handling
- `useApiClient` with 401 auto-refresh (if customer auth is ever added)
- `usePoll` with tab-hidden pause (for the tracking page)

Then redirect `/shops/[slug]` → `/s/[slug]` and `/orders/[id]?t=X` → `/o/[token]` (with token resolution).

### No i18n system

Every string is hardcoded English. No message catalogs, no language switcher, no `next-intl`/`react-intl`. The `<html lang="en">` is hardcoded. India has 22 scheduled languages; the brief requires English, Hindi, and Telugu from day one.

**Greenfield effort.** Recommend `next-intl` with routed locales (`/s/[shopSlug]/en`, `/s/[shopSlug]/hi`, `/s/[shopSlug]/te`) or cookie-based locale detection. Font subsets for Devanagari + Telugu must be added to the `next/font` config.

### Payment UX is incomplete in the NEW flow

`CustomerOrderFlow.tsx:327` has a `upi://pay?pa=TODO&pn=TODO&am=0` placeholder — the UPI deep-link doesn't use the shop's actual UPI ID or the order amount. This is a P0 blocker (see P0-1 above).

The OLD flow has a complete payment implementation (Razorpay Checkout.js + UPI deep-link + QR + manual UPI ID) at `/orders/[id]/page.tsx` PayStep — this should be ported to the new flow.

### Orphaned code

- `src/components/phase4/customer-app.tsx` (473 lines) — not routed anywhere, uses synthetic PDF blob, references dev-only `phonepe/simulate` endpoint. **Delete.**
- `src/components/portal/pdf-preview.tsx` (482 lines) — only used by the OLD flow. If the OLD flow is retired, this becomes orphaned too. **Keep if PdfPreview is migrated to the new flow; otherwise delete.**

### Accessibility summary

| Area | NEW flow (`/s/`) | OLD flow (`/orders/`) | Tracking (`/o/`) |
|------|-----------------|----------------------|------------------|
| ARIA labels on icon buttons | ✅ Good (10 aria attrs in CustomerOrderFlow) | ✅ Excellent (11 aria attrs) | ⚠️ Minimal (2 aria attrs) |
| Form label pairing | ⚠️ Wrapping only (no htmlFor/id) | ✅ Proper htmlFor/id | N/A |
| Semantic HTML | ⚠️ `<section>` only (no `<main>` in flow) | ✅ `<main>` + `<nav>` + `<header>` + `<footer>` | ✅ `<main>` + `<header>` |
| Touch targets (≥ 44px) | ⚠️ Page strip at 36px | ✅ Consistent 44px | ✅ |
| `aria-live` for status | ❌ | ✅ | ❌ Missing on polling status |
| Keyboard nav | ⚠️ Page strip buttons are tap-only | ✅ PdfPreview has Space/Enter | ⚠️ |

---

## 6. What Was Verified vs What Wasn't

### Verified (ran it, saw the result)

- ✅ Every customer-facing file read end-to-end (file paths + line numbers cited throughout)
- ✅ 14 screenshots captured at 3 viewport sizes (360×800, 390×844, 412×915) — saved in `docs/redesign/screenshots/`
- ✅ Page weights captured via curl (HTML size + JS chunk count) on a stable dev server
- ✅ CLS measured at 0.000 on `/s/quickprint` (via Performance API `layout-shift` entries)
- ✅ Touch target sizes measured by reading `className` in source (e.g. `min-h-9` = 36px)
- ✅ API endpoints verified by reading route handler source code
- ✅ State coverage verified by reading conditional rendering in source

### Not verified (honest gaps)

- ❌ **Lighthouse mobile on production** — dev server (Turbopack + in-memory DB) doesn't produce representative numbers. Must run on the deployed Vercel app to get definitive LCP/INP/CLS.
- ❌ **Real-device testing** — no physical Android/iPhone testing was done. The brief requires a low-end Android, mid Android, iPhone in Chrome, Samsung Internet, Safari.
- ❌ **INP measurement** — requires real user interaction testing (not just page load). The Performance API's INP requires at least one interaction.
- ❌ **axe automated checks** — not run (no axe-core in the project). Should be added to Playwright tests.
- ❌ **500-page PDF performance** — the page strip claims virtualization but wasn't tested with a real 500-page PDF.
- ❌ **Slow-network testing** (4x CPU slowdown + 1.5 Mbps) — not done in this audit.
- ❌ **Hindi + Telugu rendering** — no i18n exists, so multilingual testing wasn't possible.
- ❌ **Real UPI app testing** — the UPI deep-link is a placeholder (`pa=TODO`), so no real UPI app interaction was tested.

### Known limits

- The dev server uses `DATABASE_PROVIDER=memory` — API response times are faster than production (no DB round-trips).
- The screenshots were captured against the in-memory seeded data (3 demo shops). Some states (payment-pending, printing, ready) require a real order flow that wasn't fully simulated.
- The `/orders/[id]` OLD flow was not screenshotted because it's not linked from the new flow (orphaned for customers arriving via QR).

---

## Next Phase

**Phase 1: Design Plan** — write `docs/redesign/DESIGN-PLAN.md` with:
- Color system (4-6 named hex values + semantic colors, WCAG AA verified)
- Type system (Anek family for Latin/Devanagari/Telugu, modular scale)
- Layout (4/8 spacing, radius scale, elevation rules)
- The signature Page Strip as the one bold moment
- ASCII wireframes for all 6 screens (shop landing, options with presets, page picker, review+pay, payment waiting, tracking with token slip)

**Awaiting your review of this audit before proceeding.**
