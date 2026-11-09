# PAYMENT-TESTS — payment HTTP route-handler tests

**Task ID:** PAYMENT-TESTS
**Agent:** test-author
**Date:** 2026-11-09
**Status:** ✅ complete

## Deliverable

Created `/home/z/my-project/src/lib/api/payment-route-tests.test.ts` — 15 real
payment HTTP route-handler tests that invoke ACTUAL exported route handlers
(`POST` / `GET`) with real `NextRequest` objects and real JWT / customer tokens.

The test file follows the established pattern in
`src/lib/api/http-route-tests.test.ts`:
- InMemoryDatabaseAdapter + JwtAuthAdapter via `setContainerForTesting()`
- shops + users created via `repos.users.create()` + `repos.shops.create()`
- real JWTs via `auth.issueAccessToken()`
- route handlers imported as `const { POST } = await import('...')`
- called with `new NextRequest(url, { method, headers, body })`

## Tests (15 total, all passing)

| # | Path | Method | Status | What it asserts |
|---|------|--------|--------|-----------------|
| 1 | `/api/v1/orders/{id}/checkout` | POST | 200 | valid order token → payment intent created (`upiUri`, `qrPayload`, `merchantOrderId`) |
| 2 | `/api/v1/orders/{id}/checkout` | POST | 403 | no `X-Order-Token` header → FORBIDDEN, no existence leak |
| 3 | `/api/v1/orders/{id}/checkout` | POST | 403 | wrong `X-Order-Token` → FORBIDDEN (constant-time compared) |
| 4 | `/api/v1/shops/me/orders/{id}/verify-payment` | POST | 200 | owner JWT, `action=verify` → order transitions `awaiting_payment → paid`, `paymentTxnId = manual-{id}` |
| 5 | `/api/v1/shops/me/orders/{id}/verify-payment` | POST | 401 | no Authorization header → UNAUTHORIZED |
| 6 | `/api/v1/shops/me/orders/{id}/verify-payment` | POST | 404 | cross-tenant — Shop A owner JWT + Shop B order → NOT_FOUND, Shop B order untouched |
| 7 | `/api/v1/payments/phonepe/webhook` | POST | 400 | empty body → "no merchantOrderId in payload", `applied=false` |
| 8 | `/api/v1/payments/paytm/callback` | POST | 400 | empty body → "no merchantOrderId in payload", `applied=false` |
| 9 | `/api/v1/payments/upi/verify/{orderId}` | GET | 200 | awaiting_payment order → `paid=false`, `amountPaise=null` |
| 10 | `lookupPaymentSession` (fn) | — | — | unknown merchantOrderId → null; DB fallback consulted |
| 11 | `rememberPaymentSession` + `lookupPaymentSession` (fn) | — | — | round-trip via cache; DB fallback NOT consulted |
| 12 | `lookupPaymentSession` (fn) | — | — | DB fallback when cache misses; mocked `paymentAttempt.findUnique`; cache re-populated |
| 13 | `/api/v1/payments/upi/verify/{nonexistentOrderId}` | GET | 404 | NOT_FOUND (no existence leak via 200) |
| 14 | `processWebhook` (fn) | — | 400 | real PhonePe X-VERIFY signature, amount mismatch (9999 vs 10000) → "amount mismatch", order untouched |
| 15 | `processWebhook` (fn) | — | 200 | idempotency cache pre-populated → "idempotent — already processed", `applied=false`, no audit log |

## Spec deviations (intentional, no weakening)

- **Test 13**: the spec said `200 with paid=false` for a nonexistent orderId.
  The actual route handler throws `NotFoundError('Order not found')` (correct
  security behavior — order UUIDs are NOT credentials; silently returning 200
  would leak existence to unauthenticated pollers, which is exactly what
  SEC-001 / `with-order-access` was built to prevent). I asserted the actual
  behavior: `404 NOT_FOUND`. The error code is checked explicitly.

- **Tests 7, 8**: the spec said "may be 400 or 401". The actual behavior is
  `400` with `summary: "no merchantOrderId in payload"`. I asserted that
  exact status + summary substring — not weakened.

- **Tests 14, 15**: used real PhonePe X-VERIFY signatures (`sha256(base64Body +
  saltKey)###saltIndex`) over real base64-encoded JSON payloads, exercised
  through the actual `PhonePePaymentAdapter.handleWebhook` → UPIPay
  `verifyWebhook` path. No security implementation was mocked — only the
  `@/lib/db` module's `paymentAttempt.findUnique` function is mocked (and
  only for tests 10 + 12), because the in-memory `DatabaseAdapter` does not
  expose Prisma's `paymentAttempt` model.

## Mocking strategy

`vi.mock('@/lib/db', () => ({ db: { paymentAttempt: { findUnique: vi.fn() } } }))`
is hoisted to the top of the file by vitest. It replaces the dynamic
`await import('@/lib/db')` inside `webhook.service.ts → lookupPaymentSession`,
which is the DB-fallback path. Per-test configuration is done via
`vi.mocked(mockedDb.paymentAttempt.findUnique).mockResolvedValue(...)`.

The container's in-memory `DatabaseAdapter` (used by the repositories) is
unaffected — the mock only intercepts the dynamic-import fallback path.

## Commands & results

```bash
# 1. TypeScript type-check
$ npx tsc --noEmit
$ echo $?
0   # ✅ clean

# 2. Run the new test file
$ bunx vitest run src/lib/api/payment-route-tests.test.ts
 ✓ src/lib/api/payment-route-tests.test.ts (15 tests) 2614ms
 Test Files  1 passed (1)
      Tests  15 passed (15)   # ✅ all pass

# 3. Sanity: other payment/http tests still pass (mock is per-file)
$ bunx vitest run src/lib/payments/payments.test.ts \
                 src/lib/payments/webhook-audit.test.ts \
                 src/lib/api/http-route-tests.test.ts
 Test Files  3 passed (3)
      Tests  32 passed (32)   # ✅ no regressions
```

## File created

- `src/lib/api/payment-route-tests.test.ts` — **663 lines**, 15 tests.
