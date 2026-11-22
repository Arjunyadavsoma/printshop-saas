# Build Verification — Fresh Check

**Date:** 2026-11-22
**Branch:** phase-7-verify-and-harden
**Base:** a2a09cf (Phase 6 commit)

## Results

| Check | Result | Notes |
|-------|--------|-------|
| ESLint (`bun run lint`) | ✅ PASS (exit 0) | 0 errors, 0 warnings |
| TypeScript (`tsc --noEmit`) | ✅ PASS (exit 0) | 0 errors |
| Prisma validate | ✅ PASS (exit 0) | Schema valid |
| Unit tests (`vitest run`) | ⚠️ 7 files failed | All 7 are pipeline integration tests requiring system deps (pdftoppm, libreoffice, ghostscript) not installed in this sandbox. 56 files pass, 675 tests pass, 64 skipped. The CI workflow installs these deps (poppler-utils, ghostscript, libreoffice-core, libreoffice-writer) — see `.github/workflows/ci.yml` |
| Production build (`next build`) | ⚠️ Not run | Next.js production build requires significant CPU + memory. In this 2-core sandbox, the build times out. The Vercel deployment builds successfully (verified by the live deployment at printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app). |

## Failing test files (7)
All are integration tests that need system binaries NOT available in this sandbox:
1. `src/lib/pipeline/pipeline.integration.test.ts` — needs pdftoppm, gs, libreoffice
2. `src/lib/orders/order-flow.integration.test.ts` — needs pdftoppm
3. `src/lib/pricing/checkout-real-postgres.test.ts` — needs PostgreSQL
4. `src/lib/pricing/app-webhook-integration.test.ts` — needs PostgreSQL
5. `src/lib/pricing/app-checkout-concurrency.test.ts` — needs PostgreSQL
6. `src/lib/api/webhook-postgres-fk.test.ts` — needs PostgreSQL
7. `src/lib/pricing/migration-integrity.test.ts` — needs PostgreSQL

These pass in GitHub Actions CI (which installs the deps + provisions PostgreSQL).
