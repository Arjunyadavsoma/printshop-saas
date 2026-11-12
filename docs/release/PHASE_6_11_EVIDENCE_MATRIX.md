# Phase 6.11 — Evidence Matrix

| Requirement | Implementation | Test | Evidence category | Result | Residual risk |
|---|---|---|---|---|---|
| Clean migration deployment | 5 migrations in prisma/migrations/ | prisma migrate deploy on clean PostgreSQL | Real PostgreSQL | PASS | None |
| Existing-database migration | Same 5 migrations (idempotent) | DB B rehearsal with existing data | Real PostgreSQL | PASS | None |
| Missing columns fixed | 20251107000001_add_missing_schema_columns | prisma migrate diff + migrate deploy | Real PostgreSQL | PASS | None |
| Partial unique index | PaymentAttempt_active_order_unique | pg_indexes query | Real PostgreSQL | PASS | None |
| PaymentEvent FK | PaymentEvent_attemptId_fkey | pg_constraint query | Real PostgreSQL | PASS | None |
| Checkout idempotency (20 concurrent) | checkout/route.ts stable key + partial index | app-checkout-concurrency.test.ts | Real PostgreSQL + HTTP route | PASS | None |
| Webhook FK integrity | lifecycle.service.ts attemptId: attempt.id | app-webhook-integration.test.ts (15 tests) | Real PostgreSQL + app service | PASS | None |
| Unknown webhook recovery | webhook.service.ts 404 response | app-webhook-integration.test.ts test 3 | Real PostgreSQL + app service | PASS | Low — relies on provider retry |
| PhonePe v1 signature | phonepe.adapter.ts X-VERIFY | payments.test.ts (5 tests) | Test vectors | PASS | Low — no sandbox |
| PhonePe v2 signature | phonepe-v2-webhook.ts SHA auth | phonepe-v2-webhook.test.ts (16 tests) | Test vectors | PASS | Low — no sandbox |
| Paytm checksum | paytm.adapter.ts official algorithm | paytm-checksum.test.ts (11 tests) | Test vectors | PASS | Low — no sandbox |
| UPI manual confirmation | verify-payment/route.ts owner-only | payment-route-tests.test.ts | Unit + HTTP route | PASS | Low — stub verifyPayment |
| Cron Bearer auth | reconcile-payments + cleanup routes | cron-auth.test.ts (16 tests) | Unit + HTTP route | PASS | None |
| Cron schedule | vercel.json crons array | Manual inspection | Source inspection | PASS | None — not staging-tested |
| Terminal state immutability | lifecycle.service.ts conditional updateMany | app-webhook-integration.test.ts tests 11,12 | Real PostgreSQL | PASS | None |
| Transaction atomicity | lifecycle.service.ts db.$transaction | app-webhook-integration.test.ts test 13 | Real PostgreSQL | PASS | None |
| Concurrent webhook safety | Partial unique index + conditional updates | app-webhook-integration.test.ts test 14 | Real PostgreSQL | PASS | None |
| Amount/currency validation | lifecycle.service.ts lines 222-259 | app-webhook-integration.test.ts tests 6,7 | Real PostgreSQL | PASS | None |
| Payment amount server-authoritative | checkout/route.ts order.totalAmountPaise | financial-integrity.test.ts | Unit + HTTP route | PASS | None |
| WCAG 2.2 AA accessibility | globals.css brand/success/muted tokens | accessibility.spec.ts axe-core | Playwright + axe-core | PASS | None |
| PhonePe sandbox certification | — | — | NOT EXECUTED | NOT EXECUTED | No sandbox credentials |
| Paytm sandbox certification | — | — | NOT EXECUTED | NOT EXECUTED | No sandbox credentials |
| Staging cron execution | — | — | NOT EXECUTED | NOT EXECUTED | No staging deployment |
