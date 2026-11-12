# Phase 7 — Production Evidence Matrix

| ID | Finding | Fix | Test | Evidence category | Result | Residual risk |
|---|---|---|---|---|---|---|
| F-01 | In-memory production cache | NOT IMPLEMENTED | — | — | NOT EXECUTED | Requires Redis |
| F-02 | Subscription enforcement | requireEntitlement on analytics+reports | api-routes.test.ts | Unit | PASS | Admin APIs missing |
| F-03 | Realtime architecture | NOT IMPLEMENTED | — | — | NOT EXECUTED | Requires Render |
| F-04 | db-health auth | Bearer header, no query string | api-routes.test.ts | Unit | PASS | None |
| F-05 | Unsafe DB setup | Disabled in production | Source inspection | Static | PASS | None |
| F-06 | Migration system | 6 migrations, prisma migrate deploy | Clean DB test | Real PostgreSQL | PASS | None |
| F-07 | CI and build | ignoreBuildErrors=false, scripts added | tsc + build | Real build | PASS | None |
| F-08 | Upload validation | NOT IMPLEMENTED | — | — | NOT EXECUTED | Needs file signatures |
| F-09 | Payment reliability | lifecycle + WebhookInbox + partial index | 15 integration tests | Real PostgreSQL | PASS | None |
| F-10 | Demo agent | Flagged in render.yaml | Source inspection | Static | PASS | None |
| F-11 | Lint and React safety | eslint clean, reactStrictMode=true | eslint + build | Real build | PASS | Rules still relaxed |
| F-12 | Browser token storage | NOT IMPLEMENTED | — | — | NOT EXECUTED | Needs cookie migration |
| F-13 | Demo credentials | Gated behind NODE_ENV | Source inspection | Static | PASS | None |
| F-14 | Device token hashing | NOT IMPLEMENTED | — | — | NOT EXECUTED | Needs salt config |
| F-15 | Financial reporting | NOT IMPLEMENTED | — | — | NOT EXECUTED | Needs SQL aggregates |
| F-16 | Hardcoded URLs | Replaced with env var | Source inspection | Static | PASS | None |
| F-17 | Printer contract | NOT DOCUMENTED | — | — | NOT EXECUTED | Needs canonicalization |
| F-18 | Mobile validation | NOT IMPLEMENTED | — | — | NOT EXECUTED | Needs Zod schema |
