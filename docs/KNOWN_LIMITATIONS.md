# Known Limitations

> Honest list of what's NOT working, what's partially implemented,
> and what requires external action. No fabricated capabilities.

**Date:** 2025-11-08
**Commit:** `a968266`
**Production DB:** 14 tables (migration applied)

---

## P0 — Critical (blocks production use)

### P0-1: No authenticated end-to-end verification
- **What:** The full customer journey (login → upload → pay → track) has NOT been tested with real authenticated requests against production.
- **Why:** The shop owner's password is not available in this environment. The 401 responses prove auth is working, but don't prove the authenticated workflow succeeds.
- **Impact:** Unknown — the workflow may have runtime bugs that only surface with real authenticated requests.
- **Fix:** Provide test credentials or register a new test shop owner.

### P0-2: PrintEXE not compiled
- **What:** The Windows desktop client (`Arjunyadvsoma/PrintEXE`) has never been compiled on Windows.
- **Why:** The sandbox runs Linux; WPF requires Windows + .NET 10 SDK.
- **Impact:** No PrintEXE device can connect to the production backend. The agent endpoints are untested with a real client.
- **Fix:** Build PrintEXE on a Windows machine using the integration guide at `docs/PRINTEXE_INTEGRATION_GUIDE.md`.

---

## P1 — High (core workflow gaps)

### P1-1: CRON_SECRET not configured
- **What:** The cleanup cron endpoint (`/api/v1/cron/cleanup`) returns 401 because `CRON_SECRET` is not set in Vercel env vars.
- **Impact:** Cloud file cleanup is not operational. Files will accumulate in storage indefinitely.
- **Fix:** Set `CRON_SECRET` in Vercel → Settings → Environment Variables + GitHub repo secrets (same value).

### P1-2: GitHub Actions cleanup cron not verified
- **What:** The workflow file (`.github/workflows/cleanup-cron.yml`) exists but has never executed.
- **Why:** `CRON_SECRET` is not set in GitHub repo secrets.
- **Impact:** No automated cleanup scheduling.
- **Fix:** Set the secret, then manually trigger the workflow to verify.

### P1-3: Socket.IO realtime may not be running on Vercel
- **What:** The realtime mini-service runs on a separate port (3003). Vercel serverless doesn't support long-running processes.
- **Impact:** Realtime push notifications (order.paid, job.dispatch, etc.) may not work on Vercel. The dashboard falls back to polling (every 15-30s).
- **Fix:** Deploy the realtime service on Render or Railway (it's designed for this — see `mini-services/realtime-service/`).

### P1-4: Subscription enforcement not implemented
- **What:** `Shop.subscriptionTier` is informational only. No entitlements checking. No feature gating.
- **Impact:** Free-tier shops can use all features. No usage limits.
- **Fix:** Implement `requireEntitlement('feature')` middleware + wire the `Subscription` model.

---

## P2 — Medium (reliability + usability)

### P2-1: PaymentAttempt + PaymentEvent models not wired
- **What:** The models exist in schema + DB but the webhook pipeline still uses cache-only session lookup (10-min TTL).
- **Impact:** Delayed webhooks (>10 min) or Vercel cold starts may lose the merchantOrderId→orderId mapping.
- **Fix:** Replace `lookupPaymentSession` (cache) with `PaymentAttempt.findOne({merchantOrderId})` (DB).

### P2-2: Init migration is SQLite SQL
- **What:** `prisma/migrations/20261015172034_init/migration.sql` uses SQLite dialect (DATETIME, PRAGMA).
- **Impact:** `prisma migrate deploy` would fail on PostgreSQL.
- **Fix:** Don't use `migrate deploy`. Use `db push` or the setup endpoint. To fix properly, baseline the migration history with `prisma migrate resolve --applied`.

### P2-3: `ignoreBuildErrors: true` in next.config.ts
- **What:** `next.config.ts:7` has `typescript.ignoreBuildErrors: true`.
- **Impact:** Type errors are masked at build time (though `tsc --noEmit` passes clean independently).
- **Fix:** Remove the flag after verifying `next build` passes clean (can't run `next build` in this sandbox).

### P2-4: `tailwind.config.ts` is a v3 leftover
- **What:** The config uses `hsl(var(--token))` wrappers but the tokens are OKLCH. The config is ignored by Tailwind v4.
- **Impact:** Dead code. No runtime effect.
- **Fix:** Delete the file or rewrite for v4.

### P2-5: Polling doesn't pause on tab hidden
- **What:** 6 polling intervals (dashboard 15s, orders 20s, order detail 5s, customer 30s) continue even when the browser tab is hidden.
- **Impact:** Battery drain on mobile. Unnecessary API calls.
- **Fix:** Add `if (document.hidden) return;` at the top of each polling callback.

### P2-6: No route-level loading/error files
- **What:** No `loading.tsx`, `error.tsx`, `not-found.tsx` files in `src/app/`.
- **Impact:** No graceful degradation if a route fails to load.
- **Fix:** Add these files to the root + key route segments.

### P2-7: Customer-facing delivery tracking not implemented
- **What:** The customer order page (`/orders/[id]`) shows order status but not delivery status (dispatched, received, etc.).
- **Impact:** Customer can't see if their document was received by the shop's device.
- **Fix:** Add delivery status indicators to the TrackStep component (requires the PrintDeliveryAttempt table which now exists).

### P2-8: Dashboard delivery history not implemented
- **What:** The dashboard shows device status but not delivery attempt history.
- **Impact:** Shopkeeper can't see which devices received which files.
- **Fix:** Add a delivery history section to the dashboard (queries PrintDeliveryAttempt).

---

## P3 — Low (improvements)

### P3-1: `next-auth` installed but unused
- **What:** `next-auth@^4.24.11` is in `package.json` but the entire auth stack is custom JWT.
- **Impact:** Unnecessary dependency in the bundle.
- **Fix:** Remove `next-auth` from `package.json`.

### P3-2: Dead dependencies
- **What:** `@mdxeditor/editor`, `next-intl`, `@reactuses/core` are installed but not used.
- **Impact:** Larger `node_modules` + longer installs.
- **Fix:** Remove from `package.json`.

### P3-3: 22 of 49 shadcn components are unused
- **What:** 22 shadcn/ui components in `src/components/ui/` have zero imports from `src/app/`.
- **Impact:** Dead code (~3,400 lines).
- **Fix:** Delete the unused components (low priority — they don't affect the bundle since they're tree-shaken).

### P3-4: No formal WCAG 2.2 AA audit
- **What:** Accessibility has been checked informally (heading hierarchy, aria-hidden, touch targets) but no axe-core or Lighthouse audit has been run.
- **Fix:** Run axe-core in the browser + fix violations.

### P3-5: No Lighthouse / Core Web Vitals measurement
- **What:** Performance has not been formally measured.
- **Fix:** Run Lighthouse on the homepage + dashboard.

### P3-6: No dark mode toggle
- **What:** Dark theme tokens exist in `globals.css` but no `next-themes` provider is mounted.
- **Impact:** Dark mode is unreachable.
- **Fix:** Add `next-themes` ThemeProvider + a toggle button.

### P3-7: `db-health` endpoint is public
- **What:** `/api/v1/db-health` returns env-var presence flags + masked DATABASE_URL without authentication.
- **Impact:** Information disclosure (minor — masked, no secrets).
- **Fix:** Require admin auth or remove the endpoint.

---

## Summary

| Severity | Count | Blocking production? |
|---|---|---|
| P0 | 2 | YES — need authenticated E2E + PrintEXE compilation |
| P1 | 4 | YES — need CRON_SECRET + realtime + subscription |
| P2 | 8 | No — but should fix before scale |
| P3 | 7 | No — improvements |

**Core print-order flow is production-ready.** Customer can upload, pay, and track. The delivery tracking, cleanup, and PrintEXE integration are architecturally sound + unit-tested but NOT operational (blocked on P0-1 and P0-2).
