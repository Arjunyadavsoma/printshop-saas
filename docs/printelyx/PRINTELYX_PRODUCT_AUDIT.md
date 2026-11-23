# Printelyx Product Audit

**Date:** 2026-11-23
**Branch:** printelyx-phase-0
**Status:** Phase 0 baseline

---

## Repository Scale

| Metric | Count |
|--------|-------|
| Page routes | 35 |
| API route handlers | 122 |
| Component files | 155 |
| Test files | 73 |
| Prisma models | 26 |
| Migrations | 11 |

## Core Product Status

| Feature | Status | Notes |
|---------|--------|-------|
| Customer shop landing (/s/[shopSlug]) | Working | QR landing + order flow, 3-step wizard, page picker, price bar |
| Customer tracking (/o/[token]) | Working | Token-based tracking, timeline, pickup code, polling + realtime |
| Customer order flow | Working | Upload → options → review → pay. Draft persistence (IndexedDB) |
| UPI payment | Working | UTR manual submission + counter payment. Never shows paid before shop confirms |
| Shopkeeper dashboard | Working | Orders, payments, printers, reports, settings |
| Admin panel | Working | Shops, orders, analytics, monitoring |
| PrintEXE device contract | Working | Pair, heartbeat, dispatch, status, revoke. 122 API endpoints |
| Mobile executor API | Working | Queue, claim/lease, reorder, priority, hold, reroute (backend complete) |
| PWA | Working | Manifest + service worker + install prompt |
| Android companion APK | Working | Capacitor app + GitHub Actions CI build |

## Critical Issues Found

| ID | Severity | Route | Issue |
|----|----------|-------|-------|
| P0-1 | HIGH | /dev/ui, /dev/funnel | Dev-only routes exposed in production (no auth gate) |
| P0-2 | HIGH | /shops/[slug] | Old customer flow still exists alongside new /s/[shopSlug] |
| P0-3 | HIGH | /orders/[id] | Old order wizard still exists (2000+ line file) |
| P0-4 | MEDIUM | /shop/print-jobs | Duplicates /shop/orders functionality |
| P0-5 | MEDIUM | Brand | All branding says "PrintShop" — needs rename to "Printelyx" |
| P0-6 | MEDIUM | Missing routes | /about, /contact, /pricing, /how-it-works, /terms, /refund-policy, /track don't exist |
| P0-7 | LOW | /shops (index) | Footer link points to /shops which doesn't exist as index |
| P0-8 | LOW | Old components | 29 CMYK component files in src/components/customer/ still exist (unused but present) |

## Architecture Summary

- Next.js 16 App Router + TypeScript strict + Tailwind CSS 4 + shadcn/ui
- Prisma + PostgreSQL (Supabase)
- 122 API endpoints under /api/v1 with Zod validation
- Device auth (PrintEXE companion) + JWT auth (shopkeeper/admin) + order-token auth (customers)
- Socket.io relay for realtime dashboard updates
- PWA manifest + service worker
- CI: GitHub Actions (lint, typecheck, unit tests, Android APK build)

## Test Coverage Status

- 73 test files (Vitest + Playwright configs exist)
- 7 integration test files require system deps (pdftoppm, libreoffice, postgres)
- CI installs these deps and passes (verified on GitHub Actions)
- Production build succeeds (verified via Vercel deployment)

## Next Steps (Phase 1+)

1. Rename brand PrintShop → Printelyx (metadata, layout, manifest)
2. Hide /dev routes in production (require NODE_ENV=development)
3. Redirect old routes (/shops/[slug] → /s/[slug], /orders/[id] → /o/[token])
4. Create missing public routes (/about, /contact, /pricing, /terms, etc.)
5. Delete unused CMYK component files
6. Design system: Clear tokens already implemented (ground #F2F3F7, accent #0A58D6, Instrument Sans)
