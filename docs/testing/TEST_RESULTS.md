# TEST_RESULTS.md — actual results, per run (no fabricated numbers)

**Latest run:** 2026-11-24, production standalone bundle on the ephemeral CI
stack (`STORAGE_PROVIDER=local`, Postgres 16 @ printshop_ci, seeded via
`prisma/seed.ts`).

## Default unit tier — `bun run test:unit`

| Run | Result |
|---|---|
| 2026-11-24 (after this pass's fixes) | **67 test files passed · 918 tests passed · 0 failed · 4 skipped** (environment-conditional skips) |
| Before this pass's tiering fix | 5 real-Postgres files failed on missing provisioned databases (`printshop_test`/`printshop_app_test`/`printshop_clean` did not exist on a fresh clone) — fixed by proper tiering (`vitest.postgres.config.ts`), not by disabling |

Notable suites included: pricing/checkout (`checkout-real-postgres` tier
excluded — see below), colour-page selection, payment idempotency +
lifecycle transitions, upload validation (12/12 after the type-check fix),
retention logic, order state machine, EXIF stripping.

## Real-Postgres integration tier — `bun run test:postgres`

| File | Result | Reason |
|---|---|---|
| `checkout-real-postgres.test.ts` | **1 failed** / partial | asserts the migration-produced `PaymentAttempt_active_order_unique` partial unique index — absent because the migration chain cannot be replayed (P1-14) |
| `app-webhook-integration.test.ts` | suite failed | asserts the `_prisma_migrations` baseline — no migration history under `db push` provisioning (P1-14) |
| `app-checkout-concurrency.test.ts` | suite failed | same missing-index dependency (P1-14) |
| `webhook-postgres-fk.test.ts` | **1 failed** / partial | same missing-index dependency (P1-14) |
| `migration-integrity.test.ts` | failed | **by design** — it exists to catch a non-replayable chain; failure = P1-14 confirmed |

**Root cause (fresh evidence 2026-11-24):** `DATABASE_URL=…printshop_virgin
bunx prisma migrate deploy` → `ERROR: relation "Printer" does not exist`
(the misdated `20251124000001_mobile_executor_queue_v2` migration references
the `Printer` table created by the later `20261121_*` migration). The tier is
**blocked by P1-14, not broken**: once the owner repairs the chain, these
tests run as written. 11 tests inside the tier did pass against
schema-synced databases.

## E2E — production standalone bundle, mobile-360

| Run | Scope | Result |
|---|---|---|
| 1 (first, this session) | smoke 44 combos + journey | build-independent issues found: shops API 500 (no `DATABASE_URL`), home axe `label-content-name-mismatch`, `/download-app` qrserver console errors |
| 2 | smoke only | 36 passed, 8 failed (`/`, `/download-app`) → fixes applied (axe 2.5.3, static QR) |
| 3 | smoke 44 + journey | 44 passed, 1 failed → journey failed at upload "Ready" (storage `disabled` in CI) → `STORAGE_PROVIDER=local` added |
| 4 | journey only | **passed** (4.7s) — full flow: shop → upload → Ready → colour pages → review → pay → inline UTR sheet → submit |
| 5 (combined) | smoke 44 + journey | 44 passed, 1 failed → journey rejected by the server's **duplicate-UTR protection** (hardcoded test UTR already used by run 4) — correct server behavior per P0-1 |
| 6 (journey only) | journey | **passed** (3.8s) with run-unique UTR |
| **7 (final, combined)** | smoke 44 + journey | **45 passed · 0 failed · 0 flaky (2.1 min)** — green |

Final combined-run result: **run 7 = 45 passed / 0 failed / 0 flaky** — the
suite is green (44 smoke combos + UTR journey) on the production standalone
bundle.

## Lighthouse (production bundle, mobile simulated slow-4G)

| Page | Perf | A11y | CLS | TBT |
|---|---|---|---|---|
| `/` home | **85** (was 69) | **98** (was 94) | **0** (was 0.306) | 587 ms |
| `/s/[slug]` shop | **94** | **100** | 0 | 289 ms |

Budgets enforced (report-only) in CI via `lighthouserc.json`.

## Build

- `bun run build` — passes, including from a broken state
  (`rm -rf node_modules/.prisma → bun run build` ⇒ green) after adding
  `prisma generate` to the build script (the exact failure CI hit on
  commit `7ae3c3b`).
