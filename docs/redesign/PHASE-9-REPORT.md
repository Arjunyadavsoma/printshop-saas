# Phase 9 Report — Security and Reliability

**Date:** 2026-11-22
**Branch:** phase-7-verify-and-harden

---

## Security verification table

| Item | Status | Evidence | Fix |
|------|--------|----------|-----|
| Order token: 128+ bits entropy | ✅ Verified | `crypto.randomUUID() × 2` = 256 bits (64 hex chars). Test: `tests/security/security.test.ts` | — |
| No token enumeration | ✅ Verified | `/api/v1/o/[token]` returns same 404 for unknown + expired. Code: `src/app/api/v1/o/[token]/route.ts` | — |
| Rate limit per IP | ✅ Verified | `withRateLimit('order-track', 240, 60)` — 240 req/min per IP | — |
| IDOR: cross-tenant isolation | ✅ Verified | Order endpoints use `withOrderAccess` (validates token → order → shop). File endpoints validate `orderToken` per file. No cross-shop access possible. | — |
| Upload: magic-byte validation | ✅ Verified | `src/lib/pipeline/upload-sessions.ts` checks magic bytes before write. Complete endpoint validates against declared MIME. | — |
| Upload: size limit | ✅ Verified | 50 MB max in `uploads/init` route | — |
| Upload: filename sanitization | ✅ Verified | Storage uses generated UUID `storageKey`, not customer filename. Filename is display-only. | — |
| Upload: reject encrypted PDFs | ✅ Verified | Pipeline detects encrypted PDFs + returns `PASSWORD_PROTECTED` error | — |
| Upload: EXIF stripping | ⚠️ Not verified | Images are stored as uploaded. EXIF location data is NOT stripped. **Fix needed:** add EXIF stripping in the pipeline for image uploads. | Listed as fix |
| Payment: UTR validation | ✅ Verified | 12-digit numeric. Client strips non-digits. Server Zod validates. | — |
| Payment: duplicate UTR detection | ⚠️ Partial | UTR is stored per order but cross-order duplicate detection within a shop is NOT enforced server-side. **Fix needed:** add unique constraint or check. | Listed as fix |
| Payment: amount mismatch | ⚠️ Not verified | The UPI link has the correct amount, but if a customer pays a different amount, there's no server-side check. This is a manual verification by the shopkeeper. | Listed as manual |
| No "paid" claim before shop confirms | ✅ Verified | `POST /payment` records UTR but does NOT change order status. Shopkeeper must manually verify. | — |
| Analytics: no PII | ✅ Verified | `track()` only accepts: shop_slug, page_count, preset_name, amount_paise_range, file_count, app_name. No phone/UTR/filename/email. Test: `tests/security/security.test.ts` | — |
| Error boundaries | ✅ Verified | `error.tsx` on `/s/`, `/o/`, root. Show generic message + requestId (no stack trace in production). | — |
| Headers (CSP, HSTS, etc.) | ✅ Verified | `src/middleware.ts` sets CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS. | — |
| Retention job | ✅ Verified | `POST /api/v1/cron/cleanup` — deletes files per shop policy. `POST /api/v1/cron/cleanup-uploads` — deletes partial uploads >1h. | — |
| Sensitive-document deletion | ✅ Verified | Sensitive-document files flagged for immediate deletion after printing (in the retention job logic) | — |

## Fixes needed (not yet applied)

1. **EXIF stripping for image uploads** — images are stored with EXIF data intact. Add an EXIF-stripping step in the pipeline (`src/lib/pipeline/`) for JPEG/PNG uploads. Use `sharp` or a lightweight EXIF stripper.

2. **Duplicate UTR detection** — add a check in `POST /api/v1/o/[token]/payment` that rejects a UTR if it's already been submitted for another order in the same shop. This prevents a customer from reusing a UTR across orders.

3. **Gitleaks in CI** — add a gitleaks scan step to `.github/workflows/ci.yml` so secrets are scanned on every push.

4. **Dependabot config** — create `.github/dependabot.yml` to get automated dependency vulnerability alerts.

## Repo hygiene recommendations (docs only)

- Branch protection: require CI to pass before merge to `main`. No direct pushes to `main`.
- Code review: require at least 1 approval.
- Gitleaks in CI: add a step that runs `gitleaks detect` on every PR.
- Dependabot: enable for npm + GitHub Actions.
