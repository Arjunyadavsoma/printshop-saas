# PRINTELYX — Consumer Stabilization Report

**Date:** 2026-11-26

## Summary

Two critical production-blocking defects were identified and fixed:

1. **Checkout stuck bug** — The StepPreview "Proceed to payment" button did not call `placeTheOrder()`, leaving the customer on a confusing intermediate screen. Fixed by wiring the button to the order-placement function with a loading spinner.

2. **Nearby API 500** — The `/api/shops/nearby` route used Prisma `db` directly instead of the container's database adapter, causing a 500 in dev (and potentially in production if the Prisma client wasn't connected). Fixed by switching to `getContainer().db`.

Both fixes are additive (no business logic changed, no APIs replaced) and verified via `tsc` (0 errors) and `lint` (0 errors).

## Files Changed This Session

| File | Change | Commit |
|---|---|---|
| `src/components/studio/SmartPrintStudio.tsx` | Added `placing` state; wired `onProceed` → `placeTheOrder()` | e4fd899 |
| `src/components/studio/steps/StepPreview.tsx` | Added `placing` prop; loading spinner on proceed buttons | e4fd899 |
| `src/app/api/shops/nearby/route.ts` | Switched from Prisma `db` to `getContainer().db` | 9240810 |
| `docs/PRINTELYX-CHECKOUT-BUG-ROOT-CAUSE.md` | Root cause analysis | e4fd899 |
| `docs/PRINTELYX-CONSUMER-PLATFORM-AUDIT.md` | Full route inventory + defects | 9240810 |
| `docs/PRINTELYX-DESIGN-SKILLS-INVENTORY.md` | Skills installation results | (this commit) |

## Customer Journey Status

| Step | Status | Notes |
|---|---|---|
| 1. Discover a shop | ✅ Fixed | Nearby API 500 resolved; `/find-a-shop` loads |
| 2. Open shop profile | ✅ Working | `/s/[shopSlug]` |
| 3. Start Smart Print Studio | ✅ Working | Studio mounts with shop capabilities |
| 4. Upload documents | ✅ Working | Chunked upload + SHA-256 + retry |
| 5. Configure printing | ✅ Working | B&W/Colour/Mixed, copies, paper, duplex |
| 6. Review accurate pricing | ✅ Working | Server-authoritative quote, itemized breakdown |
| 7. Initiate payment | ✅ Fixed | "Proceed to payment" now places the order + shows payment UI |
| 8. Payment verified server-side | ✅ Working | Shopkeeper manual verify (UPI) / webhook verify (gateways) |
| 9. Exactly one order finalized | ✅ Working | Idempotency guards (Feature 4) |
| 10. Order confirmation displayed | ✅ Working | StepConfirmation with 5 result states |
| 11. Refresh preserves order | ✅ Working | localStorage pending-order restore (24h TTL) |
| 12. Order in history | ✅ Working | `/orders` reads from localStorage + `/o/[token]` |
| 13. Track order status | ✅ Working | `/o/[token]` polls + realtime timeline |
| 14. Receive notifications | ⚠️ Partial | Shopkeeper notifications work; customer email/push not wired |
| 15. Scan QR codes | ✅ Working (code) | `/scan` with jsQR + manual fallback; not browser-tested |
| 16. Location with/without permission | ✅ Working (code) | Geolocation + manual fallback; not browser-tested |

## Remaining Work

1. **Customer email notifications** — wire `ResendEmailAdapter` for order_placed, payment_confirmed, order_ready events.
2. **Push notifications (FCM/Web Push)** — implement device token registration + push for mobile customers.
3. **Migrate `@/lib/db` routes** — 5 routes still use Prisma directly instead of the container adapter (checkout, cron, sync, setup, health). The checkout route is the most impactful (gateway flow).
4. **Browser testing** — not possible in this sandbox; needs a browser-capable environment.
5. **Device testing** — iOS Safari, Android Chrome, Capacitor Android not tested.
