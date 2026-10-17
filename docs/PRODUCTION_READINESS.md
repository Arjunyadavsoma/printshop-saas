# Production Readiness Report — PrintShop SaaS

> Verified: 2026-10-17
> State: **ready for limited private pilot** — real-infrastructure database,
> concurrency, and E2E paths verified; external providers (R2, Upstash,
> PhonePe/Paytm sandbox) remain BLOCKED on credentials.

---

## 1. Verification Results — Actual Command Outputs (2026-10-17)

| Command | Exit code | Result |
|---|---|---|
| `bun install` | 0 | 980 installs, no changes |
| `bunx tsc --noEmit` | 0 | 0 errors |
| `bun run lint` | 0 | clean |
| `bunx vitest run` | 0 | 83/83 pass (8 test files) |
| `NODE_ENV=production bun ./node_modules/.bin/next build` | 0 | passes (38 routes + middleware) |
| Real PostgreSQL integration test (54 assertions) | 0 | 54/54 pass against PostgreSQL 17.11 |
| Real independent-connection concurrency test (23 assertions) | 0 | 23/23 pass (2 separate bun processes, LISTEN/NOTIFY race) |
| E2E staging flow (34 assertions) | 0 | 34/34 pass against PostgreSQL 17 + real X-VERIFY crypto |
| pg_dump backup + restore round-trip | 0 | verified against real PG 17 |

### Staging infrastructure actually used

A disposable PostgreSQL 17.11 server was installed in **user-space** (no
root/sudo required — downloaded Debian 13 `.deb` packages and extracted them
to `/tmp/pg-install/pgroot`). It runs on `127.0.0.1:5433` with `trust` auth
on the loopback. This is a real PostgreSQL server (not PGlite, not SQLite,
not in-memory) — the concurrency test uses 2 genuinely independent TCP
connections from 2 separate `bun` worker processes.

Setup script: `scripts/pg-env.sh`. Reproducible from §A of `docs/STAGING_TESTS.md`.

---

## 2. Classification by Verification Status

### VERIFIED AGAINST REAL POSTGRESQL 17 STAGING INFRASTRUCTURE

| Item | Test | Result |
|---|---|---|
| PostgreSQL migration (DDL applied to real PG 17) | `scripts/postgres-integration.test.ts` | ✅ 54/54 |
| Schema integrity (8 tables, 21 indexes, 9 FKs, 4 unique business constraints) | psql `\dt` `\di` + FK query | ✅ verified |
| Atomic job claim (real PG conditional UPDATE) | integration test §2 | ✅ verified |
| Cross-tenant claim rejection (real PG) | integration test §3 | ✅ verified |
| Duplicate completion ack idempotency (real PG) | integration test §4 | ✅ verified |
| UNIQUE(paymentTxnId) replay guard (real PG) | integration test §5 | ✅ verified |
| Stale printing → needs_review (real PG) | integration test §6 | ✅ verified |
| needs_review blocks agent claim (real PG) | integration test §7 | ✅ verified |
| pg_dump backup + restore round-trip (real PG) | integration test §8 | ✅ verified |
| Two workers claim SAME job (2 independent TCP processes) | concurrency harness S1 | ✅ verified |
| Two workers claim DIFFERENT jobs (2 independent TCP processes) | concurrency harness S2 | ✅ verified |
| Cross-tenant claim (2 independent processes) | concurrency harness S3 | ✅ verified |
| Duplicate completion ack (2 independent processes) | concurrency harness S4 | ✅ verified |
| Worker disconnect + restart (2 independent processes) | concurrency harness S5 | ✅ verified |
| Stale job → needs_review (2 independent processes) | concurrency harness S6 | ✅ verified |
| E2E: seed → upload → pay → claim → complete | `scripts/e2e-staging-flow.sh` | ✅ 34/34 |
| Credential encryption (AES-256-GCM, v1: prefix in DB) | E2E step 1 | ✅ verified in real PG |
| Real X-VERIFY payment signature (sha256 + constant-time) | E2E step 11 (dev simulate uses real crypto) | ✅ verified |
| Webhook idempotency (UNIQUE + cache, real PG) | E2E step 17 (duplicate simulate) | ✅ verified |
| Audit log: received event has NO raw body | E2E step 13 | ✅ verified |
| App logs: no UTR / raw body / CHECKSUMHASH / creds | security scan of dev.log | ✅ verified |

### VERIFIED LOCALLY (in-memory / PGlite — NOT real-infrastructure)

| Item | Test | Result |
|---|---|---|
| Pricing engine (35 tests) | vitest | ✅ 35/35 |
| Repository layer + tenant isolation (11 tests) | vitest | ✅ 11/11 |
| Payment signature verification + idempotency (7 tests) | vitest | ✅ 7/7 |
| Storage HMAC capability signing (7 tests) | vitest | ✅ 7/7 |
| Credential encryption AES-256-GCM (6 tests) | vitest | ✅ 6/6 |
| Durable queue + stale recovery (5 tests) | vitest | ✅ 5/5 |
| Atomic claim (in-memory, 4 tests) | vitest | ✅ 4/4 |
| Container startup validation (8 tests) | vitest | ✅ 8/8 |
| Dev routes 404 in production | code inspection | ✅ verified |
| Production secrets fail-fast | code inspection | ✅ verified |
| Security headers middleware | production build | ✅ compiles |

### BLOCKED — Missing Credentials or Infrastructure

| Item | Missing prerequisite | Exact action needed |
|---|---|---|
| Hosted PostgreSQL migration (Supabase/Neon) | PostgreSQL connection string | Create Supabase/Neon project → set DATABASE_URL → `prisma migrate deploy` → run `scripts/postgres-integration.test.ts` against it |
| R2 upload/download/deletion | R2 account ID + access key + secret + bucket | Set `STORAGE_PROVIDER=r2` + credentials → run E2E flow |
| Upstash Redis set/get/incr/expiry + concurrency | Upstash REST URL + token | Set `CACHE_PROVIDER=redis` + credentials → verify rate limiting + idempotency + outage handling |
| PhonePe sandbox end-to-end | PhonePe sandbox salt key + merchant ID | Set `PHONEPE_SALT_KEY` + merchant ID → complete sandbox payment → verify webhook |
| Paytm sandbox end-to-end | Paytm merchant key + merchant ID | Set `PAYTM_MERCHANT_KEY` + merchant ID → complete sandbox payment → verify callback |
| Production build on Vercel/Render | Deploy account | Push to Vercel/Render → verify build + smoke endpoints |
| Full hosted staging flow (all real infra) | All of the above | Complete all prerequisites, then run the E2E against hosted infra |

### NOT TESTED

| Item | Reason |
|---|---|
| R2 missing-credential runtime failure | Can verify code (constructor throws) but not runtime REST failure |
| Upstash connectivity runtime failure | Can verify code (constructor throws) but not runtime REST failure |
| PhonePe sandbox webhook against real PSP | No sandbox credentials — dev simulate uses real crypto but not the real PSP network |
| Paytm sandbox callback against real PSP | Same as above |
| Full customer-to-payment-to-print-agent workflow on hosted infra | Requires all hosted infra (PG + R2 + Upstash + PSP sandbox) |

### FAILED

None.

---

## 3. Reliability Audit Findings

### Defects found and fixed during this staging validation

| Defect | Severity | Fix | Test |
|---|---|---|---|
| Dev simulate route used `order.id` as `merchantTransactionId`, but checkout stores the session under a fresh `merchantOrderId` UUID — the simulate route could never find the session after a real checkout | HIGH (broke E2E) | Added optional `merchantOrderId` body param to the simulate route; it now accepts the value returned by checkout (which is what PhonePe would echo back) | E2E step 11 now returns `applied=true` |

### Defects found — not fixable without infrastructure

| Defect | Severity | Status |
|---|---|---|
| R2 `head()` swallows all errors (403 indistinguishable from 404) | LOW | Acceptable for "does it exist?" but could hide auth failures. Verify with real R2 creds. |
| `needs_review` audit-log "paid" event stores `utr` (UPI UTR) for reconciliation | LOW (by design) | This is the audit TRAIL's purpose — reconciliation requires the UTR to match bank statements. NOT in app logs. If deemed too sensitive, hash/truncate + store full value in a separate secure vault. |

---

## 4. YouPI-PG Assessment

**Classification: Unsuitable for integration without upstream changes**

| Dimension | Verdict |
|---|---|
| Licensing | ❌ BLOCKER — no LICENSE file |
| Architecture | ❌ Not serverless; requires always-on + Android device |
| Payment verification | ❌ SMS/Gmail parsing — not cryptographically trustworthy |
| Concurrent payments | ❌ Single-active-slot — one payment at a time per VPA |
| Multi-tenant | ❌ Observers are per-deployment |
| Security | ❌ Full SMS access, Gmail inbox access, WhatsApp ToS violation |

See `docs/UPI_YOUPI_FEASIBILITY.md` for the full audit. **Decision preserved:
YouPI-PG is NOT integrated into PrintShop.**

---

## 5. Final Assessment

### PrintShop: **READY FOR LIMITED PRIVATE PILOT**

The codebase passes all local gates (tsc, lint, 83 vitest tests, production
build) AND, as of 2026-10-17, the real-infrastructure database paths are
verified against a disposable PostgreSQL 17.11 server:

- **Schema migration**: 8 tables, 21 indexes, 9 FKs, 4 unique business
  constraints — all applied cleanly to real PostgreSQL.
- **Atomic job claiming**: verified with 2 genuinely independent TCP
  connections (separate bun worker processes, synchronised via LISTEN/NOTIFY).
  Exactly one worker wins a claim for a given job; cross-tenant claims fail;
  duplicate acks are idempotent; stale jobs move to `needs_review` (NO
  automatic reprint).
- **E2E production flow**: 34/34 assertions pass — shop registration (with
  AES-256-GCM encrypted credentials) → JWT login → order creation → real PDF
  upload via HMAC-signed capability → page-count parsing → price computation
  → checkout → REAL X-VERIFY payment signature (sha256 + constant-time
  compare) → order marked paid → PrintJob created → agent claims (atomic
  conditional UPDATE) → agent completes → duplicate simulate is idempotent.
- **Security posture**: zero UTR / raw webhook body / CHECKSUMHASH /
  credentials / personal data in application logs. Audit log stores the
  minimum necessary for reconciliation (txnId + utr in the "paid" event only).

**NOT production-ready** — the following remain BLOCKED on credentials:

1. **Hosted PostgreSQL** (Supabase/Neon) — the user-space PG 17 verifies the
   SQL but not the hosted connection / connection pooling / network latency.
2. **Cloudflare R2** — adapter code is complete and fail-closed; needs real
   credentials to verify upload/download/delete + tenant isolation + capability
   expiry.
3. **Upstash Redis** — adapter code is complete and fail-closed (throws on
   outage, no silent fallback); needs real credentials to verify atomic incr
   under concurrency + expiry + outage handling.
4. **PhonePe/Paytm sandbox** — adapter code uses real crypto (sha256 X-VERIFY
   + constant-time compare for PhonePe, AES-128-CBC CHECKSUMHASH for Paytm);
   the dev simulate route exercises the REAL verification pipeline with real
   crypto, but does NOT test the actual PSP network (HTTP call to PhonePe's
   API, real redirect flow, real webhook delivery).
5. **Production deployment** (Vercel/Render) — build passes locally; needs a
   deploy account to verify the hosted runtime.

### YouPI-PG: **Blocked by licensing and insufficient evidence**

No LICENSE file. Amount-only attribution. Single-active-slot constraint.
SMS/Gmail parsing for verification. Not suitable for a multi-tenant SaaS.
**Decision preserved: NOT integrated.**

### Remaining blockers (priority order)

1. **Hosted PostgreSQL** — set up Supabase/Neon → `prisma migrate deploy` →
   run `scripts/postgres-integration.test.ts` + `scripts/concurrency-harness.test.ts`
   against it.
2. **R2 credentials** — set `STORAGE_PROVIDER=r2` + creds → run the E2E flow.
3. **Upstash credentials** — set `CACHE_PROVIDER=redis` + creds → verify rate
   limiting + idempotency + outage handling.
4. **PhonePe/Paytm sandbox** — set sandbox creds → complete a real sandbox
   payment → verify the real webhook.
5. **Production deploy** — push to Vercel/Render → smoke `/health` `/ready`
   → verify dev routes return 404.

### Exact commands for local verification

```bash
cd /home/z/my-project

# Regression suite (all exit 0)
bun install
bunx tsc --noEmit
bun run lint
bunx vitest run                                          # 83/83 pass
NODE_ENV=production bun ./node_modules/.bin/next build

# Real PostgreSQL staging (requires the user-space PG 17 from §A of STAGING_TESTS.md)
source scripts/pg-env.sh
# Apply the schema:
psql -d printshop_staging -v ON_ERROR_STOP=1 -f tmp/pg_migration.sql
# Integration test (54 assertions):
bun run scripts/postgres-integration.test.ts
# Concurrency test (23 assertions, 2 independent TCP processes):
bun run scripts/concurrency-harness.test.ts
# E2E flow (34 assertions, requires the app running against PostgreSQL):
bash scripts/e2e-staging-flow.sh
```

### Minimum staging checklist for production

```
[ ] NODE_ENV=production
[ ] All secrets generated (openssl rand -hex 32):
    JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REALTIME_EMIT_SECRET,
    STORAGE_CAPABILITY_SECRET, PAYMENT_ENCRYPTION_KEY (base64, 32 bytes)
[ ] schema.prisma: provider = "postgresql"
[ ] DATABASE_URL → PostgreSQL (Supabase/Neon)
[ ] DATABASE_URL=<pg> bunx prisma migrate dev --name init_postgres
[ ] DATABASE_URL=<pg_prod> bunx prisma migrate deploy
[ ] STORAGE_PROVIDER=r2 + R2 credentials
[ ] CACHE_PROVIDER=redis + Upstash URL + token
[ ] REALTIME_PROVIDER=socketio + REALTIME_EMIT_URL
[ ] CORS_ALLOWED_ORIGINS=https://your-domain.com
[ ] TRUSTED_PROXY=1
[ ] NODE_ENV=production bun ./node_modules/.bin/next build
[ ] Smoke: curl …/api/v1/health → {"status":"ok"}
[ ] Smoke: curl …/api/v1/ready → {"ready":true}
[ ] Smoke: curl -X POST …/api/v1/dev/seed → 404
[ ] Verify: 2 agents → create job → both claim → only one wins (concurrency-harness.test.ts)
[ ] Verify: kill agent mid-print → wait 5min → needs_review
[ ] Verify: credential encryption → shop registration → DB paymentCredentials starts with "v1:"
[ ] Verify: duplicate webhook → idempotent (applied=false on 2nd call)
[ ] Verify: app logs have NO UTR / raw body / CHECKSUMHASH / credentials
[ ] Deploy web → Vercel; realtime → Render; agent → shop PC
[ ] k6 run load-test.js --env BASE_URL=<staging_url>
```
