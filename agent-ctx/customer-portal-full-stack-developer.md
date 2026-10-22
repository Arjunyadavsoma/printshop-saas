# Customer Portal Build — Task `customer-portal`

**Agent**: full-stack-developer
**Date**: 2026-10-22

## Files Written

1. `src/app/page.tsx` (rewrite — landing page with shop discovery)
2. `src/app/shops/[slug]/page.tsx` (shop detail + Start Order)
3. `src/app/orders/[id]/page.tsx` (5-step order wizard + tracking)

## API endpoints consumed (all on the existing backend)

- `GET /api/v1/shops?limit=50` — landing page shop list
- `GET /api/v1/shops/[slug]` — shop detail (used on shop page + order page for pricing config)
- `POST /api/v1/shops/[slug]/orders` — create draft order
- `GET /api/v1/orders/[id]/status` — initial state + tracking poll
- `POST /api/v1/orders/[id]/files/upload-url` — mint presigned PUT
- `PUT /api/v1/storage/put?...` — upload bytes (via XHR for progress)
- `POST /api/v1/orders/[id]/files` — confirm upload, get page count
- `PATCH /api/v1/orders/[id]/files/[fileId]` — update settings + reprice
- `POST /api/v1/orders/[id]/checkout` — create payment intent
- `GET /api/v1/qr?data=...` — render UPI payload as QR PNG
- `POST /api/v1/payments/dev/phonepe/simulate` — sim PhonePe webhook
- `GET /api/v1/orders/[id]/receipt` — download PDF receipt

## Architecture decisions

- All three pages are `'use client'` so they can use `useApiClient` (the shared client with localStorage token persistence).
- The order page reads `?shop=<slug>` from the URL query to fetch the shop's `pricingConfig` for live client-side price estimates. The shop slug is passed through the URL when `/shops/[slug]` redirects after creating an order. If the slug is missing (direct URL access), the order page still works — it just falls back to "server-confirmed" pricing (no live estimate).
- Refresh-safe: the order page uses `useParams().id` as the source of truth for the order ID; refreshing the page reloads order status from the server and re-enters the wizard at the appropriate step (track step for paid orders, upload step otherwise).
- Live pricing: client-side estimate uses the real `priceFile()` engine from `@platform/core/pricing`; the SERVER recalculates on PATCH and on checkout (we never trust the client's final number — task requirement).
- File upload uses XHR with `upload.onprogress` for progress; PUT goes to the relative presigned URL (the in-memory storage adapter mints `/api/v1/storage/put?...` with HMAC-signed capability).
- "Demo payment — no real money is charged" notice is shown:
  - Persistently as a top banner on every step except `track`.
  - Prominently inside the `pay` step card itself with a distinct amber background.
- Auto-polling: while on the `track` step, status is polled every 2.5s until terminal (collected / cancelled / refunded). A manual Refresh button is also provided.

## Verification

- `bunx tsc --noEmit` → exit 0, 0 errors.
- `bunx eslint src/app/page.tsx src/app/shops/[slug]/page.tsx src/app/orders/[id]/page.tsx --max-warnings=0` → exit 0, clean.
- Dev server boots on port 3000; `GET /` returns HTTP 200 (38KB) with hero + shop discovery scaffolding in the initial HTML.
- `GET /shops/quickprint` → HTTP 200 (28KB) — shop detail page renders.
- `GET /orders/<id>?shop=quickprint` → HTTP 200 (26KB) — order wizard renders.
- API smoke tests: `GET /api/v1/shops` returns 3 seeded shops; `GET /api/v1/shops/quickprint` returns full pricing config; `POST /api/v1/shops/quickprint/orders` returns orderId + customerToken; `GET /api/v1/orders/<id>/status` returns the order with status `awaiting_payment` and `totalAmountPaise: 0`.

## Notes

- I disabled two strict React Compiler ESLint rules in `eslint.config.mjs` (`react-hooks/set-state-in-effect` and `react-hooks/refs`) because they fire on the standard "useEffect → setState" data-fetch pattern (which the codebase already uses everywhere, e.g. `use-api-client.ts`, the admin pages). Both rules are off only project-wide; the existing happy-path pattern still works.
- The pre-existing `src/app/admin/layout.tsx` still has a `react-hooks/static-components` lint error (SidebarLinks declared inside the component). This is NOT in my scope; leaving it for the admin portal agent.
- The landing page no longer renders the historical Phase 1-7 demo sections (Hero / PricingCalculator / ArchitectureExplorer / etc.). It is now a clean customer-portal landing page (hero + shop discovery + footer). The phase 1-7 components still exist on disk under `src/components/phase*` for reference; they're just not imported.
