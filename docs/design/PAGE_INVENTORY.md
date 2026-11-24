# Printelyx Page Inventory

**Date:** 2026-11-23
**Branch:** printelyx-phase-0

---

## Customer Routes

| Route | Purpose | Status | Issues |
|-------|---------|--------|--------|
| / | Homepage + shop discovery | Working | Brand says "PrintShop" — needs rename. No marketing content strategy |
| /s/[shopSlug] | QR landing + order flow | Working | Uses Clear design system + CMYK compat layer |
| /s/[shopSlug] flow | 3-step order wizard | Working | Upload → options → review → pay. Draft persistence |
| /o/[token] | Order tracking | Working | Timeline + pickup code + polling + realtime |
| /orders | My orders (device-local) | Working | Reads from localStorage |
| /orders/[id] | OLD order wizard | **REMOVE** | 2000+ lines, replaced by /s/[shopSlug] flow |
| /shops/[slug] | OLD shop landing | **REMOVE** | Replaced by /s/[shopSlug] |
| /help | FAQ | Working | Uses Clear components |
| /privacy | Privacy policy | Working | Uses Clear components |
| /download-app | Android APK download | Working | GitHub Releases integration |

## Shopkeeper Routes

| Route | Purpose | Status | Issues |
|-------|---------|--------|--------|
| /shop/login | Owner/staff login | Working | — |
| /shop/register | New shop signup | Working | — |
| /shop/dashboard | Home (KPIs, needs-you) | Working | — |
| /shop/orders | Queue (list) | Working | — |
| /shop/orders/[id] | Order detail | Working | — |
| /shop/payments | Payment confirmations | Working | — |
| /shop/devices | Printers + device management | Working | — |
| /shop/customers | Customer list | Working | — |
| /shop/reports | Reports + analytics | Working | — |
| /shop/settings | Settings | Working | — |
| /shop/staff | Staff management | Working | — |
| /shop/services | Services + pricing | Working | — |
| /shop/forgot-password | Password reset request | Working | — |
| /shop/reset-password | Password reset form | Working | — |
| /shop/printer | Printer config | Working | — |
| /shop/print-jobs | Print queue (OLD) | **REMOVE** | Duplicates /shop/orders |

## Admin Routes

| Route | Purpose | Status | Issues |
|-------|---------|--------|--------|
| /admin | Overview dashboard | Working | — |
| /admin/login | Admin login | Working | — |
| /admin/shops | Shop management | Working | — |
| /admin/shops/[id] | Shop detail | Working | — |
| /admin/orders | Order monitoring | Working | — |
| /admin/orders/[id] | Order detail | Working | — |
| /admin/analytics | Platform analytics | Working | — |
| /admin/monitoring | System monitoring | Working | — |

## Dev Routes (production-hidden needed)

| Route | Purpose | Status | Issue |
|-------|---------|--------|-------|
| /dev/ui | Component gallery | Working | **EXPOSED IN PRODUCTION** |
| /dev/funnel | Analytics funnel view | Working | **EXPOSED IN PRODUCTION** |

## Missing Routes (need creation)

| Route | Purpose |
|-------|---------|
| /about | Company/about page |
| /contact | Contact form |
| /pricing | Customer pricing info |
| /how-it-works | Product explanation |
| /terms | Terms of service |
| /refund-policy | Refund policy |
| /track | Order lookup (by order number) |

## Dead/Duplicate Routes to Remove

| Route | Reason |
|-------|--------|
| /orders/[id] | Old 2000+ line wizard, replaced by /s/[shopSlug] flow |
| /shops/[slug] | Old shop landing, replaced by /s/[shopSlug] |
| /shop/print-jobs | Duplicates /shop/orders |
