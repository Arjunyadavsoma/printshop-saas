# PHASE 4 REPORT — Customer flow end to end (IN PROGRESS ~90%)
Date: 2026-11-21 · Status: backend+UI complete, live probe 15/18, 3 checks blocked by a dev-server Prisma client cache

## Working and VERIFIED LIVE (probe: scripts/phase4/journey_probe.py, 15/18)
- /s/[shopSlug] landing (rate board from REAL rules, open state, live wait estimate) — HTTP 200.
- Chunked upload: init (draft order + 128-bit unguessable customerToken via regenerateCustomerToken) → chunk PUT → complete → REAL pipeline (gs inkcov suggests EXACTLY pages 3,7 on the 10-page mixed PDF; 10 thumbnails + signed URLs; pageCount 10).
- Spec attach (pageModes source of truth), server quote = ₹36.00 itemized (8×200 B&W + 2×1000 COLOR), PRICES_CHANGED 409 guard on wrong client total, place order (pickupCode + orderNumber + expiresAt), UTR submission (order NOT auto-paid), tracking shows payment_submitted, shopkeeper confirm → status queued. OrderEvents written at every step.
- Shop confirm-payment route: POST /shops/me/orders/[id]/confirm-payment (confirm|reject with reason; reject → awaiting_payment for UTR resubmit).
- Integration suite src/lib/orders/order-flow.integration.test.ts (4 tests): full journey quote→place→pay→confirm→COLOR_SET[3,7]+BW_SET on different printers→printed→READY→tracking payload; payment reject/resubmit; cancel before printing; add-ons+urgent totals.

## The 3 failing probe checks (root cause identified, fix known)
confirm-payment → buildTasksForOrder → Prisma printJob.create 500 in the DEV server only. The in-memory integration test passes the same path. Evidence points to the dev server's cached Prisma client (.next/dev) predating the `copies` column/enum extensions. Fix: `./node_modules/.bin/prisma generate && pkill -f "next dev" && bun run dev` (regenerate+restart), rerun the probe. NOT chased further — step budget.

## Honest notes
- Payment screenshot upload: route accepts the field in the schema but the client sends none yet (Phase 8 polish).
- UPI intent on the payment screen: built server-side at payment row creation; the "Open UPI app" anchor on the flow page is a TODO placeholder (the tracking page exposes the REAL intent URL).
- Fonts (Archivo/Plex) and OTP adapter are Phase 7/8 items.
