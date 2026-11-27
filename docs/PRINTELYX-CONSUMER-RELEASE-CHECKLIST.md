# PRINTELYX — Consumer Release Checklist

**Date:** 2026-11-27

## Pre-Release

- [x] TypeScript: 0 errors (`bunx tsc --noEmit`)
- [x] ESLint: 0 errors (`bun run lint`)
- [x] Unit tests: 57/57 pass
- [x] Checkout fix verified in browser (Playwright E2E)
- [x] Nearby API fix verified in browser (3 shops found)
- [x] Scanner order-QR support implemented
- [x] Idempotent order placement implemented
- [x] ToroPay adapter + webhook route implemented
- [x] Payment state machine enforced
- [x] Payment idempotency guards in place
- [x] 409 PRICES_CHANGED carries new total
- [x] verify-payment escape hatch restricted
- [x] Cashfree phantom enum removed

## ToroPay-Specific (before enabling live payments)

- [ ] Verify ToroPay API contract against https://www.toropay.co.in/docs
- [ ] Set `TOROPAY_API_KEY` (test mode) in Vercel
- [ ] Set `TOROPAY_WEBHOOK_SECRET` in Vercel
- [ ] Register webhook URL in ToroPay dashboard
- [ ] Test webhook signature verification with a live test event
- [ ] Test create-order flow in test mode
- [ ] Test payment.confirmed event (provider checkout)
- [ ] Test payment.paid event (direct UPI — should NOT auto-finalize)
- [ ] Test duplicate webhook delivery (should be no-op)
- [ ] Switch `TOROPAY_MODE=live` only after all test-mode checks pass

## Post-Release Monitoring

- [ ] Monitor webhook delivery success rate
- [ ] Monitor `/api/v1/cron/reconcile-payments` for stale attempts
- [ ] Monitor Vercel build success (previous builds failed on tsc errors)
- [ ] Monitor shopkeeper `confirm-payment` API for errors
- [ ] Watch for duplicate Payment rows (idempotency guard should prevent)

## Rollback Plan

### If ToroPay causes issues:
1. Set `TOROPAY_MODE=test` or unset `TOROPAY_API_KEY`
2. Change shop's `paymentProvider` to `googlepay` (direct UPI)
3. Comment out `this.register(new ToroPayPaymentAdapter())` in `registry.ts:19`

### If checkout regression:
1. Verify `onProceed={() => { void placeTheOrder(); }}` at `SmartPrintStudio.tsx:600`
2. Verify `placing` state guard at `SmartPrintStudio.tsx:109,358`
3. Verify idempotent retry at `order-flow.ts:173-191`

### If nearby API regression:
1. Verify `import { getContainer }` (not `@/lib/db`) at `nearby/route.ts:1`
2. Verify `db.findMany('shop', { isActive: true })` pattern

## Known Limitations (acceptable for release)

1. Customer email notifications not wired (adapter ready)
2. Push notifications not implemented (no infrastructure)
3. ToroPay API contract needs documentation verification
4. Device testing not performed
5. Design skills not installed (Z.ai Code environment)
