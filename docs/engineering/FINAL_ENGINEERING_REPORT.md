# FINAL_ENGINEERING_REPORT.md — Printelyx production repair & quality pass

**Date:** 2026-11-24 · **Branch worked on:** `fix/site-audit` (merged fast-forward into `main`) · **Repository:** github.com/Arjunyadavsoma/printshop-saas · **Production:** https://printelyx.cc.cd (Vercel)

## 1. Original state

A Next.js (App Router) printing marketplace with real business logic and
integrations (Postgres/Prisma, chunked upload pipeline with normalization +
colour detection, manual-UTI/UPI payment flow, shopkeeper dashboard, print
agent contract) but with: a payment step that used `window.prompt()` for UTR
entry (invisible in many mobile in-app browsers) plus a fake-UTR generation
path; dev-build upload fallbacks that fabricated "Ready" states and page
counts from file size; four stub footer pages; no per-route metadata; dev
routes reachable on production; QA test shops visible to customers; no
sitemap; offline dead-ends; Lighthouse home 69/CLS 0.306; no CI gates; and a
migration chain that cannot be replayed on a fresh database. Full register:
`docs/fixes/BUG-LIST.md` (P0×3 · P1×14 · P2×10, with evidence).

## 2. Confirmed defects (final status per defect)

| Issue | Priority | Status | Implementation | Verification |
|---|---|---|---|---|
| P0-1 `window.prompt()` UTR + fake UTR auto-generation | P0 | **Fixed and tested** | Inline bottom-sheet; generated references removed; order stays `payment_submitted` until shop verification; idempotent/duplicate-safe submission | `tests/payment-utr.spec.ts` full journey, green on the production bundle (CI) |
| P0-2 dev pipeline marked any failed file "Ready" | P0 | **Fixed and tested** | Content type gate at `uploads/init`; dev fallback no longer simulates validation failures | `pipeline.integration.test.ts` (txt/garbage → FAILED) |
| P0-3 page counts fabricated from file size | P0 | **Fixed and tested** | Real parser only; undeterminable → FAILED | `parse-page-count.test.ts` + pipeline regressions |
| P1-1 `/shop/print-jobs` dead redirect | P1 | **Fixed, not tested on device** | Bare visits redirect to `/shop/orders` | Local navigation check |
| P1-2 duplicate devices routes | P1 | **Fixed** | Canonical `/shop/devices`, legacy alias kept | Local |
| P1-3 `/help` dead accordions | P1 | **Retracted** (crawler artifact) | Accordions work (re-driven) | `evidence/known-issues/help-accordion-after-click.png` |
| P1-4 four stub pages | P1 | **Fixed** | Real `/about /contact /pricing /terms`; contact controls gated on real env vars | Smoke suite (placeholder ban + axe) |
| P1-5 no canonical/OG/Twitter, duplicate titles | P1 | **Fixed and verified** | Per-route metadata incl. dynamic shop titles; generated `public/og.png`; 404 has a title | Smoke suite unique-title gate |
| P1-6 QA shops visible on production | P1 | **Not fixed — owner data action** | QA shops live in the production datastore; deletion is an owner action | Production crawl evidence |
| P1-7 `/dev/ui`, `/dev/funnel` public | P1 | **Fixed and verified** | Request-level middleware gate on production builds | Probe → 404 on production build |
| P1-8 sitemap 404 | P1 | **Fixed and verified** | `src/app/sitemap.ts` | `/sitemap.xml` → 200 |
| P1-9 offline dead-ends | P1 | **Fixed, not tested on device** | `/offline` + SW offline navigation fallback + shops-fetch error card with retry | Offline emulation evidence (manual) |
| P1-10 CSP-blocked GitHub API fetch | P1 | **Fixed and verified** | External fetch removed; stable releases link | Smoke: zero console errors |
| P1-11 home axe violations | P1 | **Fixed and tested** | Landmark/h1 fixes; footer restyle; final `label-content-name-mismatch` (WCAG 2.5.3) removed this pass | Smoke axe gate on `/` ×4 viewports green |
| P1-12 `/download-app` regions | P1 | **Fixed and tested** | `<main>` + structure; external QR → static asset this pass | Smoke axe + console gates green |
| P1-13 "Coming soon" phone lookup live | P1 | **Fixed and verified** | Gated behind `NEXT_PUBLIC_OTP_ENABLED` | Local build check |
| P1-14 migration chain broken on fresh DB | P1 | **Blocked — owner decision** | NOT changed (renaming desyncs applied environments); fresh evidence reproduced: `migrate deploy` on virgin DB → `relation "Printer" does not exist`; CI/integration tier uses `db push`; `migration-integrity.test.ts` stays as the watchdog | Virgin-DB reproduction 2026-11-24; integration-tier failures match |
| P2-1…P2-10 polish batch | P2 | **Fixed** (P2-6 retracted as detector artifact; P2-9 home perf below) | Theme-leak, footer dots/arrows, `.local` addresses, privacy date + retention table, manifest tokens, Capacitor log level, colour-picker copy, pluralisation, real `upi://` intents, ≥48px footer targets | Smoke + manual evidence |
| Home Lighthouse 69 / CLS 0.306 | P2 | **Partially fixed** | 85 perf / CLS 0 / a11y 98; remaining gap is main-thread JS (TBT 587ms) — code-splitting of the home surface is follow-up work | Lighthouse budgets in CI (report-only) |
| CI build failure (`PrismaClient` export) | P0 (CI) | **Fixed and tested** | `prisma generate` in build script + workflow; Postgres service + `db push` + seed in CI | Broken-state simulation `rm -rf node_modules/.prisma → bun run build` passes; CI run on next push |
| Upload type-check skipped outside production | P1 | **Fixed and tested** | `isDevMode` relaxation removed at `uploads/complete` | `upload-validation.test.ts` 12/12 (failed before) |
| No storage provider for CI/self-hosted | P1 | **Fixed and tested** | `STORAGE_PROVIDER=local` (`LocalDiskStorageAdapter`), traversal-safe, private-by-default | Journey upload→Ready→pay green on production bundle |
| Integration test tier missing on fresh clones | P1 | **Fixed and tested** | `vitest.postgres.config.ts` + default-run exclusion (tiering, not disabling) + `scripts/bootstrap-test-dbs.mjs` | `test:unit` 67 files/918 tests green; tier runs explicitly |

## 3. Changes implemented (summary)

Phases 2–5 (commits `ab80717`, `65fe94c`, `2d54ff7`, `7ae3c3b`): P0 payment +
upload integrity fixes with regression tests; real consumer pages; per-route
metadata + sitemap; offline handling; dev-route gating; perf; CI workflow
with permanent gates. This session (single commit on top): CI repair (Prisma
generate + Postgres service + seed), axe WCAG 2.5.3 fix on home, static QR,
retry-safe smoke assertions, self-sufficient UTR journey (runtime slug +
embedded PDF fixture), unconditional upload type validation, vitest tiering,
local storage provider, and the full documentation tree (this file,
`SKILL_USAGE.md`, `IMPLEMENTATION_LOG.md`, `BASELINE_AUDIT.md`,
`DESIGN_SYSTEM.md`, `PAGE_INVENTORY.md`, `SECURITY_AUDIT.md`,
`FILE_RETENTION_POLICY.md`, `TEST_PLAN.md`, `TEST_RESULTS.md`,
`REGRESSION_COVERAGE.md`).

## 4. Files changed

Backend/core: `src/app/api/v1/s/[slug]/uploads/complete/route.ts`,
`src/lib/container.ts`, `packages/adapters/src/storage/local-disk.adapter.ts`
(new), `packages/adapters/src/index.ts`, `prisma/seed.ts` (verified, no drift
vs current schema), `vitest.config.ts`, `vitest.postgres.config.ts` (new),
`package.json`, `.env.example`, `.github/workflows/site-audit.yml`.
Frontend: `src/app/page.tsx`, `src/app/download-app/download-app-client.tsx`,
`public/download-qr.png` (new), the Phase-3 page set (see `IMPLEMENTATION_LOG.md`).
Tests: `tests/smoke-public.spec.ts`, `tests/payment-utr.spec.ts`,
`src/lib/security/upload-validation.test.ts`.
Full per-phase inventory in `docs/engineering/IMPLEMENTATION_LOG.md`.

## 5. Database migrations

**None applied.** No schema changes were made this pass. The pre-existing
migration-chain defect (P1-14) is documented, reproduced on a virgin DB, and
left for the owner: rename `20251124000001_mobile_executor_queue_v2` to sort
after `20261121_*` **in a maintenance window** (production has already
applied it under the old name; a plain rename makes `migrate deploy` attempt
a duplicate application there), or rebuild environments with `db push`.
CI/test databases use `prisma db push` (schema sync) until then.

## 6. APIs changed

- `POST /api/v1/s/[slug]/uploads/complete` — magic-byte-vs-declared-type
  enforcement is now unconditional (was skipped outside production);
  unchanged contract otherwise (same status codes/codes).
- `/api/v1/storage/get|put` — unchanged; the new `local` adapter implements
  the same capability-URL scheme.
- All other endpoints unchanged; backward compatible.

## 7. Design improvements

Token system documented in `docs/design/DESIGN_SYSTEM.md` (OKLCH semantic
tokens bridged into Tailwind v4 via `@theme inline`); restrained palette,
two-family typography, consistent radii/shadows/borders, ≥48px touch targets,
SVG icons, honest empty/loading/error states. Skills and their influence:
`docs/engineering/SKILL_USAGE.md`.

## 8. Pages redesigned

`/` home, `/about`, `/contact`, `/pricing`, `/terms`, `/privacy`,
`/refund-policy`, `/help`, `/how-it-works`, `/shops` (discovery), shop page
`/s/[slug]`, `/track`, `/o/[token]`, `/download-app`, `/offline`, 404 — all
covered by the smoke suite (11 public routes × 4 viewports green). Inventory:
`docs/design/PAGE_INVENTORY.md`.

## 9. Security fixes

UTR fake-payment path removed; upload validation enforced unconditionally;
dev routes gated; external calls eliminated (GitHub API, qrserver); EXIF/GPS
stripping verified (re-encode without metadata); production fail-fast guards
for persistence-less providers; no secrets in code/logs. Full report:
`docs/security/SECURITY_AUDIT.md`.

## 10. Test commands

```bash
bun run test:unit          # default tier — 67 files / 918 tests
bun run test:postgres      # real-Postgres tier (provision DBs first)
bun run build              # production bundle (incl. prisma generate)
bunx playwright test tests/smoke-public.spec.ts tests/payment-utr.spec.ts --project=mobile-360
bunx @lhci/cli autorun --config=./lighthouserc.json   # Lighthouse budgets
```

## 11. Actual test results

See `docs/testing/TEST_RESULTS.md` (kept truthful per run; fabricated
results prohibited). Headline: default unit tier **918 passed / 0 failed**
(4 environment-conditional skips); E2E smoke 44/44 route-viewport combos +
UTR journey **green** on the production standalone bundle; real-Postgres
tier **blocked by P1-14** (tests fail by design until the chain is repaired —
that is their job); Lighthouse home 85/CLS 0/a11y 98, shop 94/100.

## 12. Build results

`bun run build` passes, including from a broken state (no generated Prisma
client) after the CI repair. Standalone server boots with
`STORAGE_PROVIDER=local` + ephemeral Postgres and serves all routes.

## 13. Preview URL

**Not available** — no Vercel token in this environment (documented blocker;
rule: do not fabricate). Verification used the production standalone bundle
locally, which is the same artifact Vercel deploys.

## 14. Production deployment URL

https://printelyx.cc.cd (Vercel auto-deploys `main`). This pass's commit is
pushed to `main`; deployment health checked after push (§16).

## 15. Deployment commit

`main` fast-forward `3679dc5..7ae3c3b` (phases 1–5) plus the CI-repair
commit(s) from this session — see `git log` / the GitHub push verification
in the final report message.

## 16. Remaining blockers

1. **P1-14** (owner): repair the migration chain (maintenance-window rename
   or environment rebuild) → then the real-Postgres tier runs and CI can
   switch from `db push` to `migrate deploy` if desired.
2. **P1-6** (owner): delete QA shops from the production datastore.
3. **Preview deployments** (owner): provide a Vercel token if preview URLs
   are wanted per-branch.
4. **Provider webhooks** (owner): sandbox credentials for PhonePe/Paytm to
   enable automatic verification tests.
5. **iOS/WebKit + real devices** (owner/QA): sandbox lacks WebKit; Android
   emulation used.

## 17. Known limitations

- Home Lighthouse perf 85 (target 90): main-thread JS on the home surface;
  shop page meets budget (94/100). Follow-up: code-split home.
- Shopkeeper/admin dashboards improved where customer-facing operations were
  affected (BUG-LIST P1-1/P1-2) but not fully redesigned — out of this pass's
  P0/P1 scope.
- WebKit/iOS, real-device PWA installs, and authenticated production pages
  untested (environment constraints above).

## 18. Rollback instructions

The push is a fast-forward; rollback = re-deploy the previous commit:

```bash
# Identify the pre-pass commit (3679dc5) and revert main to it:
git push --force-with-lease origin 3679dc5:main   # owner-authorized action only
# or, prefer revert commits to preserve history:
git revert <merge-range> && git push origin main
```

Vercel: redeploy the previous production deployment from the Vercel
dashboard (Deployments → prior production build → Promote/Redo). No database
migrations shipped, so no DB rollback is needed.
