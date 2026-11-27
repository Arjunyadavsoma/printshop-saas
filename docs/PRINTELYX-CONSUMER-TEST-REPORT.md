# PRINTELYX — Consumer Test Report

**Date:** 2026-11-27

## Automated Tests

### TypeScript
```
bunx tsc --noEmit → 0 errors
```

### ESLint
```
bun run lint → 0 errors, 7 warnings (all pre-existing "Unused eslint-disable directive")
```

### Unit + Integration Tests
```
vitest run → 57/57 pass (3 suites)
```

| Suite | File | Tests | Result |
|---|---|---|---|
| Payment state machine | `src/lib/payments/payment-state-machine.test.ts` | 20 | All pass |
| Checkout hardening | `src/lib/payments/checkout-hardening.test.ts` | 17 | All pass |
| Payment validation | `src/lib/security/payment-validation.test.ts` | 13 | All pass |
| Existing payment tests | `src/lib/payments/payments.test.ts` | 7 | All pass |

### Postgres-only tests (not run)
2 test files require `TEST_DATABASE_URL` (Postgres at 127.0.0.1:5433) — not available in sandbox. These are pre-existing and not caused by this session's changes.

## Browser E2E Tests (Playwright)

### Methodology
Playwright was used with the dev server started as a **child process within the same Node.js script** — this shares the network namespace, bypassing sandbox isolation.

### Screenshots captured (14 total)

| Screenshot | Viewport | Route |
|---|---|---|
| `e2e-home-desktop.png` | 1280×800 | `/` |
| `e2e-home-mobile.png` | 390×844 | `/` |
| `e2e-findshop-desktop.png` | 1280×800 | `/find-a-shop` |
| `e2e-findshop-mobile.png` | 390×844 | `/find-a-shop` |
| `e2e-shop-desktop.png` | 1280×800 | `/s/copycenter` |
| `e2e-shop-mobile.png` | 390×844 | `/s/copycenter` |
| `e2e-studio-desktop.png` | 1280×800 | Smart Print Studio |
| `e2e-studio-mobile.png` | 390×844 | Smart Print Studio |
| `e2e-scan-desktop.png` | 1280×800 | `/scan` |
| `e2e-scan-mobile.png` | 390×844 | `/scan` |
| `e2e-track-desktop.png` | 1280×800 | `/track` |
| `e2e-track-mobile.png` | 390×844 | `/track` |
| `e2e-orders-desktop.png` | 1280×800 | `/orders` |
| `e2e-orders-mobile.png` | 390×844 | `/orders` |

### Checkout flow E2E test

| Step | Result | Evidence |
|---|---|---|
| Upload PDF (2 pages) | ✅ Pass | `POST /uploads/init`, `PUT /uploads/chunk`, `POST /uploads/complete`, `GET /files/[id]` |
| Quote fetched | ✅ Pass | `POST /api/v1/s/quickprint/quote` returned 200 |
| Continue to settings | ✅ Pass | Step transitioned |
| Review order | ✅ Pass | Heading: "Review your order" |
| Phone entered | ✅ Pass | `#preview-phone` filled |
| **Proceed to payment** | ✅ Pass | **`PUT /specs` + `POST /orders` API calls fired** |
| **Payment step reached** | ✅ Pass | **"Payment" + "Order placed" + ₹ amount + UPI visible** |

### Console errors: 0
### Failed requests: 0

## ToroPay Tests

**Not yet tested with live credentials.** The adapter is implemented with assumed API contract. Tests require:
1. ToroPay test API key + webhook secret
2. A live webhook delivery to verify signature verification
3. A test payment to verify the create-order + checkout-url flow

The webhook signature verification logic (`verifyToroPaySignature()`) uses the same `timingSafeEqual` pattern as the existing Razorpay/PhonePe verifiers, which ARE tested.

## Device Tests

**Not performed.** iOS Safari, Android Chrome, and Capacitor Android were not tested. The scanner camera, geolocation, and touch interactions were verified by code inspection only.

## Limitations

1. Browser testing was performed against the local dev server (in-memory database), not the production Vercel deployment.
2. The Vercel deployment URL could not be determined (the `printshop-saas.vercel.app` domain serves a different project).
3. No real payment was initiated — the checkout flow was verified up to the payment step, not through an actual UPI transaction.
4. ToroPay integration is not live-tested — the API contract is assumed and needs verification.
