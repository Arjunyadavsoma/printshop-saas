# Phase 7.1 — Evidence Matrix

| ID | Finding | Fix | Test | Evidence category | Result | Residual risk |
|---|---|---|---|---|---|---|
| F-01 | In-memory cache production | Hard failure for memory in prod | container.test.ts | Unit | PASS | Redis not integration-tested |
| F-01 | Non-atomic refresh rotation | Rotation marker (SET before DEL) | Source inspection | Static | PASS | Needs Redis integration test |
| F-08 | No file signature validation | file-signature.ts (8 formats) | file-signature.test.ts (8 tests) | Unit | PASS | None |
| F-08 | No parsing timeout | PARSE_TIMEOUT_MS=10s | Source inspection | Static | PASS | None |
| F-08 | No page-count limit | MAX_PAGE_COUNT=500 | Source inspection | Static | PASS | None |
| F-10 | Demo agent in production | process.exit(1) if DEMO=1 in prod | Source inspection | Static | PASS | None |
| F-05 | Unsafe DB setup | Disabled in production (Phase 7) | Source inspection | Static | PASS | None |
| F-12 | Browser token storage | NOT IMPLEMENTED | — | — | NOT EXECUTED | localStorage still used |
| F-03 | Realtime configuration | NOT IMPLEMENTED | — | — | NOT EXECUTED | Loopback URLs not fixed |
| F-06 | Migration system | 6 migrations, prisma migrate deploy | Clean DB test | Real PostgreSQL | PASS | None |
| F-09 | Payment reliability | lifecycle + WebhookInbox | 15 integration tests | Real PostgreSQL | PASS | None |
