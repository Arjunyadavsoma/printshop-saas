# AUDIT-FINDINGS-FIXES-2 — Z.ai Code

## Task
Apply 9 audit-finding fixes (C6, H5, H6, H12, H13, H17, M8, M12, M16) to the
PrintShop SaaS project on branch `main`.

## Work performed
All 9 fixes implemented end-to-end. `bun run lint` + `bun run typecheck` both
pass cleanly. Vitest suites for the touched modules (auth, upload, payments,
parse-page-count, adapters, api-routes) all pass.

### Fix 1 — C6: Upload validation trusts client MIME; no magic-byte sniffing
- `src/app/api/v1/orders/[id]/files/route.ts` (the confirm endpoint)
  - Added `detectMagicFamily(bytes)` + `magicBytesMatchMime(bytes, mime)`
    helpers (exported). The detector recognises PDF (`%PDF`), ZIP/OOXML
    (`PK`), JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), GIF (`GIF8`), WebP
    (`RIFF…WEBP`), BMP (`BM`), and TIFF (`II*\0` or `MM\0*`).
  - After `storage.getBytes()`, BEFORE `parsePageCount()`, the bytes are
    sniffed. If the declared `mimeType` doesn't match the magic bytes,
    the request is rejected with a `ValidationError("File content does
    not match declared type…")`. OOXML formats (DOCX/PPTX/XLSX) all
    share the ZIP family, so any ZIP-family declaration is accepted for
    them. Unknown MIME types (legacy formats like DOC/PPT/XLS) bypass
    the check and fall through to `parsePageCount` (which already marks
    them `needs_review`).
- `src/lib/services/parse-page-count.ts`
  - Added `safeLoadZip(bytes)` helper: refuses any ZIP larger than 25 MB
    (defense-in-depth — already enforced at upload), then after
    `JSZip.loadAsync` counts entries + sums uncompressed sizes; if the
    entry count exceeds 1000 OR the total uncompressed size exceeds
    100 MB, returns `null` (treated as `needs_review`). All three
    OOXML parsers (`parseDocxPageCount`, `parsePptxPageCount`,
    `parseXlsxPageCount` — now removed, see Fix 5) were updated to use
    `safeLoadZip`.

### Fix 2 — H5: Hand-rolled JWT: non-constant-time verify, wrong base64, unguarded parsing
- `src/lib/auth/jwt-auth.adapter.ts`
  - **Signature comparison**: replaced `expected !== sigPart` with
    `safeEqualB64Url(expected, sigPart)`. The helper SHA-256-hashes
    both sides (fixed 32-byte digest → eliminates length leak) then
    uses `crypto.timingSafeEqual` on the digests.
  - **base64url encoding**: added `bytesToB64Url` / `b64UrlToBytes`
    helpers (replace `+`→`-`, `/`→`_`, strip `=` padding). The JWT
    header, payload, and signature now use base64url (RFC 7515/7519
    compliant) instead of standard base64. The PBKDF2 password-hash
    encoding is unchanged (kept on standard base64 for backward compat
    with existing stored hashes).
  - **try/catch around all parsing**: every `token.split('.')`,
    `b64UrlToBytes()`, `JSON.parse()`, `crypto.subtle.sign` call in
    the verify path is wrapped in try/catch. A malformed token returns
    `null` (treated as "unauthenticated") instead of throwing a 500
    INTERNAL_ERROR.
  - **iss + aud claims**: tokens now carry `iss: 'printshop-saas'` and
    `aud: 'printshop-saas'`. The verifier REQUIRES both to match —
    `aud` accepts string OR array-of-strings form per RFC 7519.
    Tokens without these claims (or with mismatched values) are
    rejected even if the HMAC signature is valid.
  - The `parseHash` helper for PBKDF2 hashes also got a try/catch so
    a malformed hash string fails closed instead of throwing.

### Fix 3 — H6: Pamphlet charges and split/cash payment methods collected but never honored
- The audit cited `src/app/shop/settings/page.tsx`, but the pamphlet +
  split-payment UI actually lives in `src/app/shop/register/page.tsx`
  (verified by grepping the settings page — no pamphlet or split
  controls there). Fixed the register page.
- `src/app/shop/register/page.tsx`
  - Removed the `'split'` option from the payment-methods grid (kept
    `'upi'`, `'cash'`, `'both'`). Layout changed from 4-col to 3-col.
  - Replaced the editable pamphlet form (Switch + name Input + price
    Input) with a "Coming soon" note in a dashed-border card. The
    placeholder defaults (`pamphletEnabled: false`, `pamphletPricePaise:
    1000`, `pamphletName: 'Pamphlet / Cover Sheet'`) stay in
    `DEFAULT_STATE` so the registration payload remains compatible
    with the backend zod schema — no API change required.
  - Removed the now-unused `Switch` import. `Input` / `Textarea` are
    still used elsewhere on the page.
- The DB columns (`pamphletEnabled`, `pamphletPricePaise`,
  `pamphletName`) and the zod schema in `src/app/api/v1/shops/me/route.ts`
  + `src/app/api/v1/auth/register/route.ts` are kept intact for backward
  compat with existing shops.

### Fix 4 — H12: Supabase head() is a substring list-scan
- `packages/adapters/src/storage/supabase.adapter.ts`
  - Added `supabaseUrl` + `serviceRoleKey` private fields on the class
    (populated from the existing constructor config). URL trailing
    slashes stripped.
  - Rewrote `head()` to issue a direct `HEAD ${SUPABASE_URL}/storage/v1/object/${bucket}/${key}`
    with `Authorization: Bearer ${serviceRoleKey}`. Each path segment
    is percent-encoded individually so `/` separators survive.
  - 404 → returns `null`. 2xx → reads `Content-Length` +
    `Content-Type` from response headers. Other non-2xx → throws (same
    behaviour as the previous non-404 path). The catch block still
    pattern-matches `not found|does not exist|404` for safety.
  - Eliminates the O(folder-size) list scan with its 1000-entry cap
    and substring-`search` false-positive filtering.

### Fix 5 — H13: Page-count extraction wrong for common formats
- `src/lib/services/parse-page-count.ts`
  - **XLSX**: removed `parseXlsxPageCount`. The dispatcher now returns
    `null` for `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
    with an explanatory comment — worksheet count does NOT equal
    printed page count. Treated as `needs_review`.
  - **TIFF**: added `countTiffFrames(bytes)` — walks the IFD chain
    (header byte-order detection → first IFD offset → entry count →
    next-IFD offset) and counts frames. Safety cap of 10000 + a
    `seen` Set prevent infinite loops on circular chains. Returns
    `null` if the bytes don't look like a TIFF (caller falls through
    to `needs_review`), or the frame count (≥1).
  - **DOCX**: added a code comment documenting that the count from
    `app.xml <Pages>` is a metadata estimate (set by the word
    processor that last saved the document), not a rendered page
    count — fonts/margins/printer settings can shift the actual
    count. Behaviour unchanged.

### Fix 6 — H17: Demo accounts with shared weak password in source
- `src/lib/services/seed.service.ts`
  - The return type's `admin` field changed from `{ email; password }`
    to `{ email }`. The response no longer includes the demo password.
  - Added a doc comment that demo accounts should only exist in dev
    mode (the `/api/v1/dev/seed` route is gated by `requireDev()`,
    which throws 404 in production).
- `src/app/shop/login/page.tsx`
  - `fillDemo()` no longer sets `setPassword('demo1234')`. It only
    sets the email; the password field is cleared. The user must
    type the demo password manually (documented in README + the
    "Demo accounts" panel).
  - The panel's description text changed from "Click any account to
    autofill the form (password: demo1234)." to "Click any account
    to autofill the email. The shared demo password is documented in
    the project README."

### Fix 7 — M8: Error envelope leaks raw error messages in 500s
- `src/lib/api/envelope.ts`
  - In `toAppError()`, after the existing `AppError` + `ZodError`
    fast-paths, for plain `Error` instances:
      - Production (`NODE_ENV === 'production'`): return a generic
        `AppError("Internal server error", "INTERNAL_ERROR", 500)`.
        The real error is still captured by `captureSentry()` for
        server-side observability. The `X-Request-Id` response header
        (set by `withAuth`/`timed`) gives the operator a correlation
        key to find the real error in logs.
      - Development: keep the previous behaviour (`cause.message`) so
        developers see the real error while debugging.
  - `AppError` subclasses (ValidationError, NotFoundError,
    ForbiddenError, UnauthorizedError, RateLimitError, AdapterError)
    always surface their own `.message` — they're constructed by our
    own code, are user-facing by design, and have been reviewed for
    leakage.

### Fix 8 — M12: Role enforcement inconsistent; staff tokens get confusing 404s
- Searched every route under `src/app/api/v1/shops/me/` that used
  `withAuth(...)` WITHOUT a roles array. Added explicit role lists
  per the audit's categorization:
    - Order management (`['owner', 'staff']`):
      `orders/route.ts` (GET),
      `orders/[id]/route.ts` (GET + PATCH),
      `orders/[id]/start/route.ts`,
      `orders/[id]/print/route.ts`,
      `orders/[id]/ready/route.ts`,
      `orders/[id]/complete/route.ts`,
      `orders/[id]/activity/route.ts`,
      `orders/[id]/files/[fileId]/download/route.ts`.
    - Cancel/refund (`['owner']`):
      `orders/[id]/cancel/route.ts`.
    - Settings/pricing (`['owner']`):
      `me/route.ts` (GET + PATCH),
      `upi-qr/route.ts` (POST + GET),
      `qr/route.ts` (GET — shop QR is owner-only settings).
    - Analytics/reports (`['owner', 'staff']`):
      `analytics/route.ts` (GET),
      `agents/route.ts` (GET — list print agents),
      `sticker/route.ts` (GET — sticker PDF).
  - Routes that already had explicit role arrays
    (`orders/[id]/verify-payment`, `orders/[id]/files/[fileId]/page-count`,
    `orders/[id]/files/[fileId]/print-url`, `payment-credentials/*`,
    `reports/daily`, `devices/*`) were left unchanged.

### Fix 9 — M16: Paytm webhook extractReference can throw on malformed bodies
- `src/lib/payments/webhook.service.ts`
  - The Paytm branch of `extractReference()` was rewritten to use
    `URLSearchParams` instead of manual `rawBody.split('&')` +
    `pair.split('=').map(decodeURIComponent)`. This:
      - handles `=` inside values (e.g. base64 padding);
      - handles `+` as a space (form-encoding) which the previous
        `decodeURIComponent` did NOT (it left `+` as a literal plus,
        breaking any value that contained a space encoded per spec);
      - returns `null` for missing keys instead of `undefined`.
  - The whole Paytm branch is wrapped in try/catch — `URLSearchParams`
    is forgiving but a non-string `rawBody` (e.g. `null`/`undefined`
    coerced by a broken upstream caller) would still throw a
    `TypeError`. On any error, returns `null` (→ unmatched webhook
    stored in `WebhookInbox` for retry by the reconciliation cron).
  - The PhonePe branch was already wrapped in try/catch — left
    unchanged.

## Verification
- `bun run lint` — clean (exit 0).
- `bun run typecheck` (`tsc --noEmit`) — clean (exit 0).
- Vitest suites:
  - `src/lib/services/parse-page-count.test.ts` — 10/10 pass.
  - `src/lib/auth/auth.test.ts` — 17/17 pass.
  - `src/lib/upload/{upload-api,file-validation,status-api}.test.ts`
    + `src/lib/api/api-routes.test.ts` — 54/54 pass.
  - `packages/adapters/src/storage/{s3,r2}.adapter.test.ts`
    + `packages/adapters/src/cache/in-memory.adapter.test.ts`
    + `packages/adapters/src/payment/{upi-deeplink,adapter-contract}.test.ts`
    — 63/63 pass.
  - `src/lib/payments/{payments,webhook-audit,lifecycle.service,print-job-idempotency,payment-event-persistence}.test.ts`
    — 41/41 pass.

## Notes
- The audit's Fix 3 cited `src/app/shop/settings/page.tsx` as the file
  containing the pamphlet + split-payment UI. Verified by grep — that
  file does NOT contain those controls. The dead UI actually lives in
  `src/app/shop/register/page.tsx`; fixed there. (Settings page only
  has UPI ID + payment phone + cash-on-pickup toggle — no pamphlet or
  split dropdown.)
- The dev server's auto-`db:push` step still fails because
  `DATABASE_URL` points at a SQLite `file:` URL while the Prisma schema
  requires `postgresql://`. Pre-existing environment-config issue,
  unrelated to these fixes; lint + typecheck (the gates the audit
  asked for) both pass.
