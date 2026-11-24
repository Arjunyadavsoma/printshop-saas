# TEST_PLAN.md — Printelyx quality gates

**Status:** live (executed; see `TEST_RESULTS.md` for the latest actual run)
**Branch:** `fix/site-audit` → `main` · **Date:** 2026-11-24

## Levels and commands

| Level | Scope | Command | Gate |
|---|---|---|---|
| Unit (default tier) | pricing, colour pages, payments/UTR, upload validation, order state, retention — everything that does not need a provisioned Postgres | `bun run test:unit` (vitest) | all pass |
| Real-Postgres tier | checkout idempotency concurrency, webhook persistence, FK enforcement, migration-chain integrity — needs provisioned DBs (`printshop_test`, `printshop_app_test`, `printshop_clean`) | `bun run test:postgres` (vitest.postgres.config.ts); provision with `scripts/bootstrap-test-dbs.mjs` | tier is **blocked by P1-14** (migration chain cannot be replayed on a virgin DB — the `20251124000001_*` migration references a table created later); failures are the P1-14 watchdog, not flakes |
| E2E smoke — public routes | 11 public routes × 4 viewports (360/390/768/1280): zero console errors, zero failed requests, no horizontal overflow, unique `<title>` + `<h1>`, placeholder-string ban (`.local`, "Coming soon", "being written", `TODO`, "lorem"), axe-core serious/critical = 0 | `bunx playwright test tests/smoke-public.spec.ts --project=mobile-360` | all pass |
| E2E journey — payment integrity | Full customer journey: shop → upload valid PDF → process → colour pages → review → customer info → pay → inline UTR sheet (not `window.prompt`) → submit real-format UTR → waiting state | `bunx playwright test tests/payment-utr.spec.ts --project=mobile-360` | passes |
| Build | Production standalone bundle | `bun run build` | compiles (incl. `prisma generate`) |
| Lighthouse budgets | Home + shop page perf/a11y budgets on the production build | `bunx @lhci/cli autorun --config=./lighthouserc.json` | within budgets (report-only in CI) |

## Environment under test

- The smoke/journey suites run against the **production standalone bundle** (`bun run build` → `.next/standalone/server.js`), started with CI secrets (`STORAGE_PROVIDER=local` + `STORAGE_LOCAL_DIR` on the runner's disk, throwaway JWT/payment secrets) and an **ephemeral Postgres** seeded via `prisma db push` + `prisma/seed.ts` (`DATABASE_URL=…printshop_ci`).
- `DATABASE_PROVIDER=memory` is deliberately **refused** when `NODE_ENV=production` (`src/lib/container.ts` fail-fast) — CI exercises the real Prisma path against a disposable database, never production data.
- The UTR journey resolves the shop slug at runtime from `/api/v1/shops` and generates its 3-page PDF fixture on the fly, so it survives seed changes and fresh CI runners.

## What is intentionally NOT automated here

- **Production-data tests:** no real orders, payments or refunds are ever created against production (rule 3.4). The journey writes only to the ephemeral CI database.
- **Real-device checks** (iOS Safari/WebKit, PWA install, soft-keyboard overlap): sandbox lacks WebKit system libraries; documented in `docs/fixes/BUG-LIST.md` → "Could not verify".
- **Authenticated production pages** (`/shop/*`, `/admin`, `/orders`): robots-disallowed in production; covered by local/E2E runs with seeded accounts instead.
- **Payment provider webhooks** (PhonePe/Paytm): no sandbox credentials available in this environment; covered by unit/integration tests (`src/lib/payments/*.test.ts`) and the manual-verification path only.

## Regression policy

Every fixed bug gets a test that fails before the fix. Mapping in
`REGRESSION_COVERAGE.md`; results in `TEST_RESULTS.md`.
