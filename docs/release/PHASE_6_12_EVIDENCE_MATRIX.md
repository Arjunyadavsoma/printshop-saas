# Phase 6.12 — Evidence Matrix

| Requirement | Implementation | Test | Evidence category | Result | Residual risk |
|---|---|---|---|---|---|
| Durable unmatched-webhook recovery | webhook.service.ts (WebhookInbox persist) + prisma/schema.prisma (WebhookInbox model) | app-webhook-integration.test.ts (15 tests, all pass) | Real PostgreSQL + app service | PASS | Low — recovery worker not yet wired to cron |
| WebhookInbox migration | 20251107000002_add_webhook_inbox/migration.sql | prisma migrate deploy on clean PostgreSQL | Real PostgreSQL | PASS | None |
| Clean migration (6 migrations) | All 6 migrations in prisma/migrations/ | prisma migrate deploy on clean DB | Real PostgreSQL | PASS | None |
| Existing-database data preservation | Idempotent migrations (IF NOT EXISTS) | DB B rehearsal (Phase 6.11) | Real PostgreSQL | PASS | None |
| Missing columns fix | 20251107000001_add_missing_schema_columns | prisma migrate diff + deploy | Real PostgreSQL | PASS | None |
| Partial unique index | PaymentAttempt_active_order_unique | pg_indexes query | Real PostgreSQL | PASS | None |
| PaymentEvent FK integrity | lifecycle.service.ts (attemptId: attempt.id) | app-webhook-integration.test.ts | Real PostgreSQL + app service | PASS | None |
| Checkout idempotency (20 concurrent) | checkout/route.ts stable key + partial index | app-checkout-concurrency.test.ts | Real PostgreSQL + HTTP route | PASS | None |
| PhonePe v1 signature | phonepe.adapter.ts X-VERIFY | payments.test.ts | Test vectors | PASS | Low — no sandbox |
| PhonePe v2 signature | phonepe-v2-webhook.ts SHA auth | phonepe-v2-webhook.test.ts | Test vectors | PASS | Low — no sandbox |
| Paytm checksum | paytm.adapter.ts official algorithm | paytm-checksum.test.ts | Test vectors | PASS | Low — no sandbox |
| UPI manual confirmation | verify-payment/route.ts owner-only | payment-route-tests.test.ts | Unit + HTTP route | PASS | Low — stub verifyPayment |
| Cron Bearer auth | reconcile + cleanup routes | cron-auth.test.ts (16 tests) | Unit + HTTP route | PASS | None |
| Cron schedule | vercel.json crons array | Manual inspection | Source inspection | PASS | None — not staging-tested |
| Terminal state immutability | lifecycle.service.ts conditional updateMany | app-webhook-integration.test.ts | Real PostgreSQL | PASS | None |
| Transaction atomicity | lifecycle.service.ts db.$transaction | app-webhook-integration.test.ts | Real PostgreSQL | PASS | None |
| Amount/currency validation | lifecycle.service.ts | app-webhook-integration.test.ts | Real PostgreSQL | PASS | None |
| Payment amount server-authoritative | checkout/route.ts order.totalAmountPaise | financial-integrity.test.ts | Unit + HTTP route | PASS | None |
| WCAG 2.2 AA | globals.css tokens | accessibility.spec.ts axe-core | Playwright + axe-core | PASS | None |
| PhonePe sandbox | — | — | NOT EXECUTED | NOT EXECUTED | No credentials |
| Paytm sandbox | — | — | NOT EXECUTED | NOT EXECUTED | No credentials |
| Staging cron execution | — | — | NOT EXECUTED | NOT EXECUTED | No staging |
| GitHub PAT revocation | — | — | NOT VERIFIED | NOT VERIFIED | Owner action required |
