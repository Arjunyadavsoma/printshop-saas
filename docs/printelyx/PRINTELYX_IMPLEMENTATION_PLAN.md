# Printelyx Implementation Plan

**Date:** 2026-11-23

---

## Phase 0: Audit ✅ COMPLETE
- Repository inspected (35 routes, 122 API endpoints, 155 components)
- Page inventory created (8 critical issues identified)
- Architecture documented
- This plan

## Phase 1: Brand Identity + Design System (NEXT)
1. Rename PrintShop → Printelyx in:
   - layout.tsx metadata (title, description, applicationName, appleWebApp)
   - manifest.ts (name, short_name)
   - login/register page headers
   - navbar/footer text
2. Create /dev route middleware (hide in production)
3. Delete unused CMYK component files (29 files)
4. Verify Clear design tokens are the single source of truth

## Phase 2: Homepage + Shop Discovery + Shop Details
1. Redesign / as customer-first marketplace
2. Add missing routes: /about, /pricing, /how-it-works
3. Improve /shops/[slug] (redirect to /s/[slug])
4. Shop cards with verified info only

## Phase 3: Customer Upload + Preview + Configuration
1. Verify existing /s/[shopSlug] flow works end-to-end
2. Test upload (PDF, JPG, PNG)
3. Verify page preview + page picker
4. Test configuration (paper, colour, duplex, copies)

## Phase 4: Pricing + Checkout + UPI + Tracking
1. Verify server-side pricing (already implemented)
2. Verify UTR flow + counter payment
3. Verify tracking with all states
4. Create /track route (order lookup by number)

## Phase 5: Shop Registration + Auth + Dashboard
1. Verify /shop/register 4-step flow
2. Verify /shop/login + forgot/reset password
3. Verify /shop/dashboard KPIs

## Phase 6: Shop Orders + Profile + Pricing + Payments
1. Verify /shop/orders queue + detail
2. Verify /shop/settings (profile, pricing, QR, payments)
3. Remove /shop/print-jobs (redirect to /shop/orders)

## Phase 7: PrintEXE Integration
1. Verify device contract (pair, heartbeat, dispatch, status)
2. Verify print execution flow
3. Verify file retention

## Phase 8: Admin Panel
1. Verify /admin modules
2. Add missing: subscriptions, feature flags, support tickets

## Phase 9: Public Info + Legal Pages
1. Create /terms, /refund-policy, /contact
2. Verify /help, /privacy

## Phase 10: Mobile Optimization + Accessibility
1. Test at 360×800, 390×844, 412×915
2. Verify touch targets, safe areas, no horizontal scroll
3. axe accessibility checks

## Phase 11: Security + Performance + Regression
1. Security audit (auth, isolation, upload validation, secrets)
2. Performance (Lighthouse CI, bundle size)
3. Full test suite run

## Phase 12: Production Deployment + Verification
1. Push to main
2. Verify Vercel deployment
3. Smoke test production routes
