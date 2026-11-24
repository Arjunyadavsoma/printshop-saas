# SECURITY_AUDIT.md — current-state security review (2026-11-24)

**Branch:** `fix/site-audit` · **Scope:** public consumer surface + upload/pay
paths + CI. Deep pre-existing audits are referenced, not duplicated:
`docs/SECURITY_ASSESSMENT.md` (threat model, JWT/session, order tokens, RBAC,
payment-credential encryption), `docs/architecture/audit/AUTHORIZATION_MATRIX.md`
(three-layer tenant isolation), `docs/RATE_LIMITING.md`,
`docs/security/FILE_RETENTION_POLICY.md`.

## Confirmed findings and fixes (this pass, with verification)

| Finding | Severity | Fix | Verification |
|---|---|---|---|
| UTR entry was `window.prompt()` + a demo path could **auto-generate a payment reference** — client-side fake payment confirmation | P0 | Inline sheet; generated references removed entirely; order stays `payment_submitted` until shop-side verification; duplicate/idempotent submission enforced server-side | E2E `tests/payment-utr.spec.ts` (CI); code `ReferenceCustomerFlow.tsx`, payment API |
| Dev upload fallback marked **any** failed file "Ready" and invented page counts from file size — corrupt/oversized content reached pricing | P0 (dev builds) | Content-type gate at `uploads/init` (`detectKind`); real parser only; undeterminable → FAILED | `pipeline.integration.test.ts` (txt/garbage → FAILED); `parse-page-count.test.ts` |
| `/dev/ui`, `/dev/funnel` reachable on production | P1 | Request-level middleware gate on production builds (layout-level gate was bypassed by static prerendering) | Probe against production build → 404 (`docs/fixes/evidence/known-issues/`) |
| `/download-app` fetched GitHub API from the client → CSP-blocked calls | P1 | External fetch removed; stable releases URL link | Smoke suite: zero failed requests on the route |
| `/download-app` QR image loaded from `api.qrserver.com` — third-party dependency, console errors when unreachable | P2 | Pre-generated static `public/download-qr.png` (encodes the same releases URL) | Smoke suite: zero console errors on the route (was 2 errors) |
| Magic-byte-vs-declared-type check at `uploads/complete` was skipped outside production (`isDevMode` relaxation) — mismatched content accepted with 200 in dev/test | P1 (validation integrity) | Check enforced unconditionally; the relaxation removed | `upload-validation.test.ts` 12/12 (failed before fix: declared-PDF/PNG-bytes → 200) |
| No working storage provider for self-hosted single-box deployments (Dockerfile/Caddyfile) — only supabase/s3/r2 | P2 (deployment gap) | `STORAGE_PROVIDER=local` (`LocalDiskStorageAdapter`): private-by-default, HMAC capability URLs, traversal-safe keys under `STORAGE_LOCAL_DIR` | Used by CI journey (upload → process → Ready); code review of adapter |
| Retention wording differed between customer UI, API and docs | P1 | Single policy source: `docs/security/FILE_RETENTION_POLICY.md`; privacy page table matches implementation | Reviewed in Phase 3 (`docs/fixes/BUG-LIST.md` P2-4 note) |

## Verified safe (this pass)

- **EXIF/GPS metadata:** customer images are decoded and **re-encoded** via
  `sharp` (`.rotate().flatten().resize().png()`, no `.withMetadata()`) before
  storage — EXIF/GPS is not carried into the stored object, which is then
  embedded into a freshly generated PDF (`src/lib/pipeline/normalize.ts:123-140`,
  covered by pipeline tests).
- **Production guardrails:** `src/lib/container.ts` fail-fasts when
  `NODE_ENV=production` and `STORAGE_PROVIDER`/`CACHE_PROVIDER`/`DATABASE_PROVIDER`
  is `memory` — a production build cannot silently run without persistence.
  (CI therefore uses a real ephemeral Postgres, not an in-memory fake.)
- **Secrets:** no secrets in source/logs/commits; CI uses disposable test
  secrets explicitly marked `ci-secret-not-for-production`.

## Unresolved risks / owner decisions

1. **Migration chain cannot be replayed on a fresh database** —
   `20251124000001_mobile_executor_queue_v2` references a table created by a
   later migration (evidence: `docs/fixes/evidence/migrate-deploy-failure.log`).
   CI uses `prisma db push` (schema sync) instead. Renaming the migration file
   desyncs any environment that already applied it → owner decision
   (maintenance-window rename, or environment rebuild).
2. **QA shops visible on production** (`QA Shop 1795101109` etc.) live in the
   production datastore — deleting them is an owner action, not a code change.
3. **Payment provider webhooks** (PhonePe/Paytm signature validation, replay
   protection): no sandbox credentials in this environment — the manual-UTR
   path is fully implemented and protected; provider-automatic verification
   remains **blocked** until credentials exist.
4. **WebKit/iOS-specific behaviors** — sandbox has no WebKit system libraries;
   Android emulation used. Real-device checklist in `docs/fixes/BUG-LIST.md`.
