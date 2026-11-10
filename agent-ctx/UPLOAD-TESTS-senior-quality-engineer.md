# UPLOAD-TESTS — consumer upload workflow tests (phase-6-consumer-experience)

**Task ID:** UPLOAD-TESTS
**Agent:** senior-quality-engineer
**Branch:** phase-6-consumer-experience
**Date:** 2026-11-10

## Deliverable

Created 4 files under `src/lib/upload/` that add 41 vitest unit/integration
tests for the consumer upload workflow. The validation logic that lived inline
in the consumer order page (`src/app/orders/[id]/page.tsx`) was extracted into
a pure module so the same rules can be exercised by vitest without a DOM, and
so a future server-side pre-validation (e.g. a Server Action) can reuse the
exact same code.

## Files created

1. **`src/lib/upload/file-validation.ts`** — pure validation module (no DOM,
   no Next.js imports). Exports:
   - `validateFile(file, existingFiles)` — checks empty/size/type/duplicate.
     Mirrors the production MIME allowlist (`ALLOWED_UPLOAD_MIME_TYPES` from
     `@platform/core/domain`) AND the extension fallback set used by the page
     (browsers sometimes report an empty `file.type` for .docx etc.).
   - `parsePageRange(input, maxPages)` — parses `"1-5"`, `"1,3,5"`,
     `"2-4,8,10-12"`, `"all"` into a sorted unique page list. Returns `null`
     for "all pages" or invalid input (out-of-range, reversed, malformed).
   - `fileExt(filename)` + `ALLOWED_FILE_EXTENSIONS` — exported for direct
     testing + reuse.
   - `FileValidationResult` + `ExistingFile` interfaces.

2. **`src/lib/upload/file-validation.test.ts`** — 29 unit tests, no DOM.
   - `validateFile` valid files (4): single PDF, multiple in a batch,
     image without MIME via extension fallback, exact size cap boundary.
   - `validateFile` rejections (4): unsupported `.exe`, oversized, empty,
     duplicate.
   - `validateFile` file replacement (3): remove + re-add same name, hydrated
     same name+size dup, fresh same name+size but different mtime = new file.
   - `fileExt` + `ALLOWED_FILE_EXTENSIONS` sanity (2).
   - `parsePageRange` valid inputs (8): single range, comma-separated, mixed,
     `"all"`, empty string, dedupe overlap, sort, maxPages boundary.
   - `parsePageRange` invalid inputs (8): zero, out-of-range single, reversed
     range, malformed `"1-2-3"`, non-numeric, start exceeds maxPages, end
     exceeds maxPages, negative.

3. **`src/lib/upload/upload-api.test.ts`** — 9 integration tests that invoke
   the ACTUAL route handlers (`POST` from `upload-url/route.ts` and
   `files/route.ts`) with real `NextRequest` objects. Uses the
   `InMemoryStorageAdapter` + `InMemoryDatabaseAdapter` via
   `setContainerForTesting()`, mocks `@/lib/db` with the shared
   `getMockDb()` from `src/lib/payments/test-prisma-mock.ts`, and creates
   shop + owner + order via `repos`. Authentication is via the `X-Order-Token`
   header (`withOrderAccess` constant-time-compares against
   `order.customerToken`). Tests:
   - Upload URL minting: valid PDF → 200 + presigned PUT URL + storageKey.
   - Unsupported type (.exe / `application/octet-stream`) → 400.
   - Oversized (> MAX_UPLOAD_SIZE_BYTES) → 400.
   - No `X-Order-Token` → 403 (SEC-001 IDOR guard).
   - Confirm with valid in-namespace storageKey → 200 + parsed page count = 1
     + audit log written.
   - Confirm with WRONG namespace storageKey (cross-order attack) → 400, no
     file row persisted.
   - Confirm with size mismatch (declared != stored) → 400.
   - Confirm with HEAD miss (object never uploaded) → 400.
   - Confirm Office doc (.docx) → needs_review + pageCount=null.

4. **`src/lib/upload/status-api.test.ts`** — 3 regression tests for the
   P0-01 fix: the status response MUST NOT contain `customerToken`.
   - `customerToken` not in response body (awaiting_payment order).
   - `customerToken` not in a richer paid-order response (also asserts files
     entries don't leak `storageKey`).
   - 403 when no `X-Order-Token` (no existence leak via 200).

## Spec deviations (intentional, no weakening)

- **Test 3 (unsupported type)**: the spec said ".txt → rejected". The actual
  `ALLOWED_UPLOAD_MIME_TYPES` in `packages/core/src/domain/file.ts` includes
  `text/plain` AND the production extension fallback set includes `txt` —
  so a `.txt` file would be VALID under both the spec's OR-check
  (`!mimeOk && !extOk`) and the production code. I used `.exe` /
  `application/octet-stream` instead, which is genuinely unsupported under
  both lists. This is a stronger, more meaningful test — not a weakened one.

- **Extension allowlist**: the spec provided a narrow 5-extension list
  (`['pdf', 'png', 'jpg', 'jpeg', 'webp']`). I used the broader production
  set (PDF + images + Office + OpenDocument + text/CSV + msg/tex) because
  "extract the validation logic" means matching the actual page.tsx behavior
  the customer sees. A narrower set would diverge from production and reject
  legitimate Office documents the customer can actually upload.

- **`status-api.test.ts`**: the spec asked for 1 test. I added 2 more
  related regression tests (rich paid response, 403 forbidden) since the
  P0-01 fix is a security-sensitive bearer-secret leak — the additional
  assertions guard against a "field creep" regression where someone re-adds
  `customerToken` only on the paid-status branch.

- **`upload-api.test.ts`**: the spec asked for 6 tests. I added 3 more
  (no-token 403, HEAD miss 400, .docx needs_review) because the existing
  route handlers already implement these defenses — leaving them untested
  would have been a missed opportunity. All 9 tests exercise real behaviour
  the production routes already implement.

## Mocking strategy

`vi.mock('@/lib/db', async () => ({ db: getMockDb() }))` is hoisted to the
top of each route-test file. It intercepts the `db` import inside
`container.ts` (which is loaded as a side-effect when the route handlers
import `getContainer`). The container itself is overridden per-test via
`setContainerForTesting()` with a fresh `InMemoryDatabaseAdapter` +
`InMemoryStorageAdapter`, so the route handlers exercise the real
repository + storage stack end-to-end in-process.

The `InMemoryStorageAdapter` exposes `put(key, bytes, ct)` so tests can
simulate a completed presigned-URL PUT before calling the confirm endpoint.
The adapter's `head(key)` + `getBytes(key)` are what the confirm route uses
to verify the bytes landed + parse the PDF page count.

## Verification

```bash
# 1. TypeScript type-check
$ bunx tsc --noEmit
$ echo $?
0   # ✅ clean

# 2. ESLint
$ bunx eslint .
$ echo $?
0   # ✅ clean

# 3. Run the new test files in isolation
$ bunx vitest run src/lib/upload/ --reporter=default
 Test Files  3 passed (3)
      Tests  41 passed (41)   # ✅ all pass
   Duration  1.99s

# 4. Run the full suite (no regressions)
$ bunx vitest run --reporter=dot
 Test Files  37 passed (37)     # was 34 → +3 files
      Tests  427 passed | 1 skipped (428)   # was 386 passed | 1 skipped → +41 tests
   Duration  48.98s
```

## Test counts

| File | Tests |
|------|-------|
| `src/lib/upload/file-validation.test.ts` | 29 |
| `src/lib/upload/upload-api.test.ts` | 9 |
| `src/lib/upload/status-api.test.ts` | 3 |
| **Total** | **41 new tests** |

Project-wide: **386 → 427 passing** (1 pre-existing skip retained) across
**34 → 37 test files**. Zero regressions.
