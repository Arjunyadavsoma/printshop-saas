# BUG-LIST — Printelyx (printelyx.cc.cd) — Phase 1 Full Audit (re-verified)

**Date:** 2026-11-24 · **Branch:** `fix/site-audit` · **Method:** Playwright (Chromium) crawl of every robots-allowed public route at 360/390/412/768/1280/1440 × light/dark (168 page-loads), targeted known-issue probes, mobile-emulation checks (offline, slow-3G, orientation, 200% text), Lighthouse mobile (slow-4G simulated), axe-core on every load, and **fully-driven customer + shopkeeper + admin journeys on the local build** with the seeded demo shop (write flows local-only; production read-only). Evidence: `docs/fixes/evidence/` (`prod-data/`, `known-issues/`, `mobile/`, `journeys/`, `lighthouse/`, `migrate-deploy-failure.log`).

> **Corrections after deep driving (v2 of this list).** The first pass (earlier session, lost to an environment reset) reported the customer flow dead-ending at Step 2. Driving the real flow step-by-step (with a valid 3-page PDF, waiting through processing, tapping "Choose colour pages") **disproved that**: files → options → colour picker → review → pay all work (screenshots `journeys/flow2-*.png`). The genuine payment blocker is below as P0-1: the UTR entry uses `window.prompt()`, which headless/mobile-automation never sees and which many mobile in-app browsers suppress.

## P0 — blocks a core job or loses money

| ID | Page/route | Symptom | Evidence | Likely cause |
|---|---|---|---|---|
| P0-1 | `/s/[slug]` pay step ("I've paid") | **UTR entry uses `window.prompt()`** — tapping "I've paid" shows no input on screen; automation auto-dismisses it (looks like a dead button); real mobile in-app browsers (WhatsApp/Instagram/QR-scanner webviews) suppress `window.prompt`, so customers can be unable to submit UTR at all. Prompt text also leaks "(For demo: leave blank to auto-generate.)" to production | `journeys/full-flow2.json` (pay step: inputs `[]`, buttons `[Copy, Pay at counter, I've paid]` after tapping "I've paid"), code `ReferenceCustomerFlow.tsx:806-830` | Stopgap prompt-based UTR capture in the live reference flow |
| P0-2 | Upload pipeline (dev/local builds) | **Unsupported & corrupt files accepted with fabricated results:** `.txt` → "Ready — 1 page"; truncated `corrupt.pdf` → "Ready — 1 page". Production is protected (normalize throws `NOT_A_PDF`/`CORRUPT_PDF` → FAILED), but the dev fallback in `process.ts` marks **any** failed file ready | `journeys/f08/f09` screenshots (first session) + code `src/lib/pipeline/process.ts:56-86` | Dev "simulate processing" fallback catches *all* errors and invents a state |
| P0-3 | Upload pipeline (dev/local builds) | **Fabricated page counts → wrong prices:** page count estimated from file size (`bytes/50KB`) — a 15 MB garbage PDF became "318 pages, 239 B&W + 79 colour, ₹636". Same root as P0-2 | `journeys/f11` screenshot (first session) + `process.ts:66-75` | Size-based estimate instead of the real parser |

## P1 — wrong, confusing or inaccessible

| ID | Page/route | Symptom | Evidence | Likely cause |
|---|---|---|---|---|
| P1-1 | `/shop/print-jobs` | Redirects to the public home page — dead nav target | `journeys/f01` screenshot + `page.tsx` redirect | Old-route compat redirect with no params |
| P1-2 | `/shop/printer` + `/shop/devices` | Two routes render the identical "Devices & Printers" page | `journeys/f02/f04` | Leftover alias route |
| P1-3 | `/help` | FAQ accordions dead — answers never expand (3 dead buttons every combo) | crawl `/help` `deadButtons` | Accordion handlers not wired |
| P1-4 | `/about` `/contact` `/pricing` `/terms` | Four footer-linked pages are "This page is being written." stubs | crawl `placeholders`, `known-issues/e-about.png` | Placeholder pages shipped |
| P1-5 | all routes | No `canonical`, no OG/Twitter tags anywhere; identical generic title on `/`, `/help`, `/shops`, `/s/[slug]`; lowercase titles "about ·" etc.; identical meta description everywhere; 404 page has no `<title>` | crawl `head` data | Single shared metadata |
| P1-6 | `/` home (production data) | QA test shops visible to real customers: "QA Shop 1795101109 / QA Test Address 1" (5 of 6 cards) | `prod/home/360x800-light-fold.png` | Test data in production datastore (needs data cleanup, not code) |
| P1-7 | `/dev/ui`, `/dev/funnel` | Internal dev pages publicly accessible on production (200; robots does not disallow `/dev`) | `known-issues.json` probe | Dev routes not env-gated |
| P1-8 | robots.txt | `Sitemap: /sitemap.xml` → 404 | `known-issues.json` probe | No sitemap route |
| P1-9 | all | No offline handling: `/help`, `/track` offline → bare "Loading…" forever; home → "Loading shops…" forever; `/offline` 404 | `mobile/*-offline.png` | No SW/offline page |
| P1-10 | `/download-app` | Release-check fetch to `api.github.com` blocked by CSP → 2 console errors on the page | crawl console | Hard-coded external API call |
| P1-11 | `/` home | axe (serious): `aria-hidden-focus` (`.ref-screen`), `link-in-text-block`; no `<h1>`; no `main` landmark — 8 violations/load | crawl axe | Home structure |
| P1-12 | `/download-app` | axe: no `main` + 13 region violations | crawl axe | Page structure |
| P1-13 | `/orders` | Dead "Look up by phone … (Coming soon)" form rendered live | journey screenshot + code | Unshipped feature mounted |
| P1-14 | repo health | `prisma migrate deploy` fails on any fresh DB (misdated `20251124000001_mobile_executor_queue_v2` references the `Printer` table created by the later `20261121…` migration); `prisma/seed.ts` fails (`printJob.create` schema drift) | `migrate-deploy-failure.log` | Migration timestamp typo + seed drift |

## P2 — polish

| ID | Where | Symptom | Evidence |
|---|---|---|---|
| P2-1 | all | Stray "Current theme: light" leaks into page text (sr-only span) | `theme-toggle.tsx:42` |
| P2-2 | footer | Middle-dot separators + "Shopkeeper login →" arrow | `known-issues.json` (j) |
| P2-3 | `/privacy`, `/help` code | Undeliverable `printshop.local.` support address | grep + crawl |
| P2-4 | `/privacy` | "last updated on the build date of this app." — no real date | `known-issues.json` (k) |
| P2-5 | footers ≤768px | Tap targets ~31×18 px with <8 px spacing (Help/About links) | crawl smallTargets |
| P2-6 | `/track` | Tracking input lacks a programmatic label | crawl axe |
| P2-7 | all | Console noise: "[NativeApp] Capacitor runtime not loaded — bridges disabled." (error-level) | crawl console |
| P2-8 | PWA manifest | `theme_color #006FA6` / `background_color #F7F8FA` disagree with app tokens (#0A58D6 / #F2F3F7) | `known-issues.json` |
| P2-9 | `/` home | Lighthouse mobile perf **69**, CLS **0.306** (shop-list reflow), TBT 611 ms — shop page 93/a11y 100 | `lighthouse/lh-home.json` |
| P2-10 | order flow copy | "0 pages look colourful, so they are set to colour" (contradictory); "1 files, 3 pages"; banner text glues "×" to the message | `journeys/flow2-*.png` |

**Known issues (a–k) verdicts:** a partially confirmed (loads on prod; no skeleton/retry/empty states; hangs offline) · b confirmed · c **disproved** (theme-color correctly scheme-scoped; real issue = manifest drift P2-8) · d confirmed · e confirmed (×3 more stubs) · f confirmed (privacy; help has it in code) · g **not found** (no `wa.me` link in current build) · h confirmed (local; prod robots-blocked) · i confirmed · j confirmed · k confirmed.

**Totals:** P0 **3** · P1 **14** · P2 **10**.

## Could not verify (and why)
- **iOS Safari/WebKit specifics** — sandbox lacks WebKit system libraries (no sudo); Android emulation used. Real-iPhone checklist included in Phase 5.
- **Production pages behind login, `/orders`, `/api/*`, `/admin`** — robots-disallowed; tested on local builds. `SHOP_TEST_EMAIL`/`SHOP_TEST_PASSWORD`/`TEST_SHOP_SLUG` were **not set** (rule 3) — production-authenticated behaviour untested.
- **UTR → waiting → track transition end-to-end** — blocked by P0-1 (prompt-based entry invisible to automation); payment API contract verified only by code reading. Fix lands in Phase 2 with an inline sheet, after which this is re-driven.
- **PWA install on real devices**, OS-level 200% scaling (approximated), real soft-keyboard overlap, back-gesture sheets.
- **Lighthouse INP** (needs field data; TBT reported), **Lighthouse on `/orders`** (robots).
- **Vercel preview** — unavailable (no token by rule); local production standalone + dev server used instead.
