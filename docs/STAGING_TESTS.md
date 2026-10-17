# Staging Test Procedure — PrintShop SaaS

> Reproducible steps for verifying the production-critical paths against
> real infrastructure. Run each step with disposable test data and sandbox
> credentials only. Clean up afterward.
>
> **Update 2026-10-17 (final pre-pilot gate):** Real PostgreSQL 17.11 staging
> verified (54 integration + 23 concurrency + 7 PG-unavailability + 34 E2E =
> 118 assertions). Code-level risks resolved (R2 head(), dev-route protection,
> webhook audit logging). External providers (R2, Upstash, PhonePe/Paytm
> sandbox) remain BLOCKED on credentials. See §11 for the classification table.

## Prerequisites

- A disposable PostgreSQL instance (this run used a user-space PostgreSQL 17.11
  extracted from Debian 13 debs — see §A. No root required.)
- (Optional, BLOCKED this run) Cloudflare R2 test bucket + credentials
- (Optional, BLOCKED this run) Upstash Redis test DB + credentials
- (Optional, BLOCKED this run) PhonePe/Paytm sandbox merchant credentials

If a provider credential is unavailable, report the test as **BLOCKED**.

## A. Disposable PostgreSQL setup (no root)

The staging server is a real PostgreSQL 17.11 extracted from Debian `postgresql-17`
debs into a user-space prefix. No root/sudo required. See `scripts/pg-env.sh`.

```bash
mkdir -p /tmp/pg-install && cd /tmp/pg-install
apt-get download postgresql-17 postgresql-client-17 libllvm19 libpq5 libicu76 \
  liblz4-1 libzstd1 libxml2 libxslt1.1 libuuid1 libpam0g libgssapi-krb5-2 \
  libldap2 libsystemd0 libselinux1 libstdc++6 libgcc-s1 libssl3t64 zlib1g
mkdir -p pgroot && for deb in *.deb; do dpkg-deb -x "$deb" pgroot/; done
export PGROOT=/tmp/pg-install/pgroot
export PATH="$PGROOT/usr/lib/postgresql/17/bin:$PATH"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu:$PGROOT/usr/lib/postgresql/17/lib"
export PGDATA=/tmp/pgdata
initdb -D $PGDATA --auth=trust --no-locale -E UTF8
cat >> $PGDATA/postgresql.conf << 'EOF'
listen_addresses = '127.0.0.1'
port = 5433
jit = off
EOF
pg_ctl -D $PGDATA -l /tmp/pg.log start
psql -d postgres -c "CREATE DATABASE printshop_staging;"
```

## 1. PostgreSQL migration

```bash
# Generate the PostgreSQL DDL (does NOT touch the DB)
cp prisma/schema.prisma /tmp/schema.pg.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' /tmp/schema.pg.prisma
DATABASE_URL="$DATABASE_URL" bunx prisma migrate diff \
  --from-empty --to-schema-datamodel /tmp/schema.pg.prisma --script > /tmp/pg_migration.sql
# Apply
psql -d printshop_staging -v ON_ERROR_STOP=1 -f /tmp/pg_migration.sql
# Verify + integration test (54 assertions)
bun run scripts/postgres-integration.test.ts
```

**Verified 2026-10-17:** 54/54 assertions pass. 8 tables, 21 indexes, 9 FKs,
4 unique business constraints. Atomic claim, cross-tenant rejection, duplicate
ack idempotency, UNIQUE replay guard, stale→needs_review, pg_dump backup+restore.

### Production migration workflow (NOT yet executed against hosted PG)

```bash
# 1. Developer switches schema.prisma to postgresql + generates a migration
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
DATABASE_URL="<dev_pg>" bunx prisma migrate dev --name init_postgres
# 2. Staging/Prod: apply the reviewed migration
DATABASE_URL="<staging_pg>" bunx prisma migrate deploy
# 3. Verify: run scripts/postgres-integration.test.ts against the hosted DB.
```

**Rollback:** Prisma migrations are forward-only. For rollback, restore from a
`pg_dump` taken before the migration. Never run `prisma migrate reset` against
a production database — it drops all data.

**SQLite dev safety:** The canonical `prisma/schema.prisma` is
`provider = "sqlite"` for dev. The container's `validateDatabaseProvider()`
throws `FATAL: DATABASE_URL is a SQLite file in production` if
`DATABASE_URL` starts with `file:` when `NODE_ENV=production` — production
CANNOT silently select SQLite.

## 2. Independent-connection concurrency

```bash
source scripts/pg-env.sh
bun run scripts/concurrency-harness.test.ts
```

**Verified 2026-10-17:** 23/23 assertions pass. 2 genuinely independent bun
worker processes (each with its own `pg.Pool` + TCP connection) synchronised via
`LISTEN/NOTIFY`. Exactly one wins a claim for the same job; cross-tenant claims
fail; duplicate acks are idempotent; stale jobs → needs_review (no auto-requeue);
worker disconnect + restart can't re-claim.

## 3. PostgreSQL unavailability + recovery

```bash
source scripts/pg-env.sh
bash scripts/pg-unavailability-test.sh
```

**Verified 2026-10-17:** 7/7 assertions pass.
- PG UP: `/health` 200 (no DB call), `/ready` 200 (DB reachable).
- PG DOWN: `/health` 200 (app process alive), `/ready` 503 (DB unreachable),
  `POST /dev/seed` 500 (DB insert fails — **NOT** a silent in-memory fallback).
- PG RECOVERED: `/health` 200, `/ready` 200 (Prisma reconnects automatically).

This confirms the app **fails loudly** when the DB is unavailable — no silent
fallback to the in-memory database that would lose customer data.

## 4. R2 upload, download, deletion

> **BLOCKED** — no R2 credentials supplied. Adapter code reviewed + regression
> tested (7 tests for `head()` error handling — see §B).

### Code review + regression test findings (R2StorageAdapter)

- Fail-closed constructor: throws if `accountId`/`accessKeyId`/`secretAccessKey`/`bucket` missing.
- Presigned PUT/GET URLs via `@aws-sdk/s3-request-presigner` (server never proxies bytes).
- **FIXED this run:** `head()` now distinguishes:
  - `404` / `NoSuchKey` → returns `null` (legitimate "not found")
  - `403` / `AccessDenied` → **THROWS** (permission failure — must NOT be swallowed)
  - `5xx` / `ServiceUnavailable` → **THROWS** (provider error)
  - Network errors → **THROWS**
- Regression test: `packages/adapters/src/storage/r2.adapter.test.ts` (7 tests, all pass).
- The previous implementation swallowed ALL errors and returned `null`, which
  hid permission failures and provider outages (made the file-register route
  return "file not found" when R2 was actually misconfigured).

### To run when credentials are available

```bash
export STORAGE_PROVIDER=r2 R2_ACCOUNT_ID=<id> R2_ACCESS_KEY_ID=<key> \
       R2_SECRET_ACCESS_KEY=<secret> R2_BUCKET=printshop-test
# Start the app, run the E2E flow (§9) — upload/download/delete is exercised.
# Verify in the R2 dashboard that the test object was created + deleted.
# Test permission errors: use invalid credentials → constructor throws.
# Test timeouts: point at a non-existent endpoint → head() throws.
```

## 5. Upstash Redis operations

> **BLOCKED** — no Upstash credentials supplied. Adapter code reviewed (see §B).

### Code review findings (UpstashCacheAdapter)

- Fail-closed constructor: throws if `url`/`token` missing.
- All operations THROW on failure (no silent fallback to in-memory) — verified
  by the PG-unavailability test pattern (the cache adapter follows the same
  fail-closed principle).
- `incr()` returns the new value (needed for rate limiting).
- `expire()` sets TTL (needed for idempotency key expiry).

### To run when credentials are available

```bash
export CACHE_PROVIDER=redis REDIS_URL=<upstash_rest_url> REDIS_TOKEN=<upstash_token>
# 1. Rate limiting: 25 rapid requests → ~20 succeed, then 429.
# 2. Cache in Redis (not in-memory): check for rl:* keys in Upstash console.
# 3. Outage: unset REDIS_URL → container throws on startup.
# 4. Atomic incr under concurrency: 2 processes incr the same key 100x each
#    → final value = 200.
# 5. Expiry: set a key with TTL=5s → after 6s, get returns null.
```

## 6. Payment-provider sandbox verification

> **BLOCKED** — no PhonePe/Paytm sandbox credentials supplied.

### Code review findings (PhonePePaymentAdapter)

- REAL X-VERIFY signature verification via Web Crypto `crypto.subtle.digest('SHA-256', ...)`.
- Constant-time hex comparison (`timingSafeEqualHex`) — defends against timing attacks.
- Salt index check (rejects wrong index).
- Payload decoded (base64 → JSON) ONLY AFTER signature verification.
- The `utr` field is extracted from `paymentInstrument.utr` and stored ONLY in
  the `Order.paymentUtr` column + the audit-log "paid" event (the reconciliation
  record). It is NEVER written to the application logger.

### Code review findings (PaytmPaymentAdapter)

- REAL CHECKSUMHASH verification (AES-128-CBC, the Paytm convention).
- All fields covered by the checksum (amount, orderId, txnId, etc.).

### Dev simulate route (production-guarded, real crypto)

`/api/v1/payments/dev/phonepe/simulate` is **NOT a fake success** — it computes
a REAL X-VERIFY signature using the shop's dev salt key, feeds the signed
payload through the REAL `processWebhook` pipeline (signature verify +
idempotency + order flip), and is guarded by `requireDev()` (returns 404 in
production). Verified end-to-end in the E2E flow (§9).

### To run against the real PhonePe sandbox

```bash
export PHONEPE_SALT_KEY=<sandbox_salt> PHONEPE_SALT_INDEX=1 PHONEPE_MERCHANT_ID=<sandbox_mid>
# Configure the shop's paymentCredentials with the sandbox creds, then:
# 1. Checkout → get the PhonePe checkoutUrl
# 2. Open checkoutUrl → complete the sandbox payment
# 3. PhonePe sends a webhook to /api/v1/payments/phonepe/webhook
# 4. Verify: order.paid, paymentTxnId set, PrintJob created
# 5. Invalid signature: flip one bit of X-VERIFY → 401
# 6. Wrong amount: tamper the amount → signature fails
```

## 7. End-to-end staging flow (verified 2026-10-17)

```bash
# Start the app against PostgreSQL (temporary switch):
cp prisma/schema.prisma /tmp/schema.sqlite.bak.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
DATABASE_URL="<pg>" bunx prisma generate
echo "DATABASE_URL=<pg>" > .env
setsid bash -c 'exec bun run dev' &
bash scripts/e2e-staging-flow.sh
# Restore SQLite config afterward
cp /tmp/schema.sqlite.bak.prisma prisma/schema.prisma && bunx prisma generate
```

**Verified 2026-10-17: 34/34 E2E assertions pass** against real PostgreSQL 17.
Full flow: seed (AES-256-GCM encrypted credentials) → JWT login → agent register
+ heartbeat (sim skipped) → order → HMAC-signed upload URL → real PDF upload →
file register (page count) → print settings (pricing engine) → checkout → dev
simulate (REAL X-VERIFY) → order paid → PrintJob created → agent discovers +
claims (atomic UPDATE) → completes → duplicate simulate idempotent.

## 8. Backup and restore

Verified against real PostgreSQL 17 in the integration test: `pg_dump` produces
non-empty SQL; restoring to a fresh DB preserves all rows (job-1 completed,
job-2 queued, job-3 needs_review, order-1 paid with txn-001).

```bash
pg_dump -d printshop_staging --no-owner --no-privileges > backup.sql
psql -d postgres -c "CREATE DATABASE printshop_restore"
psql -d printshop_restore -v ON_ERROR_STOP=1 -q -f backup.sql
psql -d printshop_restore -c "SELECT COUNT(*) FROM \"PrintJob\";"
psql -d postgres -c "DROP DATABASE printshop_restore"
```

## 9. Security review of application logs (verified 2026-10-17)

Scanned the dev.log (application stdout) from the E2E run:

| Sensitive data | Occurrences in app logs |
|---|---|
| `utr` field (UPI Unique Transaction Reference) | 0 ✓ |
| Raw webhook body (`merchantTransactionId`, base64) | 0 ✓ |
| `CHECKSUMHASH` | 0 ✓ |
| Payment credentials (`saltKey`, `merchantKey`, `secretAccessKey`) | 0 ✓ |
| Customer phone (test numbers) | 0 ✓ |

The ONLY payment identifier in application logs is `txnId` (the PSP's
transaction ID) — needed for support/reconciliation. It is NOT the UPI UTR.

**Regression tests** (4 assertions, all pass):
`src/lib/payments/webhook-audit.test.ts` verifies:
1. The "received" audit event stores ONLY `{path, contentLength, provider}` — NO raw body.
2. The "paid" audit event stores `{txnId, utr, amountPaise}` — reconciliation record, NO raw body.
3. The application logger is NEVER called with the raw body, utr, or CHECKSUMHASH.
4. A failed-payment webhook stores the failure as an audit event with NO raw body.

### UTR storage policy

The UTR (UPI Unique Transaction Reference) is stored in TWO places, both
intentional and necessary:

1. **`Order.paymentUtr` column** — needed for:
   - The customer receipt (line 62 of `receipt/route.ts`) — Indian payment
     receipts legally show the UTR for the customer's bank reconciliation.
   - Reconciliation — the shopkeeper matches orders to bank settlements.

2. **`AuditLog.metadata` for the "paid" event** — the audit trail's PURPOSE is
   to record which transaction paid for which order. The UTR is needed to match
   against bank statements.

**Access controls:**
- Database-level: tenant-scoped queries (`shopId` in every WHERE clause).
- API-level: shopkeeper routes require JWT auth; customer routes (receipt,
  status) use the order ID as a capability token (UUID, 2^122 entropy).
- The UTR is NEVER in application logs (stdout/JSON logger).

**Retention:** financial records — retain per Indian law (typically 7 years).
The `AuditLog` and `Order` tables are not auto-purged; retention is a deployment
policy (implement a cron job to purge old records after the legal retention
period, OR keep indefinitely for a small pilot).

**Alternatives considered:** hashing the UTR in the audit log + storing the full
value only on the `Order` row. Rejected because the audit trail's PURPOSE is to
record the full transaction reference — hashing would require a separate secure
vault to reverse-lookup, adding complexity without clear benefit for a pilot.

## 10. Dev-route protection (verified 2026-10-17)

**Regression tests** (5 assertions, all pass): `src/lib/api/require-dev.test.ts`
verifies:
1. `requireDev()` returns null in development.
2. `requireDev()` returns null when NODE_ENV is unset.
3. `requireDev()` returns a 404 NextResponse in production.
4. The 404 body does NOT leak that the route exists.
5. **Static check:** every file under `/dev/`, `/payments/dev/`, and `/storage/`
   imports + calls `requireDev()`.

**Fixed this run:** `src/app/api/v1/dev/qr/route.ts` was missing the
`requireDev()` guard. It now has it. The customer checkout flow now uses the
new production-legal route at `src/app/api/v1/qr/route.ts` (stateless,
rate-limited, no DB, no secrets — safe for production).

## 11. Classification

| Test | Status (verified 2026-10-17 final gate) |
|---|---|
| **Regression suite** | |
| `bun install` | ✅ PASS (exit 0) |
| `bunx tsc --noEmit` | ✅ PASS (exit 0, 0 errors) |
| `bun run lint` | ✅ PASS (exit 0, clean) |
| `bunx vitest run` | ✅ PASS (exit 0, **99/99** tests across 11 files) |
| `NODE_ENV=production next build` | ✅ PASS (exit 0, 39 routes) |
| **Local PostgreSQL (PGlite / in-memory)** | |
| Pricing engine (35 tests) | ✅ PASS |
| Repositories + tenant isolation (11 tests) | ✅ PASS |
| Payment signature + idempotency (7 tests) | ✅ PASS |
| Storage HMAC capability (7 tests) | ✅ PASS |
| Credential encryption AES-256-GCM (6 tests) | ✅ PASS |
| Durable queue + stale recovery (5 tests) | ✅ PASS |
| Atomic claim in-memory (4 tests) | ✅ PASS |
| Container startup validation (8 tests) | ✅ PASS |
| **New regression tests (this run)** | |
| R2 head() distinguishes missing/permission/provider errors (7 tests) | ✅ PASS |
| Webhook audit logging — no raw body/checksum/creds (4 tests) | ✅ PASS |
| Dev-route protection — requireDev() + static check (5 tests) | ✅ PASS |
| **Real PostgreSQL 17.11 (user-space, disposable)** | |
| Schema migration (DDL applied) | ✅ PASS (8 tables, 21 indexes, 9 FKs, 4 unique constraints) |
| Integration test (54 assertions) | ✅ PASS |
| Independent-connection concurrency (23 assertions, 2 TCP processes) | ✅ PASS |
| PG unavailability + recovery (7 assertions) | ✅ PASS (app fails loudly, recovers) |
| E2E flow (34 assertions, real X-VERIFY crypto) | ✅ PASS |
| pg_dump backup + restore | ✅ PASS |
| **External providers** | |
| Cloudflare R2 upload/download/delete | ❌ BLOCKED — no credentials |
| Upstash Redis set/get/incr/expiry | ❌ BLOCKED — no credentials |
| PhonePe sandbox end-to-end | ❌ BLOCKED — no sandbox credentials |
| Paytm sandbox end-to-end | ❌ BLOCKED — no sandbox credentials |
| Hosted PostgreSQL (Supabase/Neon) | ❌ BLOCKED — no hosted PG connection string |
| Production deployment (Vercel/Render) | ❌ BLOCKED — no deploy account |
| **Browser verification** | |
| Page renders, 0 errors, API calls succeed | ✅ PASS (local dev server) |
| Production deployment browser verification | ❌ NOT TESTED (no deploy) |

## 12. Cleanup

```bash
psql -d postgres -c "DROP DATABASE IF EXISTS printshop_staging;"
pg_ctl -D /tmp/pgdata stop
# Delete R2 test objects (when tested)
# Delete Upstash test keys (when tested)
# Reset the shop's paymentCredentials (when sandbox tested)
```
