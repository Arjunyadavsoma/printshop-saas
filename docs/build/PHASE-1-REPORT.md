# PHASE 1 REPORT — Data model, migration, seed, auth roles, tenant isolation
Date: 2026-11-21 · Status: COMPLETE · Suite: vitest 61/61 files, 708 passed / 4 skipped, tsc 0

## Delivered
- Migrations: 20261121000000_product_phase1_models (Printer, PrintSpec, PriceRule, Addon, Payment, OrderEvent, Notification + additive columns on Shop/User/Order/PrintFile/PrintJob; PrintJob.idempotencyKey backfilled via gen_random_uuid), 20261121010000_order_customer_name, 20261121020000_printjob_multi_task (retires the legacy one-active-job-per-file invariant — the task model splits one file into concurrent COLOR_SET + BW_SET; dedup now via idempotencyKey @unique).
- PrintTask = extended PrintJob (device contract untouched; unknown fields ignored by older companions). Status enum extended: dispatched/received/spooled/printed/uncertain/cancelled (legacy values kept).
- UserRole gains 'operator'; withAuth(handler, ['owner']) enforces it (403). Existing pbkdf2-SHA512 600k-iteration password hashing reused (argon2 not installed — adapter-swappable, documented).
- Seed (bun run db:seed): 2 shops (sai-xerox UPI_THEN_PRINT, ganesh-digital BOTH), owner+operator each, 3 printers each (color/BW/paused-error), 8 price rules × 2 shops with 2-slab tiers, 4 add-ons each, 15 orders per shop across the full status machine with files+specs+tasks+events+payments.
- New repositories (product.repository.ts): Printer/PriceRule/Addon/Payment/OrderEvent(append-only)/Notification — every list/read method takes a REQUIRED shopId.
- src/lib/api/product-tenant-isolation.test.ts — 18 tests: cross-shop printer/rule/addon/payment/event/notification access denied; defaults computed per shop; multi-task-per-file allowed; operator role 403 on owner-only routes; tenant scoping on allowed routes.

## Environment note
The sandbox recycle reset the repo to the older laptop-lineage branch and lost the postgres binaries — recovered: local branch reset to origin/fix/e2e-printshop (all Phase-4/5 work intact), portable PG16 rebuilt from the zonky binaries against the surviving data dir, stale test DBs dropped so integration suites re-migrate fresh.

## Honest notes
- Prisma CLI here is 6.19.2 (bunx defaulting to v8 fails); all migrate commands use ./node_modules/.bin/prisma.
- Test DBs (printshop_test, printshop_app_test) are expected pre-provisioned by the battery; recreated + migrated.
