# Phase 6.10 — Evidence Matrix

| Requirement | Implementation | Test | Executed | Evidence | Risk |
|---|---|---|---|---|---|
| Checkout idempotency (DB-enforced) | checkout/route.ts:82 (stable key) + migration (partial unique index) | checkout-real-postgres.test.ts (12 tests), app-checkout-concurrency.test.ts | ✅ Yes | 20 concurrent requests → 1 attempt, 19 × 23505 | None |
| PaymentEvent FK integrity | lifecycle.service.ts:160 (attemptId: attempt.id) | webhook-postgres-fk.test.ts, app-webhook-integration.test.ts | ✅ Yes | FK violation (23503) on wrong attemptId | None |
| Webhook signature verification (PhonePe v1) | phonepe.adapter.ts:248-273 (UPIPay verifyWebhook) | payments.test.ts (5 tests), app-webhook-integration.test.ts | ✅ Yes | sha256(base64body + saltKey)###saltIndex | None |
| Webhook signature verification (PhonePe v2) | phonepe-v2-webhook.ts:38-69 (SHA auth, constant-time) | phonepe-v2-webhook.test.ts (16 tests) | ✅ Yes | timingSafeEqual, fail-closed | None |
| Paytm checksum verification | paytm.adapter.ts:87-150 (official algorithm) | paytm-checksum.test.ts (11 tests), payments.test.ts | ✅ Yes | AES-128-CBC, IV @@@@&&&&####$$$$, constant-time | None |
| PhonePe v2 unverified webhook removed | phonepe.adapter.ts:279-286 (reject with 401) | app-webhook-integration.test.ts test 10 | ✅ Yes | No unverified branch exists | None |
| Duplicate webhook idempotency | lifecycle.service.ts:170-187 (UNIQUE catch) | app-webhook-integration.test.ts tests 4,5 | ✅ Yes | 23505 on duplicate (provider, eventId) | None |
| Terminal state immutability | lifecycle.service.ts:261-301 (conditional updateMany WHERE status IN created,pending) | app-webhook-integration.test.ts tests 11,12 | ✅ Yes | 0 rows matched on terminal attempt | None |
| Amount validation | lifecycle.service.ts:222-240 + webhook.service.ts:247-260 | app-webhook-integration.test.ts test 6 | ✅ Yes | Rejected when amountPaise !== attempt.amountPaise | None |
| Currency validation | lifecycle.service.ts:241-259 | app-webhook-integration.test.ts test 7 | ✅ Yes | Rejected when currency !== attempt.currency | None |
| Transaction atomicity | lifecycle.service.ts:127 (db.$transaction Serializable) | app-webhook-integration.test.ts test 13,15 | ✅ Yes | Rollback undoes all writes | None |
| Concurrent webhook safety | Partial unique index + conditional updateMany | app-webhook-integration.test.ts test 14 | ✅ Yes | One consistent final state | None |
| Unknown attempt handling | lifecycle.service.ts:137-152 (return early, no event) | app-webhook-integration.test.ts test 3 | ✅ Yes | Returns 'PaymentAttempt not found', no PaymentEvent | Low — event not persisted for retry |
| Cron Bearer-only auth | reconcile-payments/route.ts:68-84, cleanup/route.ts:33 | cron-auth.test.ts (16 tests) | ✅ Yes | ?secret= rejected, empty secret → 401 | None |
| Cron schedule | vercel.json:15-18 | Manual inspection | ✅ Yes | */10 min reconcile, */5 min cleanup | None |
| Migration reproducibility | prisma/migrations/ (4 files, TIMESTAMP(3)) | prisma migrate deploy on clean PostgreSQL | ✅ Yes | All 4 migrations applied, 14 tables, partial index, FK | None |
| Production migration script | scripts/pg-migrate-prod.sh | PHASE_6_9_PRODUCTION_MIGRATION_CERTIFICATION.md | ✅ Yes | Audited, uses prisma migrate diff, idempotent | Low — predates DATETIME fix |
| UPI manual confirmation | verify-payment/route.ts (withAuth owner, transitionStatus) | payment-route-tests.test.ts | ✅ Yes | Owner-only, tenant-scoped, deterministic txnId | Low — verifyPayment stub returns paid:false |
| Rate limiting | rate-limit.ts (IP-based, XFF trusted with TRUSTED_PROXY) | Manual inspection | ✅ Yes | 20 req/60s checkout | Low — requires TRUSTED_PROXY in prod |
| Order ownership | with-order-access.ts (timingSafeEqual, 403) | payment-route-tests.test.ts, http-route-tests.test.ts | ✅ Yes | customerToken required | None |
| Payment amount server-authoritative | checkout/route.ts:142 (order.totalAmountPaise, body not read) | financial-integrity.test.ts test 1 | ✅ Yes | Client-supplied total ignored | None |
| Page selection pricing | files/[fileId]/route.ts (resolveBillablePages) | pricing-with-selection.test.ts (10 tests) | ✅ Yes | pageRange parsed, billablePages used | None |
| WCAG 2.2 AA accessibility | globals.css (brand L=0.45, success L=0.42, muted L=0.48) | accessibility.spec.ts (3 tests, axe-core) | ✅ Yes | 0 violations on homepage, shop, order | None |
| Playwright consumer journey | consumer-journey.spec.ts (19 tests) | 3 consecutive runs | ✅ Yes | 19 passed, 0 failed, 1 skipped (×3) | None |
| PDF preview E2E | consumer-journey.spec.ts test 16 | Executed against dev server | ✅ Yes | Upload, page count, zoom, selection | None |
| Skip 1: different idempotency keys | checkout-idempotency.test.ts:187 | N/A — key is deterministic | ✅ Documented | Key = checkout-${order.id}, different keys impossible | None |
| Skip 2: webhook during retry | checkout-idempotency.test.ts:308 | Requires real webhook delivery | ✅ Documented | Needs provider sandbox | Low — reconciliation covers |
| Skip 3: processWebhook 500 | fail-closed-verification-tests.test.ts:165 | Needs PhonePe credentials | ✅ Documented | PGlite tests cover same behavior | Low |
