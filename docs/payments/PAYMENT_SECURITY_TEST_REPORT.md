# Payment Security Test Report — PrintShop SaaS

**Scope:** Webhook signature verification, idempotency layers, race-safe order
state transitions, and audit logging for the PrintShop SaaS payment pipeline.

**Sources read (live source):** `src/lib/payments/webhook.service.ts`,
`src/lib/payments/phonepe-v2-webhook.ts`,
`packages/adapters/src/payment/{phonepe,paytm,upi-deeplink}.adapter.ts`,
`src/app/api/v1/payments/{phonepe/webhook,paytm/callback}/route.ts`,
`src/app/api/v1/orders/[id]/checkout/route.ts`, `prisma/schema.prisma`, and the
four test files under `src/lib/payments/*.test.ts`.

**Verdict:** Signature algorithms are real and locally verified. End-to-end
integration with live PSP sandboxes is **UNVERIFIED** — provider credentials
are not provisioned, no `PaymentAttempt` row is created at checkout, and no
refund endpoint exists. Source code was NOT modified.

---

## 1. Webhook Signature Verification (per provider)

`processWebhook` (`webhook.service.ts:122-322`) routes every inbound callback
through the same funnel: (1) audit-log received, (2) extract untrusted
`merchantOrderId`, (3) look up session → shop credentials, (4) call adapter
`handleWebhook`, (5) only on `result.ok && verification.paid` proceed to
idempotency + transition.

### 1.1 PhonePe v1 — X-VERIFY — **VERIFIED**
**Algorithm** (`phonepe.adapter.ts:230-301`): reads `X-VERIFY` header
(case-insensitive), delegates to UPIPay SDK's `client.verifyWebhook(rawBody,
signature, { enableReplayProtection: false })` when `c.saltKey` is present.
Canonical PhonePe callback MAC: `sha256(base64body + saltKey)###saltIndex`.

**Test evidence** (`payments.test.ts:89-165`, `webhook-audit.test.ts:117-137`):
tests construct the signature manually as
`createHash('sha256').update(base64Body + SALT_KEY).digest('hex') + '###1'`
and verify valid → 200 paid; wrong salt key → 401; wrong salt index (`###99`)
→ 401; `state: 'FAILED'` → not paid; duplicate `txnId` → idempotent skip.

### 1.2 PhonePe v2 — SHA-256 Authorization header — **VERIFIED**
**Algorithm** (`phonepe-v2-webhook.ts:36-69`): expected =
`SHA256(username + ":" + password)` lowercase hex; received = bare
`Authorization` header (NOT Basic, NOT Bearer); compared via
`timingSafeEqual` (constant-time, length-checked first). Reads
`PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` env vars; if either
is missing → fail-closed (reject).

**Format detection** (`phonepe/webhook/route.ts:50-53`): v2 selected when
`Authorization` matches `/^[0-9a-f]{64}$/i` AND body starts with `{` AND body
contains `"event"`. Otherwise → v1 path.

**Test evidence** (`phonepe-v2-webhook.test.ts`, 16 tests): valid hex
accepted; wrong password / wrong username / `null` / empty / Basic / Bearer /
truncated (32-char) rejected; uppercase normalized; env vars missing →
fail-closed; special chars handled; v2 plain-JSON body distinguished from v1
base64; event classification (`*.completed`, `*.failed`, `refund.*`, other).

### 1.3 Paytm — CHECKSUMHASH (AES-128-CBC) — **VERIFIED\***
**Algorithm** (`paytm.adapter.ts:53-89, 225-266`): join sorted params
(excluding `CHECKSUMHASH`) as `k=v|...|merchantKey`; `hashHex = SHA256(...)`;
`CHECKSUMHASH = base64(AES-128-CBC(hashHex, key=merchantKey[0:16],
IV='0123456789012345'))`. Verify = decrypt inbound checksum, compare to
recomputed `hashHex`. Uses Web Crypto `crypto.subtle`.

**Test evidence** (`payments.test.ts:167-205`): valid checksum (via
`generatePaytmChecksum`) → 200 paid + HTML "Payment Successful"; tampered
amount after signing → 401 + HTML "Checksum verification failed".

**\*Caveat (PAY-SEC-003):** hand-rolled IV `0123456789012345` differs from
the official Paytm Node Checksum IV `@@@@&&&&####$$$$`. Internal tests pass
because the dev simulate route uses the same hand-rolled generator, but real
production Paytm callbacks signed with the official IV **would fail**.

### 1.4 UPI deep-link — **N/A** (no webhook)
`upi-deeplink.adapter.ts:84-86` `handleWebhook` returns
`{ ok: false, statusCode: 404 }`. `verifyPayment` (lines 66-81) is a stub
returning `{ paid: false, ... }`. Confirmation relies on the PSP status API
(layered PhonePe/Paytm intent) or the dev `/mark-paid` route.

### Summary

| Provider | Algorithm | Status | Integration |
|---|---|---|---|
| PhonePe v1 | `SHA256(base64+saltKey)###saltIndex` | VERIFIED | UNVERIFIED |
| PhonePe v2 | `SHA256(user:pass)` const-time | VERIFIED | UNVERIFIED |
| Paytm | AES-128-CBC(SHA256(params\|key), key, IV) | VERIFIED\* | UNVERIFIED |
| UPI deep-link | none | N/A | N/A |

---

## 2. Idempotency Layers

Three independent layers plus a DB fallback — any one prevents a duplicate
payment from double-marking an order paid.

**Layer 1 — Cache `pay:done:{provider}:{txnId}` (24h TTL).**
`webhook.service.ts:191-201, 292`. On entry: if cache has the key → idempotent
skip (200). On success: `cache.set(processedKey, order.id, 86400)`. Fast-path;
lost on cache flush / cold start.

**Layer 2 — `Order.paymentTxnId @unique` (DB constraint).**
`prisma/schema.prisma:83`. Handler at `webhook.service.ts:274-289`:
`isUniqueConstraintError(err)` catch returns idempotent 200. If two concurrent
webhooks race past Layer 1, only one UPDATE can write `paymentTxnId`; the
loser hits P2002 and is treated as idempotent (no throw, no double-audit).

**Layer 3 — Conditional UPDATE `WHERE status='awaiting_payment'`.**
`webhook.service.ts:254-273` via `repos.orders.transitionStatus(order.id,
shop.id, 'awaiting_payment', {...})` (`order.repository.ts:284-295`). Builds
`UPDATE ... WHERE id=? AND shopId=? AND status='awaiting_payment'`. If a
concurrent manual `/verify-payment` or duplicate webhook already advanced the
order, the precondition fails → 0 rows → null return → idempotent skip.
**Race-safe.**

**PaymentAttempt DB fallback (cache → DB → re-cache).**
`webhook.service.ts:31-65` `lookupPaymentSession`: (1) try cache key
`pay:moid:{merchantOrderId}` (10-min TTL set at checkout); (2) on miss, query
`db.paymentAttempt.findUnique({ where: { merchantOrderId } })`; (3) on hit,
rebuild `StoredPaymentSession` and re-populate cache. Schema
(`prisma/schema.prisma:197-218`) confirms `PaymentAttempt.merchantOrderId
@unique`. **Gap:** see PAY-SEC-007 — checkout never inserts a row.

**Print-job idempotency (post-payment).**
`webhook.service.ts:345-364` `enqueuePaidOrderPrint` → `print.service.ts`
`enqueueFilePrint`. Two-layer guard per file: `findActiveByFile(fileId)`
pre-check returns existing `queued`/`printing` job; `PrintJob_active_file_unique`
partial unique index catches concurrent inserts via P2002. Then
`transitionStatus(orderId, shopId, 'paid', { status: 'printing' })` is a
race-safe conditional flip (no-op if `/start` already did it).

---

## 3. Existing Test Coverage

**`payments.test.ts` — PhonePe + Paytm signature, idempotency, amount, race.**
End-to-end `processWebhook` against real crypto. Seeds an in-memory shop with
both providers' credentials, constructs signed payloads from scratch, feeds
them through the full pipeline. Covers: PhonePe valid X-VERIFY → paid;
tampered salt key → 401; wrong salt index → 401; `state=FAILED` → not paid;
duplicate `txnId` → idempotent skip; Paytm valid checksum → paid + HTML;
tampered amount after signing → 401. Amount validation
(`webhook.service.ts:217-236`) rejects both `amountPaise === null` (Phase 4
fix — was previously skipped) and `amountPaise !== order.totalAmountPaise`.

**`phonepe-v2-webhook.test.ts` — 16 tests, SHA auth + event routing.**
`validatePhonePeV2Auth` in isolation (no DB, no API). Covers valid hex;
wrong password / username; `null` / empty / Basic / Bearer / truncated
rejected; uppercase normalized; env vars missing → fail-closed; special chars;
v2 plain-JSON body vs v1 base64; event classification.

**`webhook-audit.test.ts` — raw payload redaction.**
Confirms `webhook.{provider}.received` audit event stores exactly
`{path, contentLength, provider}` (no raw body, no CHECKSUMHASH, no saltKey,
no merchantTransactionId); `webhook.{provider}.paid` stores exactly
`{txnId, utr, amountPaise}` (reconciliation record); `webhook.{provider}.failed`
stores `{txnId, state: 'not-paid'}`; the application logger is never called
with raw body fragment, CHECKSUMHASH, or saltKey (txnId IS allowed for support).

**`print-job-idempotency.test.ts` — concurrent PrintJob creation.**
Covers single call → 1 job; retry → no duplicate; existing `printing` → no
duplicate; existing `completed` → NEW job (reprint); existing `needs_review`
→ NEW job (shopkeeper reprint); mocked P2002 from concurrent INSERT → caught,
`findActiveByFile` re-run, no throw, exactly 1 job.

---

## 4. Security Findings

**PAY-SEC-001 — PhonePe v1 X-VERIFY — VERIFIED.** Real
`SHA256(base64body + saltKey)###saltIndex` via UPIPay SDK
(`phonepe.adapter.ts:245-273`). Tampered salt key, wrong index, and
`state=FAILED` all correctly rejected. No issue.

**PAY-SEC-002 — PhonePe v2 SHA-256 Authorization header — VERIFIED.** Real
`SHA256(username:password)` with `timingSafeEqual` and fail-closed behavior
(`phonepe-v2-webhook.ts:55-69`). 16 dedicated tests. No issue with the
algorithm; integration UNVERIFIED (see PAY-SEC-005).

**PAY-SEC-003 — Paytm CHECKSUMHASH uses non-standard IV — RISK.**
`paytm.adapter.ts:29`: `PAYTM_IV = '0123456789012345'`. Official Paytm Node
Checksum (and UPIPay's `verifyWebhook`) uses `@@@@&&&&####$$$$`. Internal
tests pass because the dev simulate route uses the same hand-rolled
generator, but real Paytm production callbacks signed with the official IV
**would fail verification**. Code comment (`paytm.adapter.ts:203-224`)
acknowledges the divergence but preserves it. Risk: production callbacks 401.

**PAY-SEC-004 — UPI deep-link has no webhook; `verifyPayment` is a stub — N/A / GAP.**
`upi-deeplink.adapter.ts:66-81, 84-86`. No server-side confirmation path
in the current code — reliance on dev `/mark-paid` or a layered PSP intent.
Acceptable as a fallback, but must not be the only path for production shops
without a real PSP.

**PAY-SEC-005 — Provider credentials not provisioned → integration UNVERIFIED.**
Test suite uses synthetic credentials (`SALT_KEY = 'test-salt-key'`,
`MERCHANT_KEY = 'test-merchant-key'`). Signature algorithms are verified in
isolation, but no test exercises the pipeline against PhonePe sandbox
(`api-preprod.phonepe.com`) or Paytm staging (`securegw-stage.paytm.in`).
The OAuth2 token flow (`phonepe.adapter.ts:96-129`), `/pg/v2/status`, and
Paytm `/v3/order/status` have never been hit with real merchant credentials.
**End-to-end PSP integration UNVERIFIED.**

**PAY-SEC-006 — No refund endpoint exists → refund flow UNVERIFIED.**
`LS src/app/api/v1/payments` shows only `phonepe/webhook`, `paytm/callback`,
`upi/verify/[orderId]`, and `dev/{phonepe,paytm}/simulate`. No `refund`
route. All three adapters implement `refund()` calling real PSP refund APIs
(PhonePe `/pg/v2/refund` with Bearer token, Paytm `/v3/order/refund` via
UPIPay), but **no HTTP route invokes them**. A shopkeeper cannot trigger a
refund through the API. **Refund flow UNVERIFIED and unreachable.**

**PAY-SEC-007 — PaymentAttempt not created at checkout → DB fallback reads empty table.**
`orders/[id]/checkout/route.ts:69-74` calls `rememberPaymentSession` which
writes ONLY to the cache (`pay:moid:{merchantOrderId}`, 10-min TTL).
`webhook.service.ts:42-62` DB fallback queries
`db.paymentAttempt.findUnique({ where: { merchantOrderId } })`, but the
schema (`prisma/schema.prisma:197-218`) defines the table with
`merchantOrderId @unique` for exactly this fallback — and **no code path
ever inserts a row**. If the cache entry expires (Vercel cold start, deploy
flush, or UPI flow >10 min), the webhook returns 404 "session expired" →
**the order is stranded in `awaiting_payment`** even though the customer
paid and the PSP delivered a valid signed webhook. Severity: High.

**PAY-SEC-008 — v2 webhook print-enqueue errors are swallowed.**
`phonepe-v2-webhook.ts:313-329`: post-payment print enqueue runs inside a
fire-and-forget IIFE `void (async () => { ... })()` with a single `catch`
that only logs. If `enqueueFilePrint` fails for every file, the order is
`paid` in the DB but no PrintJob exists — the dashboard queue won't show it
and the agent won't pick it up. The v1 path (`webhook.service.ts:311-313`)
uses the same fire-and-forget pattern. Mitigated by the durable queue +
agent polling, but worth a reconciliation sweep.

---

## 5. Recommendations

1. **Create a `PaymentAttempt` record at checkout** (fixes PAY-SEC-007). In
   `orders/[id]/checkout/route.ts`, after `adapter.createPaymentIntent`,
   insert a row `{ shopId, orderId, provider, merchantOrderId:
   intent.merchantOrderId, amountPaise, status: 'created', expiresAt }`. The
   webhook's existing DB fallback then finds something on a cache miss.

2. **Implement `/api/v1/payments/refund`** (fixes PAY-SEC-006).
   Shopkeeper-only (behind `withAuth({ role: 'owner' })`), accepts
   `{ orderId, amountPaise?, reason? }`, loads `paymentTxnId` + shop
   credentials, calls `adapter.refund()`, records a `PaymentEvent`
   (`eventType: 'refund'`), optionally transitions the order to `refunded`.
   Adapter methods are already implemented and unit-tested.

3. **Test against provider sandboxes with real credentials** (fixes
   PAY-SEC-005). Provision PhonePe sandbox (merchantId + saltKey, or
   clientId + clientSecret for v2) and Paytm staging (merchantId +
   merchantKey + `WEBSTAGING`) as Vercel env vars. Add an integration test
   (gated behind `RUN_PSP_INTEGRATION=1`) that creates a real intent,
   simulates the sandbox payment, captures the signed webhook the PSP
   delivers, and asserts the order flips to `paid` end-to-end.

4. **Switch Paytm verification to UPIPay's `verifyWebhook`** (fixes
   PAY-SEC-003) to use the official IV `@@@@&&&&####$$$$`. Update
   `generatePaytmChecksum` in the dev simulate route and test fixtures to
   match. Until done, production Paytm callbacks will fail verification.

5. **Add a reconciliation cron** that scans `awaiting_payment` orders older
   than N minutes, calls `adapter.verifyPayment({ merchantOrderId })`, and
   flips any the PSP reports as `paid` — defense-in-depth for lost/delayed
   webhooks (PAY-SEC-007 / PAY-SEC-008 mitigation).

6. **Document `PHONEPE_WEBHOOK_USERNAME` / `PASSWORD`** in `.env.example`
   and the deployment runbook. The route (`phonepe/webhook/route.ts:45-47`)
   logs FATAL when missing, but a missing env var still silently 401s every
   v2 webhook.

---

## 6. Sign-off

| Item | Status |
|---|---|
| Signature algorithms (all 3 providers) | VERIFIED in isolation |
| Idempotency (cache + DB unique + conditional UPDATE) | VERIFIED |
| Amount validation (null + mismatch rejection) | VERIFIED |
| Audit log redaction (no raw body / checksum / saltKey) | VERIFIED |
| Print-job idempotency (P2002 catch + findActiveByFile) | VERIFIED |
| End-to-end PSP integration (real sandbox credentials) | UNVERIFIED |
| Refund endpoint | MISSING (adapters implemented, no route) |
| PaymentAttempt row at checkout | MISSING (cache-only) |

Source code was NOT modified. This report documents the current state of
`src/lib/payments/**`, `packages/adapters/src/payment/**`, and the related
routes and tests.
