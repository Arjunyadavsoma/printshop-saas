# Consumer Test Report — PrintShop SaaS

> The testing approach for the consumer-facing journey (home → shop
> discovery → shop detail → order wizard → tracking). This doc covers
> what is tested, what is not tested, and the known limitations.
>
> **Honesty note:** this codebase has strong backend / API / pricing /
> payment test coverage but **thin consumer-flow E2E coverage**. The
> Playwright smoke test verifies the homepage renders and has no
> horizontal overflow at 375px — it does not exercise the upload →
> configure → checkout → pay → track flow. The gaps are documented
> below; do not claim a flow works unless a test proves it.

---

## 1. Test coverage overview

| Layer | Tool | Config | Coverage |
|---|---|---|---|
| Unit | Vitest | `vitest.config.ts` | Strong for pricing, repositories, payments, auth, storage adapters |
| Integration | Vitest + InMemory adapters | `vitest.config.ts` | Strong for upload lifecycle, checkout ordering, fail-closed payment, cross-tenant |
| E2E | Playwright 1.65 + Chromium 158 | `playwright.config.ts` | Smoke only (homepage renders, no horizontal overflow) |
| Concurrency harness | Custom scripts | `scripts/*-harness.test.ts` | Backend print-job concurrency, not consumer UX |

**Test directories.**
- `src/lib/**/*.test.ts` — 24 unit/integration test files.
- `packages/core/src/pricing/pricing-engine.test.ts` — pricing unit tests.
- `packages/adapters/src/storage/*.test.ts` — storage adapter tests.
- `tests/smoke.spec.ts` — the only Playwright spec (76 lines).

There is **no** `tests/consumer-flow.spec.ts`, no `tests/upload.spec.ts`,
no `tests/checkout.spec.ts`. The customer journey is not covered by
automated E2E.

---

## 2. Upload tests

### 2.1 Storage-layer upload lifecycle
**File:** `src/lib/upload-lifecycle.test.ts` (236 lines).
**Scope:** the InMemoryStorageAdapter's presign → PUT → HEAD → getBytes
flow, which is the storage substrate the upload-url and confirm APIs
depend on.

| Test | What it verifies |
|---|---|
| presigned upload URL is a relative `/api/v1/storage/put` path | URL shape in dev mode |
| PUT stores bytes + HEAD finds them + getBytes retrieves them | The full storage round-trip |
| HEAD on a missing key returns null | The confirm API's "file not found" path |
| getBytes on a missing key returns null | The page-count parser's "no bytes" path |
| size mismatch is detectable | The confirm API's size check |

**What is NOT tested here:** the HTTP route handlers in
`upload-url/route.ts` and `files/route.ts`. The MIME allowlist, the
size cap, the order-status check, the `storageKey` namespace check,
and the `parsePageCount` integration are not exercised end-to-end.

### 2.2 Route-level tests
**Files:** `src/lib/api/api-routes.test.ts`, `http-route-tests.test.ts`,
`payment-route-tests.test.ts`, `checkout-ordering-tests.test.ts`,
`cross-tenant-tests.test.ts`.
**Scope:** route-level concerns — auth, rate-limiting, IDOR, checkout
ordering, cross-tenant isolation.

| Test file | What it verifies |
|---|---|
| `api-routes.test.ts` | Route registration, envelope shape |
| `http-route-tests.test.ts` | HTTP method handling, status codes |
| `payment-route-tests.test.ts` | Payment route auth, webhook handling |
| `checkout-ordering-tests.test.ts` | PaymentAttempt is persisted BEFORE provider contact (4 tests) |
| `cross-tenant-tests.test.ts` | Cross-shop, cross-order isolation |

### 2.3 What the upload tests cover (mapped to scenarios)

| Scenario | Covered? | Where |
|---|---|---|
| Single PDF upload | Partial | storage lifecycle only; not the HTTP route |
| Multiple file upload | No | — |
| Invalid MIME type | No | — |
| Oversized file (>25MB) | No | — |
| Corrupt PDF (page count parse fails) | Partial | `parse-page-count.ts` returns null on parse failure; the `needs_review` path is not asserted in a test |
| Duplicate file (same name + size) | No | — |
| Replace file | No | — |
| Cancel upload (XHR abort) | No | — |
| Retry failed upload | No | — |
| Upload progress (XHR onprogress) | No | — |
| `needs_review` status on Office upload | No | — |
| `storageKey` namespace attack | Partial | `cross-tenant-tests.test.ts` covers cross-order; the specific `storageKey.startsWith(expectedPrefix)` check is not directly asserted |
| Order in non-awaiting-payment state rejects upload | No | — |

**Verdict:** the storage layer is solid; the upload **HTTP route
behaviour is not tested**. A regression in `upload-url/route.ts` (e.g.,
removing the MIME check) would not be caught.

---

## 3. Preview tests (PDF, image, unsupported)

**Coverage: none.** `src/components/portal/pdf-preview.tsx` has no
test file. There is no unit test for the PDF.js rendering pipeline, no
test for the image preview path, no test for the unsupported-file
placeholder, no test for the pagination logic, no test for the
select-all/deselect-all behaviour, no test for the
`onSelectionChange` callback.

**What should be tested but is not:**
| Scenario | Why it matters |
|---|---|
| PDF renders N thumbnails | Regression on PDF.js worker setup |
| Page selection toggles a page | Core pricing input |
| Select all / Deselect all | Bulk operations |
| Pagination advances through >5 pages | Multi-view navigation |
| Image preview shows single thumbnail | Image upload path |
| Unsupported file shows placeholder | Office upload path |
| Render failure shows error state | `pdfjs.getDocument` rejection |
| `fileUrl` fallback when `rawFile` is null | Post-refresh preview (audit P1-09) |

**Verdict:** the preview component is a black box from a test
perspective. Any change to it is unverified.

---

## 4. Page selection tests (ranges, validation)

**Coverage: none.** There is no test for:
- The client-side range-compression logic in `updateFile`
  (`orders/[id]/page.tsx` lines 488–503): `[1,2,3,5,6]` → `"1-3,5-6"`.
- The server-side handling of `pageRange` strings
  (`file/[fileId]/route.ts` line 13 — accepts any string ≤100 chars).
- The fact that `pageRange` does not affect the price (audit P1-15).

**What should be tested:**
| Scenario | Expected behaviour | Actual behaviour |
|---|---|---|
| Select pages [1,2,3,5,6] | PATCH body `pageRange: "1-3,5-6"` | Correct (lines 488–503) |
| Deselect all pages | PATCH body `pageRange: null` | Correct (line 491) |
| Type "1-5, 8, 12-14" in the page-range input | Server parses and prices for 7 pages | **Server does not parse — prices for full pageCount** (audit P1-15) |
| Page range "0" or "-1" or "abc" | Server rejects with 400 | Server accepts any string ≤100 chars |
| Page range "999" on a 5-page PDF | Server rejects (out of range) | Server accepts |

**Verdict:** page selection has a critical correctness gap (the price
does not reflect the selected pages) and no test would catch it
because no test exercises the path.

---

## 5. Print configuration tests

**Coverage: none for the UI.** The pricing engine is well tested (see
§6), but the `ConfigureStep` and `FileCard` components have no tests.

**What should be tested:**
| Scenario | Expected behaviour |
|---|---|
| Change copies 1 → 5 | PATCH `copies: 5`, price recomputed server-side |
| Change colour B&W → Colour | PATCH `colorMode: 'color'`, base rate switches to `color_a4_per_page` |
| Change paper A4 → A3 | PATCH `paperSize: 'a3'`, base rate switches to `bw_a3_per_page` |
| Toggle duplex on | PATCH `duplex: true`, duplex discount applied |
| Copies = 0 | Clamped to 1 client-side |
| Copies = 501 | Clamped to 500 client-side |
| Copies = 499.5 | Server rejects (Zod `int()`) — **current bug** (audit P1-14) |
| `needs_review` file: settings disabled | Inputs `disabled={isReview}`, PATCH deferred |

---

## 6. Price consistency tests

**File:** `packages/core/src/pricing/pricing-engine.test.ts`.
**Scope:** the `priceFile` function and the `computeBreakdown`
breakdown.

| Test group | What it verifies |
|---|---|
| `roundHalfUpPaise` | 0.5 → 1, 0.4 → 0, 10.5 → 11 (not banker), throws on negative/NaN |
| `resolveBaseRate` fallback | Direct rate when configured; letter → a4 fallback when letter rate is 0; legal → a3 fallback |
| `priceFile` base cases | Single B&W A4 page = per-page rate; single colour A4; copies multiply; pages × copies |
| Duplex discount | Applied off gross; skipped when duplex=false; skipped when `duplex_discount=0`; rounded half-up |
| Bulk discount | Applied when `totalPages ≥ bulk_threshold`; applied to post-duplex subtotal; skipped when `bulk_discount_pct=0` |
| Min order | Rounded up when subtotal < min (default behaviour); `PricingBelowMinimumError` thrown when `behaviour.onBelowMin = 'reject'` |
| Line items | Base print, duplex (negative), bulk (negative), min adjustment (positive) all present in correct order |

**What is NOT tested:**
| Scenario | Why it matters |
|---|---|
| `pageRange` reduces the priced page count | **Critical gap** (audit P1-15) — the engine never sees a reduced page count |
| Order total = sum of file prices | The `file/[fileId]/route.ts` recompute logic (lines 67–69) |
| Currency formatting (`formatINRFromPaise`) | The `@platform/utils/currency.ts` function — assumed correct, not asserted |
| Min-order rounding when subtotal = exactly min | Edge case |

**Verdict:** the pricing engine is well tested in isolation. The
**integration** between `pageRange`, `parsePageCount`, and `priceFile`
is untested and broken (audit P1-15).

---

## 7. Checkout tests

**File:** `src/lib/api/checkout-ordering-tests.test.ts`.
**Scope:** the FIND-PAY-001-ORDER fix — PaymentAttempt is persisted
BEFORE the provider is contacted.

| Test | What it verifies |
|---|---|
| paymentAttempt.create is called BEFORE adapter.createPaymentIntent | Ordering invariant |
| provider is NOT contacted when paymentAttempt.create fails | Fail-closed behaviour |
| checkout succeeds when persistence + provider both succeed | Control test |
| pre-generated merchantOrderId is passed to the adapter | The adapter uses our reference, not its own |

**What is NOT tested:**
| Scenario | Why it matters |
|---|---|
| Duplicate-submit protection (idempotency) | **Critical gap** (audit P0-07) — two clicks could create two PaymentAttempts |
| Checkout with zero files | Server returns 400 (line 46); not asserted |
| Checkout with unpriced files | Server returns 400 (line 49); not asserted |
| Checkout on non-awaiting_payment order | Server returns 400 (line 37); not asserted |
| UPI deep-link fallback when adapter returns no upiUri | The fallback URL construction (lines 103–114) |
| `expiresAt` is 10 minutes in the future | The payment window |

**Verdict:** the ordering invariant is well tested. The error paths
and the duplicate-submit protection are not.

---

## 8. Order tracking tests

**Coverage: none for the UI.** The polling logic, the status-label
mapping, the payment-vs-order-status separation, and the receipt
download are untested.

**What should be tested:**
| Scenario | Expected behaviour |
|---|---|
| Polling starts on entering track step | `setInterval` 30s |
| Polling stops on terminal status | `clearInterval` when status ∈ {collected, cancelled, refunded} |
| Polling stops on unmount | `clearInterval` in the effect cleanup |
| Payment status indicator shows pending when `paidAt === null` | Amber clock |
| Payment status indicator shows confirmed when `paidAt !== null` | Green check + time + UTR |
| Order status indicator maps each status correctly | 7 statuses → correct label + colour |
| Receipt download triggers a Blob download | `GET /receipt` with `X-Order-Token`, blob → object URL → click |
| Manual refresh button calls `loadOrder({ silent: true })` | No loading skeleton flash |

**Partial coverage:** `src/app/api/v1/orders/[id]/status/route.ts` is
exercised indirectly by `cross-tenant-tests.test.ts` (verifies that a
wrong token returns 403) but the response shape is not asserted.

---

## 9. Mobile responsive tests

**File:** `tests/smoke.spec.ts` (76 lines, the only Playwright spec).
**Scope:** homepage renders, no horizontal overflow at 375px.

| Test | What it verifies |
|---|---|
| chromium launches, navigates, captures title + screenshot | Playwright toolchain works |
| customer homepage renders hero + shop list | H1 count ≥ 1 |
| no horizontal overflow at 375px | `scrollWidth ≤ clientWidth + 1` |

**Playwright projects** (`playwright.config.ts` lines 29–38):
- `chromium` (Desktop Chrome)
- `mobile-chrome` (Pixel 5 viewport)

**What is NOT tested:**
| Scenario | Why it matters |
|---|---|
| Shop detail page at 375px | Layout may overflow (audit P1-21 — PDF grid) |
| Order wizard at 375px | The 5-step flow's mobile layout |
| Upload dropzone tap target | WCAG 2.2 SC 2.5.8 (44px) |
| PDF preview thumbnail grid at 375px | 5-col fixed grid is ~60px per thumbnail (audit P1-21) |
| Checkout table horizontal scroll | `overflow-x-auto` works but is not asserted |
| PayStep two-option stack on mobile | Layout acceptance |
| Track-step token display fits 360px | Token is `text-2xl` on mobile; long tokens may overflow |

**Verdict:** mobile responsiveness is asserted only for the homepage.
The rest of the consumer journey is visually unverified.

---

## 10. Accessibility tests

**Coverage: none automated.** There is no axe-core integration, no
Playwright accessibility scan, no keyboard-only E2E test.

**Known WCAG 2.2 failures** (from the audit):
| SC | Level | Failure | Audit ID |
|---|---|---|---|
| 4.1.2 Name, Role, Value | A | PDF preview thumbnails are `<div onClick>` with no role/aria | P0-04 |
| 2.5.7 Dragging Movements | AA | Acceptable — browse button is the keyboard path | — |
| 2.5.8 Target Size (Minimum) | AA | PDF preview pagination dots are 32px (below 44px) | P2-05 |
| 1.4.4 Resize Text | AA | `text-[10px]` and `text-[11px]` below the 12px floor in places | — |
| 2.4.7 Focus Visible | AA | Native `<select>` in ConfigureStep has no focus ring | P1-12 |
| 4.1.3 Status Messages | AA | Order-status transitions have no `aria-live` | P1-19 |

**What should be tested:**
| Scenario | Tool |
|---|---|
| Keyboard-only upload flow | Playwright keyboard + axe-core |
| Screen-reader announcement of status changes | Manual + axe-core `aria-live` check |
| Colour contrast on brand + status tokens | axe-core |
| Focus order through the wizard | Playwright `page.keyboard.tab()` |
| Reduced-motion media query respected | Manual (toggle in devtools) |

**Verdict:** accessibility is verified by code review only. Automated
a11y scanning is a documented gap.

---

## 11. Known limitations

### 11.1 Test infrastructure
- **No CI matrix for mobile E2E.** The Playwright config has a
  `mobile-chrome` project but no consumer-flow spec to run on it.
- **No visual regression testing.** No Percy, Chromatic, or Playwright
  screenshot diffing.
- **No axe-core integration.** a11y is manual.
- **The dev server must be running** for Playwright (`smoke.spec.ts`
  line 20 falls back to the production URL if localhost:3000 is down).

### 11.2 Coverage gaps (consumer flow)
- No E2E test walks the full upload → configure → checkout → pay →
  track path.
- No test asserts the `pageRange` → price integration (audit P1-15).
- No test asserts duplicate-submit protection on checkout (audit
  P0-07).
- No test asserts the upload cancel / retry UI (it does not exist
  yet — audit P0-03, P1-05).
- No test asserts the PDF preview's keyboard accessibility (it is
  currently broken — audit P0-04).
- No test asserts the `expiresAt` countdown (it is not shown — audit
  P1-17).

### 11.3 Flakiness risks
- The 30-second track-step polling interval means any E2E test that
  waits for a status transition will be slow.
- The PDF.js Worker setup depends on `import.meta.url` resolving
  correctly under Vitest's jsdom environment — the preview component
  is not currently imported by any test, so this is untested.
- The presigned URL in dev mode is a relative `/api/v1/storage/put`
  path (InMemoryStorageAdapter); in production it is a cross-origin
  URL. Tests that exercise the upload pipeline only cover the dev
  path.

### 11.4 Manual test plan (recommended before each release)
1. **Upload flow:** on a real mobile device (not just devtools
   emulation), upload a 5-page PDF, a 1-page image, and a .docx.
   Verify the PDF shows 5 thumbnails, the image shows 1, the .docx
   shows "needs review".
2. **Page selection:** in the configure step, deselect 2 of 5 pages.
   Verify the PATCH body contains `pageRange: "1,3,4,5"` (or
   compressed). Note the price does **not** change — this is a known
   bug (audit P1-15), document it to the customer if needed.
3. **Checkout:** verify the line-items table shows the correct
   settings summary per file and the server-confirmed total matches
   the sum of file prices.
4. **Pay:** on mobile, tap "Pay with UPI" and verify the UPI app
   opens with the correct amount prefilled. On desktop, verify the QR
   renders.
5. **Track:** after the shopkeeper marks the order paid (or the dev
   simulator runs), verify the payment-status card flips to green and
   the order-status card shows "Printing now" → "Ready to collect".
6. **Receipt:** on a terminal order, tap "Download receipt" and
   verify a PDF downloads.
7. **Keyboard-only:** tab through the entire wizard without a pointer.
   Note the PDF preview thumbnails are not focusable (audit P0-04).
8. **Screen reader:** run VoiceOver / TalkBack through the wizard.
   Note that status transitions are not announced (audit P1-19).
9. **Reduced motion:** toggle `prefers-reduced-motion` in devtools and
   verify all spinners and transitions stop.
10. **Horizontal overflow:** at 360px width, scroll through every step
    and verify no horizontal scrollbar appears.

---

## 12. Recommended test additions (priority order)

| Priority | Test | Type | Why |
|---|---|---|---|
| P0 | `pageRange` reduces the priced page count | Unit + integration | Revenue bug (audit P1-15) |
| P0 | Duplicate-submit protection on checkout | Integration | Audit P0-07 |
| P0 | Upload-url rejects invalid MIME / oversized | Route integration | Audit P0-02 |
| P0 | PDF preview keyboard accessibility | E2E (Playwright keyboard) | Audit P0-04 |
| P1 | Full upload → configure → checkout → pay → track E2E | Playwright | Covers the whole consumer journey |
| P1 | `removeFile` calls a delete-file endpoint | Integration | Audit P1-06 (requires the endpoint to exist first) |
| P1 | Upload cancel aborts the XHR | Unit + E2E | Audit P0-03 |
| P1 | Upload retry re-runs the pipeline | E2E | Audit P1-05 |
| P1 | axe-core scan on every consumer page | E2E | Accessibility gap |
| P2 | Visual regression on consumer pages | Playwright screenshots | Layout regressions |
| P2 | Mobile-responsive E2E on shop detail + order wizard | Playwright (Pixel 5) | Audit P1-21 |
| P2 | `expiresAt` countdown and expiry handling | Unit + E2E | Audit P1-17 |

---

## 13. Test commands

```bash
# Unit + integration (Vitest)
bun run test              # or: bunx vitest run

# E2E smoke (Playwright) — requires the dev server on :3000
bunx playwright test tests/smoke.spec.ts

# Pricing-only unit tests
bunx vitest run packages/core/src/pricing/pricing-engine.test.ts

# Upload lifecycle tests
bunx vitest run src/lib/upload-lifecycle.test.ts

# Checkout ordering tests
bunx vitest run src/lib/api/checkout-ordering-tests.test.ts

# Lint (not a test, but the closest thing to a type/quality gate)
bun run lint
```

**Note:** `bun run build` is explicitly forbidden by the project rules
("Never use `bun run build`"). Type errors are caught by `bun run lint`
and by the dev server's hot reload, not by a production build.
