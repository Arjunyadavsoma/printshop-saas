# UX-DOCS — UX documentation author

## Task
Created 5 documentation files in `docs/ux/` based on a thorough audit
of the consumer-facing code in the printshop-saas project (branch
`phase-6-consumer-experience`).

## Files read before writing
- `src/app/page.tsx` (448 lines) — home page
- `src/app/shops/[slug]/page.tsx` (399 lines) — shop detail
- `src/app/orders/[id]/page.tsx` (1569 lines, read in 4 chunks) — order wizard
- `src/components/portal/pdf-preview.tsx` (395 lines) — PDF preview
- `src/components/portal/use-api-client.ts` (7 lines) — re-export shim
- `src/components/portal/auth-context.tsx` (234 lines) — real auth impl
- `src/app/api/v1/orders/[id]/files/upload-url/route.ts` (60 lines)
- `src/app/api/v1/orders/[id]/files/route.ts` (103 lines)
- `src/app/api/v1/orders/[id]/files/[fileId]/route.ts` (88 lines) — PATCH
- `src/app/api/v1/orders/[id]/checkout/route.ts` (152 lines)
- `src/app/api/v1/orders/[id]/status/route.ts` (58 lines)
- `src/lib/api/with-order-access.ts` (98 lines) — IDOR guard
- `packages/core/src/domain/enums.ts` (95 lines)
- `packages/core/src/domain/file.ts` (104 lines) — MIME allowlist + size cap
- `packages/core/src/pricing/pricing-engine.ts` (83 lines)
- `packages/core/src/pricing/breakdown.ts` (47 lines)
- `packages/utils/src/validation.ts` (49 lines)
- `src/lib/services/parse-page-count.ts` (25 lines)
- `src/app/globals.css` (183 lines) — design tokens
- `tailwind.config.ts` (65 lines) — legacy v3, dead
- `docs/DESIGN_SYSTEM.md` (sampled 320 of 464 lines) — for alignment
- `docs/UX_AUDIT.md` (40 lines) — prior audit baseline
- `tests/smoke.spec.ts` (76 lines) — the only Playwright spec
- `playwright.config.ts` (40 lines)
- `src/lib/upload-lifecycle.test.ts` (60 lines sampled)

## Files created
1. `docs/ux/CONSUMER_UX_RESEARCH.md` — 10-section research brief of
   proven UI patterns for consumer document-upload workflows, each
   with user problem / proposed interaction / why reliable /
   accessibility / implementation implications. References WCAG 2.2,
   GOV.UK Design System, Material 3, NN/g, Lucide.
2. `docs/ux/CONSUMER_UX_AUDIT.md` — 17-section audit of the actual
   repository. Maps every consumer route, component, API endpoint,
   data model. 40 findings classified P0 (7), P1 (17), P2 (16) with
   exact file paths and line numbers. Includes a summary table.
3. `docs/ux/DESIGN_SYSTEM.md` — 18-section consumer-specific design
   system reference. Tokens, typography, spacing, radii, colours,
   buttons, focus states, form fields, cards, dialogs, badges,
   toasts, loading states, breakpoints, icon conventions, restraint
   rules, component checklist.
4. `docs/ux/CONSUMER_UPLOAD_FLOW.md` — End-to-end journey doc.
   Step 0 (order creation) through Step 5 (track). Each step's UI
   layout, action, server-side behaviour, validation, and pipeline.
   Cross-step invariants and known-limitations cross-reference.
5. `docs/ux/CONSUMER_TEST_REPORT.md` — Testing approach doc. 13
   sections covering unit / integration / E2E coverage, per-area test
   matrices (upload, preview, page selection, config, pricing,
   checkout, tracking, mobile, a11y), known limitations, recommended
   additions, test commands. Honest about gaps — does not claim
   features work unless verified.

## Key honest findings flagged across the docs
- `pageRange` is stored but never affects the price (revenue bug,
  audit P1-15).
- PDF preview thumbnails are `<div onClick>` — WCAG 2.2 SC 4.1.2
  failure (audit P0-04).
- No upload cancellation (XHR not abortable) (audit P0-03).
- No client-side MIME/size validation before presign (audit P0-02).
- `customerToken` returned in `/status` response body (audit P0-01).
- No idempotency on checkout (audit P0-07).
- Consumer-flow E2E coverage is smoke-only (test report §1).
