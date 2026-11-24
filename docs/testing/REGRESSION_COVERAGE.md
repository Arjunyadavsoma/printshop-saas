# REGRESSION_COVERAGE.md — Bug → test mapping

Every entry: a bug from `docs/fixes/BUG-LIST.md` and the automated test that
would **fail before the fix**. Statuses are truthful (test exists & passes /
exists & not run in CI / gap documented).

| Bug | Fix | Regression test | Status |
|---|---|---|---|
| **P0-1** `window.prompt()` UTR entry + fake UTR auto-generation | Inline bottom-sheet; no generated references | `tests/payment-utr.spec.ts` — drives upload→review→pay, asserts the labelled inline sheet appears and submission posts to `POST /api/v1/o/{token}/payment` | **Exists, passes** (E2E, CI) |
| **P0-2** `.txt`/corrupt PDFs accepted with fabricated "Ready" results in dev | `uploads/init` content type gate (`detectKind`); dev fallback no longer simulates validation failures | `src/lib/pipeline/pipeline.integration.test.ts` — txt → FAILED; garbage PDF → FAILED | **Exists, passes** (unit, CI) |
| **P0-3** Page counts fabricated from file size (`bytes/50KB`) | Dev fallback uses the real parser; undeterminable → FAILED | `pipeline.integration.test.ts` (garbage PDF → FAILED, not "N pages"); `src/lib/services/parse-page-count.test.ts` (real 3-page PDF → 3, corrupt → null) | **Exists, passes** (unit, CI) |
| **P1-4** `/about /contact /pricing /terms` stub pages | Real pages shipped | `tests/smoke-public.spec.ts` — placeholder ban ("being written") + title/h1/axe on all four routes × 4 viewports | **Exists, passes** (E2E, CI) |
| **P1-5** No canonical/OG/Twitter; duplicate generic titles | Per-route titles, canonicals, OG/Twitter | `tests/smoke-public.spec.ts` — unique-title assertion per route, title non-empty on 404 too | **Exists, passes** (E2E, CI) |
| **P1-7** `/dev/ui`, `/dev/funnel` public on production | Request-level middleware gate on production builds | Manual probe on production build (`known-issues.json` evidence, re-verified 2026-11-24: 404). *Not yet an automated test — gap noted.* | **Partially covered** |
| **P1-8** robots.txt sitemap → 404 | `src/app/sitemap.ts` | curl `/sitemap.xml` → 200 (evidence `known-issues.json`). *Not yet in smoke spec — gap noted.* | **Partially covered** |
| **P1-9** Offline → eternal "Loading…" | `/offline` route + SW offline fallback + shops-fetch error state | Manual offline emulation evidence (`mobile/*-offline.png`). *Automated offline test not yet added — gap noted.* | **Partially covered** |
| **P1-13** Dead "Coming soon" phone-lookup form live on `/orders` | Gated behind `NEXT_PUBLIC_OTP_ENABLED` | Placeholder ban ("Coming soon") in smoke spec would catch the ungated string on public routes; `/orders` itself is robots-blocked in prod, verified on local build | **Partially covered** |
| **P2-6** `/track` input unlabelled (crawler finding) | **Retracted after re-drive** — label wired via `html/id`; axe gate in smoke spec now covers `/track` × 4 viewports | axe serious/critical gate | **Exists, passes** |
| **P1-11 (this pass)** Home shop-card links: `aria-label` omitted visible text (`label-content-name-mismatch`, axe serious) | Removed the label override so the accessible name is the link's real content | `tests/smoke-public.spec.ts` — axe gate on `/` × 4 viewports (failed before fix: 1 serious violation; passes after) | **Exists, passes** (E2E, CI) |
| **P1-10-adjacent (this pass)** `/download-app` QR loaded from `api.qrserver.com` — console errors wherever the third-party service is unreachable | Pre-generated static `public/download-qr.png` | `tests/smoke-public.spec.ts` — zero-console-error gate on `/download-app` × 4 viewports (failed before fix; passes after) | **Exists, passes** (E2E, CI) |
| **CI (this pass)** Fresh-clone build: `@prisma/client` has no exported `PrismaClient` (bun skips postinstall) | `prisma generate` in build script + workflow; ephemeral Postgres service + `db push` + seed | CI run on `7ae3c3b` failed at "Build production bundle"; local broken-state simulation (`rm -rf node_modules/.prisma` → `bun run build`) passes after fix | **Fixed, verified in CI on next push** |
| **Test-infra (this pass)** Smoke duplicate-title assertion fired on Playwright retries of the same route | Retry-safe comparison (only different routes conflict) | n/a (test-harness fix) | **Fixed** |
| **Upload validation (this pass)** Magic-byte check at `uploads/complete` was **skipped outside production** (`isDevMode` relaxation) — a PNG declared as `application/pdf` was accepted with 200 in dev/test; same dishonest-validation class as P0-2 | Check now enforced in EVERY environment | `src/lib/security/upload-validation.test.ts` (12 tests) — "declared PDF, bytes are PNG" failed with 200 before the fix; passes after | **Exists, passes** (unit, CI) |
| **Storage (this pass)** `STORAGE_PROVIDER=disabled` in CI made `uploads/complete` refuse server-side writes (`STORAGE_PUT_UNAVAILABLE`) — files never reached Ready; the customer journey was untestable against the production bundle | New first-class `STORAGE_PROVIDER=local` (`LocalDiskStorageAdapter`, traversal-safe keys under `STORAGE_LOCAL_DIR`) for CI + self-hosted deployments; production fail-fast guard updated to accept `local` | `tests/payment-utr.spec.ts` journey — upload reached "Ready" after the fix (was: 30s timeout waiting for Ready) | **Exists, passes** (E2E, CI) |
| **P1-14 (fresh evidence this pass)** Migration chain cannot be replayed on a virgin DB | NOT fixed (owner decision) — renaming the misdated migration would desync environments that already applied it | `bunx prisma migrate deploy` on a virgin DB → `ERROR: relation "Printer" does not exist` (reproduced 2026-11-24); `migration-integrity.test.ts` + `webhook-postgres-fk.test.ts` assert the chain-produced schema and fail accordingly | **Documented, blocked on owner** |

## Documented gaps (next candidates)

1. Automated checks for `/sitemap.xml` (200 + valid XML) and `/dev/*` 404 on production builds.
2. Automated offline-mode test (Playwright `context.setOffline(true)`).
3. Authenticated shop-dashboard E2E (needs seeded shopkeeper credentials wired into CI secrets).
4. Provider-webhook signature/replay tests against real sandbox credentials (blocked: no provider account).
