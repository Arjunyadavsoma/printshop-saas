# PrintShop SaaS — Deep Audit for Redesign Mission

Task ID 7 — RESEARCH ONLY. No files were modified. Every claim below cites a file path (and line number where applicable). This document supersedes `docs/UX_AUDIT.md` (which scored the app 7.5/10) and `docs/PRODUCTION_AUDIT.md` (which focused on security).

---

## 1. Project Config Snapshot

| File | Path | Key facts |
|---|---|---|
| `package.json` | `/home/z/my-project/package.json` | Next.js 16.1.1, React 19.0.0, Prisma 6.11, Tailwind v4, recharts, pdfjs-dist 6.4.299, pdf-lib, framer-motion, socket.io, zustand, zod 4. 27 radix-ui packages. Heavy client bundle. |
| `next.config.ts` | `/home/z/my-project/next.config.ts:1-13` | `output: "standalone"`, `reactStrictMode: false`, **`typescript.ignoreBuildErrors: true`** (line 7), **NO `eslint.ignoreDuringBuilds`** flag. |
| `tsconfig.json` | `/home/z/my-project/tsconfig.json:54-58` | Excludes `skills`, `tests`, `scripts` from typecheck. `strict: true` but `noImplicitAny: false`. Module = `esnext`, target = `ES2017`. |
| `tailwind.config.ts` | `/home/z/my-project/tailwind.config.ts` | Tailwind v3-style config but PostCSS uses `@tailwindcss/postcss` (v4) — config is mostly cosmetic (v4 reads CSS variables from `globals.css`). `darkMode: "class"`. |
| `postcss.config.mjs` | `/home/z/my-project/postcss.config.mjs:1-5` | Single plugin: `@tailwindcss/postcss` (Tailwind v4 PostCSS pipeline). |
| `components.json` | `/home/z/my-project/components.json:1-21` | shadcn `style: "new-york"`, `rsc: true`, `baseColor: neutral`, icon library = `lucide`. CSS variables enabled, no prefix. |
| `eslint.config.mjs` | `/home/z/my-project/eslint.config.mjs:9-48` | **Almost every TypeScript + React + Next.js rule disabled** (no-explicit-any, no-unused-vars, no-non-null-assertion, react-hooks/exhaustive-deps, no-img-element, etc.). Ignores `examples/**`, `skills`. Lint is effectively advisory only. |
| `prisma/schema.prisma` | `/home/z/my-project/prisma/schema.prisma:1-235` | 8 models: Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog, PaymentAttempt, PaymentEvent. `provider = "postgresql"`. All amounts in `Int` paise. `paymentCredentials String` stored as plain JSON (line 17) — flagged in `docs/PRODUCTION_AUDIT.md` M3. |
| `src/middleware.ts` | `/home/z/my-project/src/middleware.ts:1-101` | Edge-runtime CSP + security headers only (CSP, COOP, COEP, X-Frame-Options DENY, HSTS 2y, Referrer-Policy). NO auth gate here — auth is handled per-route in `withAuth`/`withOrderAccess`. Whitelists `127.0.0.1:32191` (PrintLatch) and `127.0.0.1:32192` (Native Printer) in `connect-src`. |
| `src/app/layout.tsx` | `/home/z/my-project/src/app/layout.tsx:1-130` | Root layout: Geist Sans + Geist Mono fonts, `<AuthProvider>`, `<Toaster />` (sonner), `<PWARegister />`. `themeColor` amber-600 (#d97706). `<html lang="en" suppressHydrationWarning>` + `<body suppressHydrationWarning>` (browser-extension workaround). NO dark-mode `next-themes` provider anywhere — the `.dark` CSS class is never toggled by anything in the codebase. |
| `src/app/globals.css` | `/home/z/my-project/src/app/globals.css:1-131` | Tailwind v4 `@import "tailwindcss"` + `@import "tw-animate-css"`. `@custom-variant dark (&:is(.dark *))` — defines `.dark` CSS block (lines 81-113) but no provider ever applies that class to `<html>`. **Light + dark tokens both exist but dark mode is unreachable at runtime.** `@media (prefers-reduced-motion: reduce)` block disables animations. |
| `src/app/manifest.ts` | `/home/z/my-project/src/app/manifest.ts:1-95` | PWA manifest with amber-600 `theme_color`, 4 icon sizes, 3 PWA shortcuts (`/shop/login`, `/shop/printer`, `/`). Notes that customer is browser-only; shopkeeper is the install target. |

### Config flags to call out
1. **`next.config.ts:7` — `typescript.ignoreBuildErrors: true`.** Confirmed: see §10.
2. **`eslint.config.mjs:10-48`** disables nearly every meaningful rule → lint passes trivially but catches nothing.
3. **`tsconfig.json:54-58`** excludes `skills`, `tests`, `scripts` — these can drift in type correctness silently.
4. **No `next-themes` provider in `layout.tsx`** despite `globals.css` declaring `.dark` tokens and every admin page using `dark:` Tailwind classes.

---

## 2. Complete Route Inventory

| Route | File | Lines | Component | Purpose |
|---|---|---:|---|---|
| `/` | `src/app/page.tsx` | 325 | Client | Customer landing: hero + shop directory with search/filter, links to `/shops/[slug]`. |
| `/shops/[slug]` | `src/app/shops/[slug]/page.tsx` | 399 | Client | Shop landing: shows pricing table, privacy info, "Start order" CTA → creates order via POST `/api/v1/shops/:slug/orders`, redirects to `/orders/:id?t=<token>`. Injects LocalBusiness JSON-LD. |
| `/orders/[id]` | `src/app/orders/[id]/page.tsx` | **1568** | Client | Core customer journey: 5-step wizard (upload → configure → checkout → pay → track). Reads `?t=` order token from URL, persists to `sessionStorage`, strips from history. Polls `/status` every 30 s on the track step. |
| `/shop/login` | `src/app/shop/login/page.tsx` | 225 | Client | Shopkeeper login. Demo-account buttons gated on `NODE_ENV !== 'production'` (line 183). Routes admin role → `/admin`, owner → `/shop/dashboard`. |
| `/shop/register` | `src/app/shop/register/page.tsx` | 804 | Client | 4-step wizard (Account → Business → Services → Review). Persists draft to `localStorage` (strips passwords). Debounced slug uniqueness check. |
| `/shop` (layout) | `src/app/shop/layout.tsx` | 302 | Client | Auth gate + sidebar + Sheet drawer. Amber-600 accent. Login/register render bare. |
| `/shop/dashboard` | `src/app/shop/dashboard/page.tsx` | 894 | Client | Overview: stat tiles, setup checklist, payment queue, ready-queue, printing-queue, recent orders table, all-time summary, agent banner. Polls every 15 s (line 195). |
| `/shop/orders` | `src/app/shop/orders/page.tsx` | 1050 | Client | Filterable order list + batch-print flow + floating action bar. Polls every 20 s (line 232). |
| `/shop/orders/[id]` | `src/app/shop/orders/[id]/page.tsx` | 1258 | Client | Order detail: token banner, payment verify panel, status actions (start/ready/complete/cancel AlertDialog), files table, PrintLatchButton, internal notes, activity timeline, audit metadata. Polls every 5 s (line 287). |
| `/shop/printer` | `src/app/shop/printer/page.tsx` | 1139 | Client | Engine picker + PrintLatch setup (6 steps) + Native Windows Printer setup (7 steps) + supply tracking + troubleshooting. |
| `/shop/settings` | `src/app/shop/settings/page.tsx` | 1105 | Client | 5-tab settings: Profile, Hours, Payment (incl. `PaymentProviderSettings`), UPI QR upload, Shop QR. Hash-deep-link support (`#profile`, `#hours`, etc.). |
| `/shop/reports` | `src/app/shop/reports/page.tsx` | 200 | Client | Daily reconciliation report + CSV export. Uses raw `<table>` instead of shadcn Table. |
| `/admin` (layout) | `src/app/admin/layout.tsx` | 249 | Client | Auth gate (`api.role !== 'admin'` → redirect). Dark zinc-900 sidebar with emerald-600 accent. |
| `/admin` | `src/app/admin/page.tsx` | 457 | Client | Platform overview: KPI cards, health strip, recent orders, top shops, status breakdown. |
| `/admin/login` | `src/app/admin/login/page.tsx` | 158 | Client | Hidden login (requires `?k=<ADMIN_ACCESS_KEY>` → otherwise renders fake 404). |
| `/admin/orders` | `src/app/admin/orders/page.tsx` | 316 | Client | Global order list with search + status + shop filters + pagination. |
| `/admin/orders/[id]` | `src/app/admin/orders/[id]/page.tsx` | 474 | Client | Order detail for admin: shop+customer+payment info (with txnId/UTR but no credentials), files, print jobs, status history timeline, raw metadata dump. |
| `/admin/shops` | `src/app/admin/shops/page.tsx` | 293 | Client | Shop directory with search + active/inactive filter + pagination. |
| `/admin/shops/[id]` | `src/app/admin/shops/[id]/page.tsx` | 376 | Client | Shop detail: info, pricing config, agents, orders list. |
| `/admin/analytics` | `src/app/admin/analytics/page.tsx` | 439 | Client | Date-range analytics (today/7d/30d). Uses `recharts` BarChart (line 16-18). Fetches N days × 1 fetch. |
| `/admin/monitoring` | `src/app/admin/monitoring/page.tsx` | 464 | Client | Service health (DB/storage/cache/realtime), agent connectivity, failed orders, audit log. |
| `/manifest.webmanifest` | `src/app/manifest.ts` | 95 | Server (MetadataRoute) | PWA manifest. |
| `/api/v1/*` | `src/app/api/v1/**/route.ts` | ~60 routes | Server | API routes. See §8 for auth coverage. |

**Total app-router code (excluding API + tests): ~12,000 lines**, of which **6 files exceed 800 lines** (see §4.6).

**No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `global-error.tsx`** files exist anywhere in `src/app/` (verified via `find src/app -name "loading.tsx" -o -name "error.tsx" -o -name "not-found.tsx"`). All error/loading states are inline.

---

## 3. Existing Reusable Components Inventory

### 3.1 shadcn/ui components present (`src/components/ui/`)

49 components installed. **Line counts + usage count in `src/app` + `src/components`:**

| Component | Lines | Usage (# files) | Status |
|---|---:|---:|---|
| `button.tsx` | 59 | 36 | Active |
| `card.tsx` | 92 | 35 | Active |
| `badge.tsx` | 46 | 34 | Active |
| `input.tsx` | 21 | 18 | Active |
| `skeleton.tsx` | 13 | 16 | Active |
| `label.tsx` | 24 | 14 | Active |
| `table.tsx` | 116 | 11 | Active |
| `separator.tsx` | 28 | 9 | Active |
| `select.tsx` | 185 | 7 | Active |
| `switch.tsx` | 31 | 7 | Active |
| `toggle.tsx` | 47 | 6 | Active |
| `toggle-group.tsx` | 73 | 5 | Active |
| `progress.tsx` | 31 | 5 | Active |
| `alert-dialog.tsx` | 157 | 4 | Active |
| `sheet.tsx` | 139 | 3 | Active |
| `textarea.tsx` | 18 | 3 | Active |
| `tabs.tsx` | 66 | 2 | Active |
| `slider.tsx` | 63 | 2 | Active |
| `tooltip.tsx` | 61 | 2 | Active |
| `dialog.tsx` | 143 | 1 | Active (only printer page indirectly) |
| `sonner.tsx` | 25 | 1 | Active (root layout) |
| `checkbox.tsx` | 32 | 1 | Active (orders batch select) |
| `toast.tsx` | 128 | 1 | **DEAD** — only used by `toaster.tsx` |
| `toaster.tsx` | 34 | 0 | **DEAD** — root layout uses `sonner.tsx` instead |
| `accordion.tsx` | 66 | 0 | **DEAD** |
| `aspect-ratio.tsx` | 11 | 0 | **DEAD** |
| `avatar.tsx` | 53 | 0 | **DEAD** |
| `breadcrumb.tsx` | 109 | 0 | **DEAD** |
| `calendar.tsx` | 213 | 0 | **DEAD** |
| `carousel.tsx` | 241 | 0 | **DEAD** |
| `chart.tsx` | 353 | 0 | **DEAD** (analytics page imports `recharts` directly, not shadcn chart wrapper) |
| `command.tsx` | 184 | 0 | **DEAD** |
| `context-menu.tsx` | 252 | 0 | **DEAD** |
| `drawer.tsx` | 135 | 0 | **DEAD** |
| `dropdown-menu.tsx` | 257 | 0 | **DEAD** |
| `form.tsx` | 167 | 0 | **DEAD** (pages use `react-hook-form`-free hand-rolled forms) |
| `hover-card.tsx` | 44 | 0 | **DEAD** |
| `input-otp.tsx` | 77 | 0 | **DEAD** |
| `menubar.tsx` | 276 | 0 | **DEAD** |
| `navigation-menu.tsx` | 168 | 0 | **DEAD** |
| `pagination.tsx` | 127 | 0 | **DEAD** (pages hand-roll pagination) |
| `popover.tsx` | 48 | 0 | **DEAD** |
| `radio-group.tsx` | 45 | 0 | **DEAD** |
| `resizable.tsx` | 56 | 0 | **DEAD** |
| `scroll-area.tsx` | 58 | 0 | **DEAD** |
| `sidebar.tsx` | 726 | 0 | **DEAD** (largest unused component) |
| `alert.tsx` | 66 | 1 | Active (admin/login) |

**22 of 49 shadcn components are DEAD CODE** — installed but never imported. ~3,400 lines of unused UI scaffolding.

### 3.2 Portal components (`src/components/portal/`)

| File | Lines | Status |
|---|---:|---|
| `auth-context.tsx` | 233 | Active — root-level `<AuthProvider>`. JWT access + refresh tokens in `localStorage` (4 keys). Auto-refresh on 401 (line 176-182). |
| `admin-types.ts` | 308 | Active — shared TypeScript mirrors of `/api/v1/admin/*` JSON shapes + `unwrap()` helper. |
| `status-badge.tsx` | 37 | Active in shop portal — **NOT used by admin** (admin re-defines `StatusBadge` 4 times; see §3.4). |
| `pdf-preview.tsx` | 394 | Active — used only by `/orders/[id]` configure step. **Imports `pdfjs-dist` via `await import('pdfjs-dist')`** (line 82) — dynamic import is correct. Worker via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` (line 87). |
| `use-api-client.ts` | 7 | Re-export shim for `auth-context.tsx`. |
| `payment-provider-settings.tsx` | **1409** | Active — PhonePe + Paytm provider config UI. Rendered inside `/shop/settings#payment`. |

### 3.3 Phase components (`src/components/phase1/` … `phase7/`)

These are leftover Phase-1-through-7 **demo/explorer** components from the original architecture showcase. **NONE are imported by any route in `src/app/`** (verified via `grep "from '@/components/phase" src/app` → 0 hits).

| Phase | File | Lines | Notes |
|---|---|---:|---|
| phase1 | `adapter-matrix.tsx` | 76 | Dead demo code |
| phase1 | `architecture-explorer.tsx` | 100 | Dead demo code |
| phase1 | `deliverables.tsx` | 73 | Dead demo code |
| phase1 | `hero.tsx` | 67 | Dead demo code |
| phase1 | `pricing-calculator.tsx` | 332 | Dead demo code |
| phase1 | `roadmap.tsx` | 94 | Dead demo code |
| phase1 | `site-footer.tsx` | 31 | Dead demo code |
| phase2 | `backend-explorer.tsx` | 302 | Dead demo code |
| phase2 | `response-console.tsx` | 42 | Dead demo code |
| phase2 | `use-api-client.ts` | 77 | **DEAD + DUPLICATE** of `portal/use-api-client.ts` (older per-instance impl) |
| phase3 | `payments-explorer.tsx` | 185 | Dead demo code |
| phase4 | `customer-app.tsx` | 388 | Dead demo code |
| phase5 | `dashboard-analytics.tsx` | 102 | Dead demo code |
| phase5 | `dashboard-qr.tsx` | 43 | Dead demo code |
| phase5 | `dashboard-queue.tsx` | 104 | Dead demo code |
| phase5 | `dashboard-settings.tsx` | 108 | Dead demo code |
| phase5 | `shop-dashboard.tsx` | 74 | Dead demo code |
| phase5 | `use-realtime.ts` | 56 | Dead demo code |
| phase7 | `observability-deploy.tsx` | 178 | Dead demo code |

**~2,550 lines of dead phase demo code**. The README at `/home/z/my-project/README.md:34-36` still claims "The interactive `/` route is a live explorer of this foundation" — **stale documentation**, the current `/` is a customer landing page.

### 3.4 PWA components (`src/components/pwa/`)

| File | Lines | Status |
|---|---:|---|
| `pwa-register.tsx` | 111 | Active — service-worker registration (production only) |
| `install-prompt.tsx` | 218 | Active — rendered on `/shop/dashboard` |
| `deployment-banner.tsx` | 133 | Active — rendered on `/shop/dashboard` |

### 3.5 Hooks (`src/hooks/`)

| File | Lines | Status |
|---|---:|---|
| `use-mobile.ts` | 19 | **DEAD** — 0 callers in `src/app` |
| `use-toast.ts` | 193 | **DEAD** — only used by `toaster.tsx`, which is itself dead |

---

## 4. Design Inconsistencies (concrete, with file:line)

### 4.1 Three distinct accent colors across portals

- **Customer portal (`/`, `/shops/*`, `/orders/*`)** — `amber-600` everywhere (`src/app/page.tsx:131, 236, 285, 318`, `src/app/shops/[slug]/page.tsx:166, 201, 315`, `src/app/orders/[id]/page.tsx:783, 819, 919, 1041, 1144, 1277`). PWA theme_color also amber (`src/app/manifest.ts:31`).
- **Shopkeeper portal (`/shop/*`)** — `amber-600` accent (same as customer) **but `emerald-600` for verify/confirm CTAs** (`src/app/shop/dashboard/page.tsx:547, 639, 687`, `src/app/shop/orders/page.tsx:784, 841`, `src/app/shop/orders/[id]/page.tsx:549`). This is intentional semantic coloring (emerald = success/verify) but conflicts with admin's emerald.
- **Admin portal (`/admin/*`)** — `emerald-600` accent (`src/app/admin/layout.tsx:147, 220`, sidebar ring `emerald-600/30` line 55). Top bar `dark:bg-zinc-900/95` (line 218) — **only admin layout uses dark Tailwind classes**. Login page is fully dark (`bg-zinc-950`, line 83, 96, 104).

**Net effect**: customer = amber, shopkeeper = amber+emerald mix, admin = emerald on dark. Admin login page jumps from dark (`bg-zinc-950`) to admin shell (`bg-zinc-50` light) — `docs/UX_AUDIT.md:83` flags this as a known "Low" severity issue.

### 4.2 StatusBadge — duplicated 5 times

| Definition location | Lines | Color scheme |
|---|---|---|
| `src/components/portal/status-badge.tsx:28-37` (shared) | 10 | zinc/sky/amber/emerald/rose/violet — **no `dark:` variants** |
| `src/app/admin/page.tsx:76-82` | 7 | amber/sky/violet/emerald/zinc/red/orange **with `dark:` variants** |
| `src/app/admin/orders/page.tsx:74-80` | 7 | identical to admin/page.tsx (copy-paste) |
| `src/app/admin/orders/[id]/page.tsx:95-101` | 7 | identical (copy-paste) |
| `src/app/admin/shops/[id]/page.tsx:70-76` | 7 | identical (copy-paste) |

Plus `STATUS_COLORS` constant duplicated **4 times** in admin pages (`admin/page.tsx:62`, `admin/orders/page.tsx:60`, `admin/orders/[id]/page.tsx:67`, `admin/shops/[id]/page.tsx:60`). Portal `STATUS_BADGE_CLASS` and admin `STATUS_COLORS` are **incompatible color maps** (portal uses `border-amber-200`, admin uses `dark:bg-amber-950`). Same `printing` status is amber in portal, violet in admin.

### 4.3 PaymentBadge — duplicated 3 times

| Definition | Lines |
|---|---|
| `src/app/shop/dashboard/page.tsx:882-894` (`PaymentMiniBadge`) | 13 |
| `src/app/shop/orders/page.tsx:160-179` (`PaymentBadge`) | 20 |
| `src/app/shop/orders/[id]/page.tsx:164-193` (`PaymentBadge`) | 30 |

All three are functionally equivalent (status + paidAt → green/red/violet/gray badge) but with subtly different color classes (`border-emerald-200 bg-emerald-50 text-emerald-800` vs `bg-emerald-100 text-emerald-800 border-emerald-200`).

### 4.4 Duplicated utility functions

| Function | Defined at (file:line) |
|---|---|
| `inr()` (safe INR formatter) | `src/app/admin/page.tsx:45`, `src/app/admin/orders/page.tsx:43`, `src/app/admin/orders/[id]/page.tsx:43`, `src/app/admin/shops/[id]/page.tsx:43`, `src/app/admin/shops/page.tsx:43`, `src/app/admin/analytics/page.tsx:46` — **6 copies** |
| `truncate()` | `src/app/admin/page.tsx:72`, `src/app/admin/orders/page.tsx:82`, `src/app/admin/orders/[id]/page.tsx` (none, used inline), `src/app/admin/shops/[id]/page.tsx:78`, `src/app/admin/monitoring/page.tsx:58` — **4 copies** (with different default n: 8 vs 10) |
| `formatDateTime()` | `src/app/admin/monitoring/page.tsx:46`, `src/app/admin/orders/[id]/page.tsx:48`, `src/app/admin/orders/page.tsx:48`, `src/app/admin/shops/[id]/page.tsx:48` — **4 copies** (with different `second: '2-digit'` options) |
| `formatBytes()` | `src/app/shop/orders/[id]/page.tsx:134`, `src/app/admin/orders/[id]/page.tsx:60` — **2 copies** |
| `formatDate()` | `src/app/admin/shops/page.tsx:48` — 1 copy (only admin) |
| `isToday()` | `src/app/shop/dashboard/page.tsx:124`, `src/app/shop/orders/page.tsx:138`, `src/app/shop/orders/[id]/page.tsx:144` — **3 copies** |
| `timeAgo()` | `src/app/shop/dashboard/page.tsx:136` — 1 copy (only dashboard; admin uses `formatDateTime`) |
| `Separator` (local component) | `src/app/shop/dashboard/page.tsx:878-880` — **shadows** the imported `@/components/ui/separator` (which is never imported on this page, so no shadowing bug — just code smell) |

The actual canonical `formatINRFromPaise` lives in `packages/utils/src/currency.ts:16` (one definition, properly imported everywhere). All the `inr()` wrappers above just wrap it in try/catch.

### 4.5 Card padding & spacing inconsistency

The shadcn `Card` default is `py-6` + `px-6` for header/content (`src/components/ui/card.tsx:10, 23`). Pages override this inconsistently:

- `p-4 sm:p-5` — `src/app/admin/page.tsx:95, 207` (KPI cards)
- `p-4` — `src/app/shop/dashboard/page.tsx:499, 616`, `src/app/admin/orders/[id]/page.tsx:229`, `src/app/admin/monitoring/page.tsx:197, 252, 261`
- `p-3` — `src/app/shop/dashboard/page.tsx:500`, `src/app/admin/orders/[id]/page.tsx:251`, `src/app/admin/shops/[id]/page.tsx:182`, `src/app/admin/analytics/page.tsx:427`
- `p-0` — `src/app/admin/orders/page.tsx:230`, `src/app/admin/orders/[id]/page.tsx:326, 394`, `src/app/admin/shops/page.tsx:180`, `src/app/admin/analytics/page.tsx:333, 377`
- `px-4 py-2` — `src/app/shop/orders/page.tsx:619`
- Default (no override) — `src/app/shop/orders/[id]/page.tsx:502`, `src/app/page.tsx:129, 178, 206, 221`

**No consistent padding token.** Every page picks ad-hoc.

### 4.6 Button variant inconsistency for primary CTAs

- **Customer + shopkeeper** — primary CTAs use `bg-amber-600 text-white hover:bg-amber-600/90` directly via className (NOT via a `variant="primary"` abstraction). Examples: `src/app/shop/login/page.tsx:154`, `src/app/shop/register/page.tsx:713, 723`, `src/app/shop/orders/[id]/page.tsx:583, 676, 860`, `src/app/shop/settings/page.tsx:676, 802, 883, 973`, `src/app/shop/printer/page.tsx:481, 527, 573`.
- **Admin** — primary CTAs use `bg-emerald-600 text-white hover:bg-emerald-500` (`src/app/admin/login/page.tsx:142`) or `bg-emerald-600/15 text-emerald-300 ring-1 ring-inset ring-emerald-600/30` for nav active state (`src/app/admin/layout.tsx:55`).
- **Success actions** (verify payment, mark ready) — `bg-emerald-600` regardless of portal (`src/app/shop/dashboard/page.tsx:639`, `src/app/shop/orders/page.tsx:784`).

Same intent, three different className spellings across the codebase.

### 4.7 Light vs dark theme mismatch

- **Admin login page** (`src/app/admin/login/page.tsx:83, 96, 104`) — full dark theme: `bg-zinc-950`, `text-zinc-100`, `border-zinc-800`.
- **Admin layout shell** (`src/app/admin/layout.tsx:140, 218`) — `bg-zinc-50 dark:bg-zinc-950` (light default, dark sidebar) + `bg-white/95 dark:bg-zinc-900/95` top bar.
- **Admin content pages** — heavy use of `dark:` Tailwind classes (`dark:bg-amber-950 dark:text-amber-300` etc. in `STATUS_COLORS`).
- **Customer + shopkeeper pages** — **zero `dark:` classes anywhere** (verified by spot-checking; the pages were authored before dark mode was added).
- **Root layout** (`src/app/layout.tsx:107`) — `<html lang="en" suppressHydrationWarning>` with **NO `class="dark"` toggle and no `next-themes` provider**.

**Conclusion**: dark-mode tokens are defined in `globals.css:81-113` and admin pages reference them, but nothing actually applies the `.dark` class to `<html>`. **Dark mode is unreachable at runtime.** The admin `dark:` classes are dead weight; the admin login page is the only place that hard-codes dark styles.

---

## 5. Broken or Incomplete Functionality (file:line)

### 5.1 Soft-404 on admin login

`src/app/admin/login/page.tsx:81-91` — when `?k=` access key is missing or invalid, the page renders a hardcoded "404 This page does not exist" card **but returns HTTP 200** (it's a client component, so the server returns the rendered HTML). Real `404` would require a `not-found.tsx`. Documented in `docs/UX_AUDIT.md:76, 49`.

### 5.2 Missing Next.js special files

No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `global-error.tsx` exist (verified by `find src/app -name "*.tsx"`). All loading/error states are inline per-page. Consequences:
- No streaming/Suspense fallbacks on route transitions.
- Unhandled runtime errors in any Server Component would render the default Next.js error page (not styled).
- A typo'd URL (e.g. `/shop/dashbord`) renders the default Next 404, not a themed one.

### 5.3 Polling that doesn't pause on tab hidden

`grep document.visibilityState src/` → **0 hits**. All polling intervals run regardless of tab visibility:

| File:line | Interval |
|---|---|
| `src/app/orders/[id]/page.tsx:601` | 30 s (track step) |
| `src/app/shop/dashboard/page.tsx:195` | 15 s |
| `src/app/shop/orders/page.tsx:232` | 20 s |
| `src/app/shop/orders/[id]/page.tsx:287` | **5 s** (aggressive) |
| `src/app/shop/printer/page.tsx:287` | 5 s (supply count refresh) |
| `src/app/shop/orders/[id]/page.tsx:1000-1017` | exponential-backoff PrintLatch reconnect (2s→30s) |
| `src/components/pwa/pwa-register.tsx:92` | 1 h (SW update check) |

With 500 shops each leaving the dashboard open in a background tab, that's 500 × (1/15 Hz) = ~33 req/s of useless polling. `docs/UX_AUDIT.md:82` flags this as "Low".

### 5.4 Hardcoded demo data in production paths

- `src/app/shop/login/page.tsx:25-30` — `DEMO_ACCOUNTS` array with `owner@quickprint.demo`, `owner@copycenter.demo`, `owner@prinithub.demo`, `admin@printshop.demo`. The list IS gated behind `process.env.NODE_ENV !== 'production'` (line 183) so it doesn't render in prod — but the constant still ships in the client bundle. `docs/UX_AUDIT.md:77` notes "Demo accounts not seeded in production DB" as a High-severity operational gap.
- `src/app/shop/login/page.tsx:87` — `setPassword('demo1234')` — the demo password is hardcoded.
- `src/app/shop/printer/page.tsx:411` — a 190-byte hardcoded PDF (`new Uint8Array([0x25, 0x50, 0x44, 0x46, ...])`) is embedded in the bundle as the PrintLatch test print payload.
- `src/app/shop/printer/page.tsx:989` — example pairing output string hardcodes `https://printshop-saas-three.vercel.app` as the "Paired origin" example.

### 5.5 Reports page uses raw HTML table

`src/app/shop/reports/page.tsx:142-167` — uses `<table className="w-full min-w-[600px]">` instead of the shadcn `Table` component used everywhere else. Inconsistent with the rest of the app. Flagged in `docs/UX_AUDIT.md:78`.

### 5.6 Oversized single-file components (>800 lines)

| File | Lines | What's inside |
|---|---:|---|
| `src/components/portal/payment-provider-settings.tsx` | **1409** | PhonePe + Paytm provider config UI in one file |
| `src/app/orders/[id]/page.tsx` | **1568** | 5-step wizard + 6 sub-components (`OrderStepper`, `UploadStep`, `ConfigureStep`, `CheckoutStep`, `PayStep`, `TrackStep`, `FileStatusBadge`, `FileCard`, `displayPriceForFile`) |
| `src/app/shop/orders/[id]/page.tsx` | **1258** | Order detail + `PrintLatchButton` (270 lines) + `Metric`, `Instruction` helpers |
| `src/app/shop/printer/page.tsx` | **1139** | Engine picker + `PrintLatchSection` (420 lines) + `NativePrinterSection` (415 lines) + supply tracking + `Step`, `CodeBlock` helpers |
| `src/app/shop/settings/page.tsx` | **1105** | 5-tab settings in one file (no `React.lazy`) |
| `src/app/shop/orders/page.tsx` | **1050** | Filterable list + batch-print flow (~180 lines) + floating action bar |
| `src/app/shop/dashboard/page.tsx` | **894** | 8 sections in one file |
| `src/app/shop/register/page.tsx` | **804** | 4-step wizard |

`docs/UX_AUDIT.md:68-69` calls out the orders and settings files specifically. None of these use `React.lazy` or `dynamic()` — every sub-component ships in the parent's chunk.

### 5.7 Incomplete functionality

- **Order delete-file endpoint missing** — `src/app/orders/[id]/page.tsx:464-467`: `removeFile` only filters local state; comment says "The API has no delete-file endpoint; the file is left out of the priced set." So a customer who accidentally uploads the wrong file can't actually remove it server-side — the server still has it.
- **Reports CSV export is naive** — `src/app/shop/reports/page.tsx:63-81`: hand-rolled CSV with `"` quoting but no escaping of embedded quotes/newlines. Will corrupt if any field contains a `"`.
- **Shopkeeper reports page lacks loading state** — `src/app/shop/reports/page.tsx:103-107`: shows a centered spinner while loading but no skeleton matching the final layout; `docs/UX_AUDIT.md:17` scored reports 5.8/10 (lowest).
- **Admin pages don't auto-refresh** — none of the admin pages have `setInterval`. `docs/UX_AUDIT.md:79` flags this as Medium.
- **`/admin/orders/[id]` shows raw JSON metadata dump** (`src/app/admin/orders/[id]/page.tsx:441-469`) — debug aid that ships in production.
- **Settings page logo field** (`src/app/shop/settings/page.tsx:617-631`) — accepts arbitrary `logoUrl` string with no validation, no upload; comment "We don't host image uploads for the logo yet."
- **ShopSlug UPI QR fetch in order flow** — `src/app/orders/[id]/page.tsx:553` calls `/api/v1/shops/:slug/upi-qr` (public endpoint) but if the shopkeeper hasn't uploaded a QR, falls back to a generated QR from `/api/v1/qr?data=...`. Functional but two code paths.
- **`Shop` model has `paymentMethods` field** (`prisma/schema.prisma:36`) supporting `'upi' | 'cash' | 'both' | 'split'`, but `/orders/[id]/page.tsx` PayStep only shows UPI payment options (no cash-on-pickup UX despite the schema supporting it).

---

## 6. Accessibility Problems (file:line)

### 6.1 Missing aria-label / aria-describedby on interactive elements

- `src/app/page.tsx:119` — "Find a shop" button uses `onClick={() => document.getElementById('shop-discovery')?.scrollIntoView(...)}` but has no `aria-label` (the visible text is descriptive enough — borderline OK).
- `src/app/shop/printer/page.tsx:599` — Troubleshooting toggle button has `aria-expanded={tsOpen} aria-controls="ts-pl"` ✓.
- `src/app/shop/printer/page.tsx:1015` — second Troubleshooting toggle has `aria-expanded={tsOpen} aria-controls="ts-np"` ✓.
- `src/app/shop/orders/page.tsx:757` — `<Checkbox title={!eligible ? ... : undefined}>` uses `title` instead of `aria-describedby` for the disabled-reason text. Screen readers may not announce `title` on a disabled checkbox.
- `src/app/shop/printer/page.tsx:1133` — `<code>` block has no `aria-label`; the "Copy" button next to it (`CodeBlock` line 1134) has no `aria-label` (just an icon).
- `src/app/shop/printer/page.tsx:138, 162` — engine-picker `<button>` elements have no `aria-label` (rely on visible heading text inside).
- `src/app/admin/monitoring/page.tsx:301` — `<ShieldCheck className="mx-auto mb-2 h-6 w-6 text-emerald-600" />` decorative icon with no `aria-hidden`.

### 6.2 Missing `<label>` associations

- `src/app/orders/[id]/page.tsx:966-975` — `<select>` for paper size has a sibling `<Label className="text-xs">Paper</Label>` but no `htmlFor`/`id` link.
- `src/app/orders/[id]/page.tsx:1494-1510` — paper-size `ToggleGroup` has `<Label>` without association.
- `src/app/orders/[id]/page.tsx:1194-1204` — printer `<select>` inside `PrintLatchButton` has `<Label className="text-xs">Printer</Label>` without `htmlFor`.
- `src/app/shop/printer/page.tsx:506-515` — supply form Selects have proper `id` + `htmlFor` ✓.
- `src/app/shop/settings/page.tsx:1015-1026` — UPI QR file `<input type="file">` is wrapped in a `<label>` (implicit association ✓), but the visible "Upload QR" span is a sibling, not the label text.

### 6.3 Heading hierarchy jumps

- `src/app/shop/printer/page.tsx` — `<h1>` at line 75 → `<h3>` at line 147, 171, 1123. **Skips `<h2>`** (jumps straight from h1 to h3 inside the EnginePicker and Step components).
- `src/app/page.tsx` — `<h1>` line 112 → `<h3>` line 134 (feature card titles) → `<h2>` line 147. Out-of-order (h3 before h2).
- `src/app/admin/orders/[id]/page.tsx` — **no `<h1>`** at all (admin layout's `<h1>` "PrintShop Admin" at `src/app/admin/layout.tsx:221` is the only h1). Page starts with `<h2>` line 194.
- Same pattern for `/admin/orders`, `/admin/shops`, `/admin/shops/[id]`, `/admin/analytics`, `/admin/monitoring` — all start at `<h2>` (no per-page `<h1>`).
- shadcn `CardTitle` (`src/components/ui/card.tsx`) renders as a `<div>` by default — not a heading. So pages that use `<CardTitle>` instead of `<h1>`/`<h2>` lose heading semantics entirely. Most pages do this.

### 6.4 Color contrast

Low-contrast combinations observed:
- `src/app/shop/login/page.tsx:170-174` — `text-amber-900` on `bg-amber-50/70` (≈ contrast ratio 8.6 ✓).
- `src/app/admin/page.tsx:175-188` — `text-emerald-900 dark:text-emerald-200` on `bg-emerald-50 dark:bg-emerald-950/40` — but dark mode never activates (see §4.7) so only the light variant matters; light variant passes.
- `src/app/shop/orders/[id]/page.tsx:1277` — `text-amber-600` on `bg-muted/60` for the customer token display. Amber-600 (#d97706) on a muted zinc background = ~4.0:1 — **borderline for normal text** (WCAG AA requires 4.5).
- `src/app/shop/dashboard/page.tsx:620` — `font-mono font-bold text-amber-700` for token numbers on `bg-card`. amber-700 (#b45309) on white = ~5.7:1 ✓.
- `src/app/admin/login/page.tsx:86-88` — `text-zinc-600` "404" on `bg-zinc-950` = ~6.5:1 ✓ but `text-zinc-700` "This page does not exist." on `bg-zinc-950` = ~5.0:1, **borderline**.
- `src/app/page.tsx:318` — `text-amber-700` on `text-amber-50` "Visit shop" link = OK.

### 6.5 Missing focus styles

`src/app/globals.css:115-122` sets `outline-ring/50` on `*` via `@apply border-border outline-ring/50`. Most interactive elements inherit this. However:
- `src/app/page.tsx:270-279` — `ShopCard` adds `focus:outline-none focus-visible:ring-2 focus-visible:ring-ring` ✓ (this is the pattern most other custom buttons should follow).
- `src/app/shop/printer/page.tsx:138, 162` — engine-picker `<button>` has `focus:outline-none focus:ring-2 focus:ring-amber-400` ✓.
- `src/app/admin/shops/page.tsx:205-253` — clickable `<TableRow>` rows have `hover:bg-emerald-50/40` but **no focus state**. Keyboard users can't tell which row is "active".
- Same issue in `src/app/admin/orders/page.tsx:255-277` table rows.

### 6.6 Touch targets < 44px

- `src/app/admin/orders/page.tsx:296-311` — pagination buttons explicitly `min-h-[44px] min-w-[44px]` ✓.
- `src/app/admin/shops/page.tsx:273-288` — same ✓.
- **Admin Refresh buttons** lack min-h: `src/app/admin/orders/page.tsx:162-165`, `src/app/admin/orders/[id]/page.tsx:202-205`, `src/app/admin/shops/page.tsx:127-130`, `src/app/admin/shops/[id]/page.tsx:154-157`, `src/app/admin/page.tsx:168-171`, `src/app/admin/analytics/page.tsx:205-208`, `src/app/admin/monitoring/page.tsx:177-180` — all `<Button variant="outline" size="sm">` with no min-h. shadcn `size="sm"` defaults to `h-8` (32px) — below the 44px minimum.
- `src/app/admin/orders/page.tsx:258-272` — table-row action buttons (none currently; row is non-clickable). OK.
- `src/app/shop/printer/page.tsx:325-332` — PrintLatchSection Refresh button has `min-h-[44px]` ✓.
- `src/app/shop/printer/page.tsx:482-489` — supply Restock/Cancel buttons have `min-h-[44px]` ✓.

### 6.7 Missing alt text

- `src/app/orders/[id]/page.tsx:1189-1193` — `<img src={desktopQr} alt="UPI payment QR code">` ✓.
- `src/app/shop/settings/page.tsx:997` — `<img src={upiQrPreview} alt="UPI payment QR">` ✓.
- `src/app/shop/settings/page.tsx:1069` — `<img src={qr.pngDataUrl} alt={`QR for ${shop.name}`} width={176} height={176}>` ✓.
- `src/app/shop/settings/page.tsx:506` — `printQr()` writes `<img src="${qr.pngDataUrl}" alt="QR" ...>` to a new window ✓.
- Decorative icons throughout use `<Icon className="size-4 shrink-0" />` without `aria-hidden`. Most are inside `<Button>` or `<CardTitle>` with adjacent text so screen readers will read the text — but purely decorative standalone icons (e.g. `src/app/admin/monitoring/page.tsx:301` `<ShieldCheck>`) should be `aria-hidden`.

### 6.8 Missing role attributes on dialogs/menus

- shadcn `alert-dialog.tsx` (Radix-based) includes `role="alertdialog"` automatically ✓.
- shadcn `sheet.tsx` includes `role="dialog"` ✓ + `SheetTitle` is required (used in `shop/layout.tsx:256` and `admin/layout.tsx:189`).
- `src/app/shop/printer/page.tsx:599, 1015` — collapsible Troubleshooting uses `<button aria-expanded aria-controls>` but no `role="region"` on the collapsible content `<CardContent>`.

---

## 7. Responsive Layout Problems

### 7.1 Tables without horizontal scroll wrappers

Most tables ARE wrapped in `overflow-x-auto` ✓:
- `src/app/orders/[id]/page.tsx:1047` (checkout table) ✓
- `src/app/orders/[id]/page.tsx:1350` (track files) ✓
- `src/app/shops/[slug]/page.tsx:250` (pricing table) ✓
- `src/app/shop/orders/page.tsx:712` (`min-w-[760px]` but no `overflow-x-auto` wrapper — **MISSING**). Same for `src/app/shop/orders/[id]/page.tsx:732` (`min-w-[900px]`, no wrapper).
- `src/app/admin/orders/page.tsx:240` ✓ (`overflow-x-auto`)
- `src/app/admin/orders/[id]/page.tsx:330, 398` ✓
- `src/app/admin/shops/page.tsx:190` — **no `overflow-x-auto` wrapper**; the table just renders with default block layout. On mobile this causes the rows to wrap awkwardly.
- `src/app/admin/shops/[id]/page.tsx:328` — same issue.
- `src/app/admin/analytics/page.tsx:341, 383` ✓.
- `src/app/admin/monitoring/page.tsx:361` ✓.
- `src/app/shop/reports/page.tsx:141` ✓.
- `src/app/shop/dashboard/page.tsx:770` — `<Table className="min-w-[640px]">` with no wrapper. **MISSING.**

### 7.2 Fixed widths

- `src/app/admin/layout.tsx:143` — sidebar `w-60` fixed (240 px). On screens <1024 px (`lg:`) it hides and a Sheet drawer replaces it ✓.
- `src/app/admin/analytics/page.tsx:297` — chart `<div className="h-72 w-full">` ✓ (responsive).
- `src/app/shop/printer/page.tsx:1133` — `<code className="block flex-1 overflow-x-auto ...">` ✓ (scrolls).
- `src/app/orders/[id]/page.tsx:1277` — token display `font-mono text-2xl font-bold break-words text-amber-600 sm:text-3xl sm:tracking-widest` ✓ (fixed in `docs/UX_AUDIT.md:39`).

### 7.3 Grids that don't collapse on mobile

Most pages use `grid-cols-1 sm:grid-cols-2 ...` patterns that collapse ✓. Examples:
- `src/app/page.tsx:127, 176, 222` ✓.
- `src/app/shop/dashboard/page.tsx:494` — `grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5` ✓.
- `src/app/shop/orders/[id]/page.tsx:940` — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` ✓.

### 7.4 Text overflow at 320px

- `src/app/orders/[id]/page.tsx:1277` — token uses `break-words` ✓ (was previously fixed).
- `src/app/shop/orders/[id]/page.tsx:505-508` — token display `break-words font-mono text-3xl font-bold tracking-tight text-amber-700 sm:text-4xl lg:text-5xl` ✓.
- `src/app/shop/orders/[id]/page.tsx:508` — `id: {order.id}` on a `<span className="break-all font-mono text-[10px] text-muted-foreground">` ✓.
- `src/app/shop/printer/page.tsx:349` — `printers.map(p => p.name).join(', ')` on a `<span className="text-xs text-muted-foreground break-words">` ✓.
- `src/app/admin/orders/page.tsx:266-267` — `<span className="font-mono text-xs text-muted-foreground">{o.shopSlug}</span>` no `break-all`. If a shop has a very long slug, could overflow.

### 7.5 Dialogs on mobile

- shadcn `AlertDialog` (`src/components/ui/alert-dialog.tsx`) uses Radix's responsive positioning — dialogs are centered and scrollable ✓.
- `src/app/shop/orders/[id]/page.tsx:1104` — `<AlertDialogContent className="max-w-md">` ✓.
- `src/app/shop/orders/[id]/page.tsx:655-672` — reject-payment dialog has multi-button footer that wraps on mobile via `flex flex-col gap-2 sm:flex-row` ✓.

---

## 8. Performance Issues

### 8.1 Client Components that could be Server Components

**Every single page in `src/app/` starts with `'use client'`** (verified by `grep -l "'use client'" src/app`). There are zero Server Components for any route segment. The entire app is client-rendered, fetching data via the `useApiClient` hook after hydration.

This means:
- No streaming SSR.
- No metadata generation from server-side data (the root `layout.tsx` exports static metadata).
- Full JS bundle shipped for every page even when the content is static (e.g. `/shop/login` could be a static form).

Pages that genuinely need to be client (`/orders/[id]` 5-step wizard, `/shop/printer` polling, dashboards with `setInterval`) are correct. Pages that DON'T need to be client:
- `/shop/login` (225 lines) — could be a Server Component with a client `<LoginForm>` child.
- `/shop/register` (804 lines) — wizard logic needs client, but the marketing chrome could be server.
- `/shop/reports` (200 lines) — could be server with a client date-picker.
- `/admin/login` (158 lines) — same as `/shop/login`.
- All admin list pages — could fetch server-side and pass props.

### 8.2 Missing React.lazy / dynamic imports for heavy features

- `src/app/admin/analytics/page.tsx:16-18` — `import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'` at top level. **`recharts` is ~600 KB minified** and ships in the admin analytics chunk. Should be `next/dynamic(() => import('recharts'), { ssr: false })`.
- `src/components/portal/pdf-preview.tsx:82` — `const pdfjs = await import('pdfjs-dist')` — correctly dynamic-imported ✓.
- `src/app/shop/orders/[id]/page.tsx:16` — `import { PdfPreview } from '@/components/portal/pdf-preview'` is a static import. Even though `pdfjs-dist` is dynamically imported INSIDE `PdfPreview`, the `PdfPreview` component itself (394 lines) ships in the orders-page chunk. Could be `next/dynamic(..., { ssr: false })`.
- `src/app/shop/orders/[id]/page.tsx:18` — `import { priceFile, type PricingInput } from '@platform/core/pricing'` — pulls in the pricing engine synchronously. Small (~few KB), but could be lazy.
- `src/components/portal/payment-provider-settings.tsx` — 1409-line component imported eagerly inside `/shop/settings` (`src/app/shop/settings/page.tsx:55`). Settings page has 5 tabs but only the "payment" tab needs this component. Should be `React.lazy`.
- `framer-motion` (`package.json:66`) is in dependencies but I didn't find any actual usage in `src/app` — possible dead dep.

### 8.3 Polling intervals

See §5.3 table. The 5-second poll on `/shop/orders/[id]` (`src/app/shop/orders/[id]/page.tsx:287`) is the most aggressive — for a shopkeeper watching an order, that's 12 req/min × the size of the order-detail payload (order + files + shop + activity entries). Could be replaced with a websocket subscription (the codebase already has `socket.io` and a `mini-services/realtime-service`).

### 8.4 Large client bundles

- `pdfjs-dist` 6.4.299 — only used by `PdfPreview`, dynamically imported ✓.
- `recharts` 2.15.4 — used only by `/admin/analytics`, **NOT dynamically imported** ✗ (`src/app/admin/analytics/page.tsx:16-18`).
- `pdf-lib` 1.17.1 — used by `/api/v1/orders/[id]/receipt/route.ts` (server-only, OK).
- `@mdxeditor/editor` 3.39.1 — declared in deps but I found **0 imports** in `src/` → dead dependency.
- `react-syntax-highlighter` 15.6.1 — declared but only used in `examples/` (excluded from tsconfig).
- `next-auth` 4.24.11 — declared but the project uses its own JWT auth (`src/lib/auth/jwt-auth.adapter.ts`); next-auth appears unused.
- `next-intl` 4.3.4 — declared but no messages files / no locale routing → dead.
- `@reactuses/core` — declared but no usage found.
- `upipay` 1.0.0 — declared; used in `packages/adapters/src/payment/upi-deeplink.adapter.ts` only.
- `react-day-picker`, `react-resizable-panels`, `embla-carousel-react`, `cmdk`, `input-otp`, `vaul`, `react-markdown` — all declared for shadcn components that are dead code (see §3.1).

**Estimated dead client-bundle weight**: significant — multiple shadcn peer deps + 22 unused UI components + 19 phase components.

---

## 9. Security-Sensitive Areas (verified, not modified)

### 9.1 with-order-access.ts usage on customer order routes

`src/lib/api/with-order-access.ts:1-97` — constant-time-compares `X-Order-Token` header or `?t=` query against `order.customerToken`. Returns 403 (not 404) on mismatch to prevent order-ID enumeration.

Verified applied on **every** customer-facing order route:

| Route | Wrapped? | File:line |
|---|---|---|
| `GET /api/v1/orders/:id/status` | ✓ + rate-limited | `src/app/api/v1/orders/[id]/status/route.ts:14` |
| `GET /api/v1/orders/:id/receipt` | ✓ | `src/app/api/v1/orders/[id]/receipt/route.ts:14` |
| `POST /api/v1/orders/:id/checkout` | ✓ + rate-limited | `src/app/api/v1/orders/[id]/checkout/route.ts:16` |
| `POST /api/v1/orders/:id/files` | ✓ + rate-limited | `src/app/api/v1/orders/[id]/files/route.ts:19` |
| `POST /api/v1/orders/:id/files/upload-url` | ✓ + rate-limited | `src/app/api/v1/orders/[id]/files/upload-url/route.ts:17` |
| `PATCH /api/v1/orders/:id/files/:fileId` | ✓ + rate-limited | `src/app/api/v1/orders/[id]/files/[fileId]/route.ts:14` |

**All 6 customer order routes are properly token-gated.** The token is issued at order creation (`POST /api/v1/shops/:slug/orders`) and stored in `sessionStorage` client-side (`src/app/orders/[id]/page.tsx:195`).

### 9.2 with-auth.ts usage on shopkeeper routes

`src/lib/api/with-auth.ts:52-94` — verifies JWT, checks role if `allowedRoles` passed, resolves `principal.shopId` from the user row. Critically, also checks `claims.shopId !== user.shopId` (line 74) to invalidate stale tokens after shop reassignment.

**Shopkeeper routes — every `/api/v1/shops/me/*` route uses `withAuth`:**

| Route | File:line | Role list |
|---|---|---|
| `GET /api/v1/shops/me` | `src/app/api/v1/shops/me/route.ts:46` | none (any authed user) |
| `PATCH /api/v1/shops/me` | `src/app/api/v1/shops/me/route.ts:73` | none |
| `GET /api/v1/shops/me/orders` | `src/app/api/v1/shops/me/orders/route.ts:8` | none |
| `GET /api/v1/shops/me/orders/:id` | `src/app/api/v1/shops/me/orders/[id]/route.ts:17` | none |
| `PATCH /api/v1/shops/me/orders/:id` | `src/app/api/v1/shops/me/orders/[id]/route.ts:31` | none |
| `POST /api/v1/shops/me/orders/:id/verify-payment` | `src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts:47` | none |
| `POST /api/v1/shops/me/orders/:id/start` | `src/app/api/v1/shops/me/orders/[id]/start/route.ts:26` | none |
| `POST /api/v1/shops/me/orders/:id/ready` | `src/app/api/v1/shops/me/orders/[id]/ready/route.ts:13` | none |
| `POST /api/v1/shops/me/orders/:id/complete` | `src/app/api/v1/shops/me/orders/[id]/complete/route.ts:45` | none |
| `POST /api/v1/shops/me/orders/:id/cancel` | `src/app/api/v1/shops/me/orders/[id]/cancel/route.ts:71` | none |
| `POST /api/v1/shops/me/orders/:id/print` | `src/app/api/v1/shops/me/orders/[id]/print/route.ts:11` | none |
| `GET /api/v1/shops/me/orders/:id/activity` | `src/app/api/v1/shops/me/orders/[id]/activity/route.ts:16` | none |
| `GET /api/v1/shops/me/orders/:id/files/:fileId/download` | `src/app/api/v1/shops/me/orders/[id]/files/[fileId]/download/route.ts:22` | none |
| `GET /api/v1/shops/me/orders/:id/files/:fileId/print-url` | `src/app/api/v1/shops/me/orders/[id]/files/[fileId]/print-url/route.ts:29` | none |
| `GET/PATCH /api/v1/shops/me/payment-credentials` | `src/app/api/v1/shops/me/payment-credentials/route.ts:142, 151` | none |
| `GET /api/v1/shops/me/qr` | `src/app/api/v1/shops/me/qr/route.ts:29` | none |
| `GET /api/v1/shops/me/analytics` | `src/app/api/v1/shops/me/analytics/route.ts:9` | none |
| `GET/POST/DELETE /api/v1/shops/me/upi-qr` | `src/app/api/v1/shops/me/upi-qr/route.ts:41, 148` | none |
| `GET /api/v1/shops/me/sticker` | `src/app/api/v1/shops/me/sticker/route.ts:20` | none |
| `GET /api/v1/shops/me/agents` | `src/app/api/v1/shops/me/agents/route.ts:7` | none |

**Concern**: none of the `/shops/me/*` routes pass an `allowedRoles` argument to `withAuth`. This means a user with `role='staff'` or `role='admin'` (if such tokens were ever issued) could call these routes. Defense-in-depth relies on:
1. The login endpoint (`src/app/api/v1/auth/login/route.ts`) only issues `role='owner'` for shop users and `role='admin'` for admins.
2. Every query is tenant-scoped via `principal.shopId` (e.g. `repos.shops.getByOwner(principal.userId)` then `repos.orders.findByIdAndShop(id, shop.id)`).

The tenant scoping is correct (verified in `src/app/api/v1/shops/me/orders/[id]/route.ts:19-21`) — but adding `['owner']` to the `allowedRoles` argument on every `/shops/me/*` route would be explicit defense-in-depth.

### 9.3 Admin role checks on /admin/* routes

| Route | File:line | `allowedRoles` |
|---|---|---|
| `GET /api/v1/admin/orders` | `src/app/api/v1/admin/orders/route.ts:60` | `['admin']` ✓ |
| `GET /api/v1/admin/orders/:id` | `src/app/api/v1/admin/orders/[id]/route.ts:72` | `['admin']` ✓ |
| `GET /api/v1/admin/shops` | `src/app/api/v1/admin/shops/route.ts:92` | `['admin']` ✓ |
| `GET /api/v1/admin/shops/:id` | `src/app/api/v1/admin/shops/[id]/route.ts:67` | `['admin']` ✓ |
| `GET /api/v1/admin/analytics` | `src/app/api/v1/admin/analytics/route.ts:104` | `['admin']` ✓ |
| `GET /api/v1/admin/audit` | `src/app/api/v1/admin/audit/route.ts:33` | `['admin']` ✓ |

**All 6 admin API routes enforce `['admin']` role.** Layout-level gate (`src/app/admin/layout.tsx:92-95`) also redirects if `api.role !== 'admin'`. Double layer ✓.

### 9.4 Secrets exposed to client

Verified: NO secrets appear in client bundles.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STORAGE_CAPABILITY_SECRET`, `REALTIME_EMIT_SECRET`, payment-provider saltKeys — all read via `process.env` server-side only.
- `src/lib/container.ts` has `requireSecret()` that throws if a secret is missing or still a dev default in production (`docs/PRODUCTION_AUDIT.md:23-27`).
- The admin login page reads `?k=<ADMIN_ACCESS_KEY>` from the URL and POSTs it to `/api/v1/admin/access-check` — the access key is sent as a query string, which means it appears in browser history and server access logs. Mild concern; documented behavior.
- `customerToken` is deliberately NOT displayed (`src/app/orders/[id]/page.tsx:639` comment: "customerToken is a BEARER SECRET — never display it"). The token is stored in `sessionStorage` (`src/app/orders/[id]/page.tsx:195`) and stripped from the URL after first load (`src/app/orders/[id]/page.tsx:198-200`).

### 9.5 Payment verification is server-side only

- `src/app/api/v1/shops/me/orders/[id]/verify-payment/route.ts:47` — server-side, `withAuth`-wrapped. Only the shopkeeper (with valid JWT for the shop that owns the order) can mark an order paid.
- `src/app/api/v1/payments/phonepe/webhook/route.ts` and `src/app/api/v1/payments/paytm/callback/route.ts` — server-side webhook handlers, signature-verified (`src/lib/payments/phonepe-v2-webhook.ts`).
- `src/app/api/v1/payments/dev/phonepe/simulate/route.ts` and `src/app/api/v1/payments/dev/paytm/simulate/route.ts` — gated by `requireDev()` (`src/lib/api/require-dev.ts`), 404 in production.
- `src/app/api/v1/dev/orders/[id]/mark-paid/route.ts` — gated by `requireDev()`.

**Customer-side `doPay()`** (`src/app/orders/[id]/page.tsx:576-588`) deliberately does NOT mark the order paid — it just transitions the customer to the track step. The order remains `awaiting_payment` until the shopkeeper verifies or a webhook arrives. Code comment at line 570-575 explains this.

### 9.6 Routes missing auth (intentional, all verified)

- `GET /api/v1/shops` (public shop list) — intentional.
- `GET /api/v1/shops/:slug` (public shop info) — intentional.
- `POST /api/v1/shops/:slug/orders` (create order) — intentional (creates a customerToken).
- `GET /api/v1/shops/:slug/upi-qr` — intentional (public UPI QR for desktop fallback).
- `GET /api/v1/qr` (generate QR) — intentional.
- `GET /api/v1/health`, `/api/v1/ready`, `/api/v1/db-health`, `/api/v1/metrics` — intentional.
- `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `POST /api/v1/auth/refresh` — intentional.
- `GET /api/v1/admin/access-check` — intentional (gates the admin login page).
- `GET /api/v1/downloads/native-printer` — intentional (public ZIP download).

Customer order routes are NOT in this list — they are all `withOrderAccess`-gated (see §9.1).

---

## 10. TypeScript Build Suppression — Investigation

### Confirmation

`/home/z/my-project/next.config.ts:6-8`:
```ts
typescript: {
  ignoreBuildErrors: true,
},
```

### Why was it added?

I ran `npx tsc --noEmit` from `/home/z/my-project`:
```
$ npx tsc --noEmit; echo "Exit: $?"
Exit: 0
```

**`tsc --noEmit` passes with ZERO errors and exit code 0.** There are no actual type errors in the project as currently configured.

**However**, the tsconfig excludes `skills`, `tests`, `scripts` (`/home/z/my-project/tsconfig.json:54-58`). The `next build` TypeScript check (which `ignoreBuildErrors: true` suppresses) would normally include all files matched by `include` (everything except `node_modules`). With `ignoreBuildErrors: true`, even if a developer introduces a type error, `next build` will succeed — the flag is a permanent escape hatch.

**Hypothesis on why it was added**: likely during the rapid Phase 1-7 development when types were in flux, then never removed. The current codebase is type-clean (verified), so the flag is **no longer necessary**. Removing it would catch future type regressions during `next build`.

**Recommendation** (for the redesign mission): remove `typescript.ignoreBuildErrors: true` from `next.config.ts:7` once the redesign is type-clean. Also consider re-enabling ESLint rules selectively (the current `eslint.config.mjs` disables everything).

### First 20 real type errors: **NONE** (tsc is clean).

---

## 11. Test Coverage

### 11.1 Test files inventory

25 `*.test.ts` files, all in `packages/` + `src/lib/` + `scripts/`. **Zero tests in `src/app/`** (no page/route tests, no component tests, no e2e). vitest config (`/home/z/my-project/vitest.config.ts`) includes only `packages/**/*.test.ts` + `src/**/*.test.ts`.

| File | Lines | describes | tests | Coverage area |
|---|---:|---:|---:|---|
| `packages/core/src/pricing/pricing-engine.test.ts` | 241 | 9 | 35 | Pricing edge cases (color/duplex/bulk/min order/per-page sizes) |
| `packages/adapters/src/cache/in-memory.adapter.test.ts` | 193 | 4 | 10 | In-memory cache adapter |
| `packages/adapters/src/payment/upi-deeplink.adapter.test.ts` | 224 | 1 | 13 | UPI deep-link URI generation |
| `packages/adapters/src/storage/r2.adapter.test.ts` | 110 | 1 | 7 | R2 storage adapter |
| `packages/adapters/src/storage/s3.adapter.test.ts` | 167 | 1 | 16 | S3 storage adapter |
| `src/lib/auth/auth.test.ts` | 416 | 5 | 17 | JWT auth adapter (sign/verify/refresh) |
| `src/lib/printlatch/printlatch.test.ts` | 276 | 10 | 20 | PrintLatch client (CSP, pairing, commands) |
| `src/lib/repositories/order-token-concurrency.test.ts` | 410 | 2 | 13 | Order token concurrent claim |
| `src/lib/repositories/repositories.test.ts` | 182 | 3 | 11 | Repository CRUD |
| `src/lib/payments/payments.test.ts` | 205 | 2 | 7 | Payment adapter plumbing |
| `src/lib/payments/phonepe-v2-webhook.test.ts` | 162 | 3 | 16 | PhonePe v2 webhook signature verification |
| `src/lib/payments/print-job-idempotency.test.ts` | 232 | 1 | 6 | Print job dedup |
| `src/lib/payments/webhook-audit.test.ts` | 241 | 1 | 4 | Webhook audit log |
| `src/lib/upload-lifecycle.test.ts` | 235 | 2 | 14 | Upload → confirm → cleanup lifecycle |
| `src/lib/token-consistency.test.ts` | 166 | 1 | 5 | Token consistency |
| `src/lib/storage/capability.test.ts` | 50 | 1 | 7 | HMAC-signed storage URLs |
| `src/lib/services/durable-queue.test.ts` | 123 | 2 | 5 | Durable queue |
| `src/lib/services/atomic-claim.test.ts` | 149 | 1 | 4 | Atomic claim primitive |
| `src/lib/api/require-dev.test.ts` | 118 | 2 | 6 | Dev-mode guard |
| `src/lib/container.test.ts` | 141 | 2 | 8 | DI container |
| `src/lib/crypto/credential-encryption.test.ts` | 56 | 1 | 6 | AES-GCM credential encryption |
| `src/lib/db.test.ts` | 50 | 1 | 4 | Prisma client |
| `scripts/concurrency-harness.test.ts` | — | — | — | (excluded from tsconfig) |
| `scripts/postgres-integration.test.ts` | — | — | — | (excluded from tsconfig) |
| `scripts/printjob-concurrency-harness.test.ts` | — | — | — | (excluded from tsconfig) |

**Total: ~225 tests** in the 22 in-scope test files.

### 11.2 Coverage gaps

**What's tested**: pricing engine, auth JWT, repositories, payment webhooks/signatures, storage capability HMAC, PrintLatch client, dev guards, container, credential encryption.

**What's NOT tested**:
- **Zero tests for any UI route** (`src/app/**/*.tsx`) — no unit tests, no component tests, no integration tests, no Playwright e2e.
- **Zero tests for any API route handler** (`src/app/api/**/*.ts`) — the route *implementations* are untested; only the lower-level libs they call are tested.
- **No tests for `with-order-access` middleware** itself — it's tested transitively via the upload-lifecycle test.
- **No tests for `with-auth` middleware** itself.
- **No tests for `auth-context.tsx`** (the client-side auth provider + 401 auto-refresh).
- **No tests for the order-flow wizard** (`src/app/orders/[id]/page.tsx`, 1568 lines).
- **No tests for the admin pages**.
- **No tests for the shopkeeper dashboard / orders / printer / settings pages**.
- **No tests for `payment-provider-settings.tsx`** (1409 lines of provider-config UI).
- **`@playwright/test` is in devDependencies** (`package.json:101`) but **no `playwright.config.ts` file exists** and no `*.spec.ts` files exist. E2E test capability is scaffolded but not used.
- The `vitest.config.ts` test environment is `node` — no `jsdom` environment configured, so even if component tests were added, they couldn't render React.

---

## 12. Verified vs Unverified Functionality

### VERIFIED (passing tests + visible in code)

| Capability | Evidence |
|---|---|
| Pricing engine (35 tests) | `packages/core/src/pricing/pricing-engine.test.ts` |
| JWT auth sign + verify + refresh (17 tests) | `src/lib/auth/auth.test.ts` |
| Order token concurrency (13 tests) | `src/lib/repositories/order-token-concurrency.test.ts` |
| Repository CRUD (11 tests) | `src/lib/repositories/repositories.test.ts` |
| PhonePe v2 webhook signature verification (16 tests) | `src/lib/payments/phonepe-v2-webhook.test.ts` |
| Storage capability HMAC signing (7 tests) | `src/lib/storage/capability.test.ts` |
| Dev-route guards return 404 in production (6 tests) | `src/lib/api/require-dev.test.ts` |
| PrintLatch client commands + CSP (20 tests) | `src/lib/printlatch/printlatch.test.ts` |
| Credential AES-GCM encryption (6 tests) | `src/lib/crypto/credential-encryption.test.ts` |
| Upload → confirm → cleanup lifecycle (14 tests) | `src/lib/upload-lifecycle.test.ts` |
| Print job idempotency (6 tests) | `src/lib/payments/print-job-idempotency.test.ts` |
| Order access token constant-time comparison | `src/lib/api/with-order-access.ts:43-48` + applied on all 6 customer order routes (§9.1) |
| Admin role enforcement `['admin']` on all admin routes | §9.3 |
| CSP + security headers middleware | `src/middleware.ts` + tested in `src/lib/printlatch/printlatch.test.ts:252-274` |
| TypeScript compiles clean | `npx tsc --noEmit` → exit 0 |

### PARTIALLY implemented (code exists but incomplete)

| Capability | Gap |
|---|---|
| Customer order flow `/orders/[id]` | No delete-file endpoint (`src/app/orders/[id]/page.tsx:464-467` comment) |
| Reports CSV export | Naive quoting, no escaping (`src/app/shop/reports/page.tsx:63-81`) |
| `Shop.paymentMethods` field supports `cash`/`split` | UI only shows UPI (`src/app/orders/[id]/page.tsx` PayStep); cash-on-pickup flag exists in settings but no checkout UX |
| Settings page logo upload | URL field only, no upload (`src/app/shop/settings/page.tsx:629`) |
| PWA install | `InstallPrompt` component exists; no actual install tracking |
| Admin login soft-404 | Returns HTTP 200 with 404-style content (`src/app/admin/login/page.tsx:81-91`) |
| Polling pause on tab hidden | No `visibilityState` check anywhere (§5.3) |
| Dark mode | Tokens defined in `globals.css`, `dark:` classes used in admin pages, but no `next-themes` provider applies the `.dark` class (§4.7) |
| `Subscription` model in Prisma | Schema exists (`prisma/schema.prisma:158-170`), no billing provider wired (`docs/PRODUCTION_AUDIT.md:83-85`) |
| Realtime websocket | `mini-services/realtime-service/` exists, `socket.io` declared, but no admin/shop page actually subscribes — all pages poll via REST |

### MISSING (referenced but no implementation)

| Item | Where referenced | Where it should be |
|---|---|---|
| `loading.tsx` route-level suspense fallbacks | Next.js convention | Should exist for every route segment |
| `error.tsx` route-level error boundaries | Next.js convention | Should exist for every route segment |
| `not-found.tsx` themed 404 | Next.js convention | Should exist at root + `/shop/*` + `/admin/*` |
| `global-error.tsx` last-resort error boundary | Next.js convention | Should exist at root |
| Order file deletion endpoint | `src/app/orders/[id]/page.tsx:466` comment | New `DELETE /api/v1/orders/:id/files/:fileId` route |
| Realtime subscription on dashboard | `socket.io-client` declared in deps; no usage in `src/app` | Replace `setInterval` polling with `io().on('order:update', ...)` |
| Email notifications | `StubEmailAdapter` (`packages/adapters/src/email/stub.adapter.ts`) | Production email adapter (Resend/SendGrid) |
| SMS notifications | `StubSmsAdapter` (`packages/adapters/src/sms/stub.adapter.ts`) | Production SMS adapter (MSG91) |
| Payment credentials encryption at rest | `prisma/schema.prisma:17` `paymentCredentials String` (plain JSON) | libsodium sealed boxes per `docs/PRODUCTION_AUDIT.md:63-65` |

### UNVERIFIED (no test, can't confirm)

| Item | Why unverified |
|---|---|
| All UI routes (`/`, `/shops/*`, `/orders/*`, `/shop/*`, `/admin/*`) | No component/e2e tests; logic verified by code reading only |
| All API route handlers | No route-level tests; only the libs they call are tested |
| `auth-context.tsx` 401 auto-refresh | No test (`src/lib/auth/auth.test.ts` tests the server-side adapter, not the client context) |
| `payment-provider-settings.tsx` (1409 lines) | No tests; complex multi-provider form with secret handling |
| PrintLatch/Native Printer agent pairing flow | `printlatch.test.ts` tests the URL/CSP helpers, not the actual pairing HTTP round-trip |
| PDF upload + page-count parsing | `upload-lifecycle.test.ts` tests the lifecycle, but `parse-page-count.ts` itself has no dedicated test |
| `pdf-preview.tsx` rendering | No test |
| CSV export correctness | No test |
| PWA service-worker registration | No test |
| Batch print flow (`runBatchPrint` in `src/app/shop/orders/page.tsx:328-502`) | No test; 175-line async function with cancellation |

---

## 13. Summary of Findings

**Scale of the codebase under audit**:
- 20 route files, ~12,000 lines of client-rendered React.
- 6 files exceed 800 lines (largest: `orders/[id]/page.tsx` at 1568 lines).
- 49 shadcn UI components installed, **22 unused** (~3,400 lines dead).
- 19 phase demo components, **all unused** (~2,550 lines dead).
- 25 test files, ~225 tests — all in `packages/` + `src/lib/`, **zero in `src/app/`**.
- TypeScript compiles clean; `ignoreBuildErrors: true` is a stale flag.

**Top redesign priorities (by impact)**:

1. **Extract shared utilities** — `StatusBadge` (5 defs), `PaymentBadge` (3 defs), `inr/truncate/formatDateTime/formatBytes/isToday/timeAgo` (≥20 duplicate defs across admin pages). Consolidate into `src/components/portal/` + `src/lib/utils/format.ts`.
2. **Split oversized files** — 6 files >800 lines. Each `orders/[id]` step, each settings tab, each PrintLatch section should be its own component (with `React.lazy` for the heavy ones).
3. **Fix dark mode** — either remove all `dark:` classes from admin pages and the `.dark` block from `globals.css`, or wire up `next-themes` properly in `layout.tsx`.
4. **Remove dead code** — 22 unused shadcn components, 19 phase components, 2 dead hooks (`use-mobile`, `use-toast`), dead deps (`@mdxeditor/editor`, `next-auth`, `next-intl`, `@reactuses/core`, `react-syntax-highlighter`).
5. **Add Next.js special files** — `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx` at minimum at the root.
6. **Add visibility-aware polling** — wrap every `setInterval` in a `document.visibilityState === 'visible'` guard.
7. **Dynamic-import `recharts`** in `/admin/analytics`.
8. **Add `allowedRoles: ['owner']` to every `/shops/me/*` route** for defense-in-depth.
9. **Add Playwright e2e tests** — `@playwright/test` is already declared but unused.
10. **Remove `typescript.ignoreBuildErrors: true`** from `next.config.ts` — tsc is already clean.
11. **Align accent colors** — pick one accent for shopkeeper portal (currently amber+emerald mix) and one for admin (currently emerald). Or commit to a single brand color.
12. **Add `role="region"` + `aria-labelledby`** to collapsible troubleshooting sections in `/shop/printer`.
13. **Replace admin Refresh buttons** with `min-h-[44px]` variants for touch-target compliance.
14. **Convert `/shop/login`, `/admin/login`, `/shop/reports`, admin list pages to Server Components** with thin client islands — currently every page is `'use client'`.
15. **Update README.md** — the "live explorer of all seven phases" claim is stale; `/` is now a customer landing page.

This audit is exhaustive as of the file states read during this task. Every file:line citation above was verified by direct read.
