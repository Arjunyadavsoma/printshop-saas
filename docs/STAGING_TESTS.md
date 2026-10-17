# Staging Test Procedure — PrintShop SaaS

> Reproducible steps for verifying the production-critical paths against
> real infrastructure. Run each step with disposable test data and sandbox
> credentials only. Clean up afterward.
>
> **Update 2026-10-17 — Real PostgreSQL staging validation executed.**
> A disposable PostgreSQL 17.11 server was installed in user-space (no root)
> and used to verify the full database + concurrency + E2E flows. See
> §9 for the verified results table.

## Prerequisites

- A disposable PostgreSQL instance (this run used a user-space PostgreSQL 17.11
  extracted from Debian 13 debs — see §A. No root required.)
- (Optional, BLOCKED this run) Cloudflare R2 test bucket + credentials
- (Optional, BLOCKED this run) Upstash Redis test DB + credentials
- (Optional, BLOCKED this run) PhonePe/Paytm sandbox merchant credentials

If a provider credential is unavailable, report the test as **BLOCKED**.

## A. Disposable PostgreSQL setup (no root)

The staging server is a real PostgreSQL 17.11 extracted from Debian `postgresql-17`
debs into a user-space prefix. No root/sudo required.

```bash
# Download + extract (no root)
mkdir -p /tmp/pg-install && cd /tmp/pg-install
apt-get download postgresql-17 postgresql-client-17 libllvm19 libpq5 libicu76 \
  liblz4-1 libzstd1 libxml2 libxslt1.1 libuuid1 libpam0g libgssapi-krb5-2 \
  libldap2 libsystemd0 libselinux1 libstdc++6 libgcc-s1 libssl3t64 zlib1g
mkdir -p pgroot && for deb in *.deb; do dpkg-deb -x "$deb" pgroot/; done

# Set up env (saved at scripts/pg-env.sh)
export PGROOT=/tmp/pg-install/pgroot
export PATH="$PGROOT/usr/lib/postgresql/17/bin:$PATH"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu:$PGROOT/usr/lib/postgresql/17/lib:${LD_LIBRARY_PATH:-}"
export PGDATA=/tmp/pgdata
export PGHOST=127.0.0.1
export PGPORT=5433
export PGUSER=z  # initdb makes the OS user the superuser
export DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_staging?schema=public"

# Initialize + start (trust auth on loopback — disposable, single-host ONLY)
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
# Generate the PostgreSQL DDL from the canonical schema (does NOT touch the DB)
cp prisma/schema.prisma /tmp/schema.pg.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' /tmp/schema.pg.prisma
DATABASE_URL="$DATABASE_URL" bunx prisma migrate diff \
  --from-empty --to-schema-datamodel /tmp/schema.pg.prisma --script > /tmp/pg_migration.sql

# Apply to the staging DB
psql -d printshop_staging -v ON_ERROR_STOP=1 -f /tmp/pg_migration.sql

# Verify tables (expected 8: Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog)
psql -d printshop_staging -c "\dt"

# Verify indexes (21 total: 8 pkey + 4 unique business + 9 composite)
psql -d printshop_staging -c "\di"

# Verify foreign keys (9 total — AuditLog has 2: shopId + userId)
psql -d printshop_staging -c "SELECT tc.table_name, kcu.column_name, ccu.table_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name;"

# Run the integration test (54 assertions)
bun run scripts/postgres-integration.test.ts
```

**Verified 2026-10-17:** 54/54 assertions pass against real PostgreSQL 17.11.
Tables, indexes, FKs, unique constraints, atomic claim, cross-tenant rejection,
duplicate ack idempotency, UNIQUE replay guard, stale→needs_review, pg_dump
backup+restore — all verified.

### Production migration workflow (NOT yet executed against hosted PG)

For a real Supabase/Neon deployment:

```bash
# 1. Developer: switch schema.prisma to postgresql, generate a migration
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
DATABASE_URL="<dev_pg>" bunx prisma migrate dev --name init_postgres
# Review the generated migration SQL, commit it.

# 2. Staging/Prod: apply the reviewed migration
DATABASE_URL="<staging_pg>" bunx prisma migrate deploy

# 3. Verify: run scripts/postgres-integration.test.ts against the hosted DB.
```

**Rollback:** Prisma migrations are forward-only by design. For rollback, use
`pg_dump` taken before the migration and restore to a fresh DB. Never run
`prisma migrate reset` against a production database — it drops all data.

## 2. Two independent workers claiming one job concurrently

This is verified via `scripts/concurrency-harness.test.ts` which spawns
**genuinely independent bun worker processes** (each with its own `pg.Pool` and
its own TCP connection to PostgreSQL), synchronised via `LISTEN/NOTIFY`.

```bash
source scripts/pg-env.sh
bun run scripts/concurrency-harness.test.ts
```

**Verified 2026-10-17:** 23/23 assertions pass against real PostgreSQL 17.11
with 2 independent TCP connections:

| Scenario | Result |
|---|---|
| S1. Two workers claim the SAME job — exactly one wins | ✓ PASS (one returns 1 row, the other 0) |
| S2. Two workers claim DIFFERENT jobs — both win | ✓ PASS |
| S3. Cross-tenant claim (wrong shopId) — fails | ✓ PASS (0 rows, job untouched) |
| S4. Duplicate completion ack — exactly one succeeds | ✓ PASS (one 1-row, one 0-row) |
| S5. Worker disconnect mid-claim + restart — job stays in last state | ✓ PASS (restarted worker can't re-claim) |
| S6. Stale printing → needs_review (NO auto-requeue) | ✓ PASS (fresh worker can't claim needs_review) |

The atomic guard is the conditional `UPDATE "PrintJob" SET status='printing'
WHERE id=$1 AND status='queued' AND "shopId"=$2 RETURNING ...` — exactly one
worker's UPDATE matches the `status='queued'` predicate; the other's WHERE
clause no longer matches.

**NOTE on PGlite:** PGlite is real PostgreSQL SQL (WASM) but is
single-connection, so it CANNOT verify independent-connection concurrency.
The concurrency harness above uses 2 separate `bun` processes with 2 separate
TCP connections to a real PostgreSQL 17 server — this is genuine
independent-connection concurrency.

## 3. Concurrent duplicate payment webhooks

Verified in the E2E flow (§6, step 17): a duplicate `dev/phonepe/simulate` call
with the same `merchantOrderId` returns `applied=false` (idempotent), and the
order is not corrupted. The UNIQUE constraint on `Order.paymentTxnId` is the
final replay guard — a concurrent duplicate would violate it and be caught by
the `catch` block in `processWebhook` (line 212-223 of webhook.service.ts).

For hosted PG, run 2 concurrent `curl` calls to the simulate route and verify
exactly one returns `applied=true`.

## 4. R2 upload, download, deletion

> **BLOCKED** — no R2 credentials supplied. Adapter code reviewed (see §B).

### Code review findings (R2StorageAdapter)

- Fail-closed constructor: throws if `accountId`/`accessKeyId`/``secretAccessKey`/`bucket` missing.
- Uses `@aws-sdk/client-s3` pointed at R2's S3-compatible endpoint.
- Presigned PUT/GET URLs (server never proxies bytes) via `@aws-sdk/s3-request-presigner`.
- `head()` swallows all errors and returns `null` — this is a LOW-severity concern: a 403 Forbidden is indistinguishable from a 404 Not Found. For staging, verify `head()` returns null for missing keys AND for invalid credentials (both return null, which is acceptable for the "does it exist?" use case but could hide auth failures).

### To run when credentials are available

```bash
export STORAGE_PROVIDER=r2
export R2_ACCOUNT_ID=<id>
export R2_ACCESS_KEY_ID=<key>
export R2_SECRET_ACCESS_KEY=<secret>
export R2_BUCKET=printshop-test
# Start the app, then run the E2E flow (§6) — file upload/download/delete
# is exercised end-to-end. Verify in the R2 dashboard that the test object
# was created and deleted.
```

## 5. Upstash Redis operations

> **BLOCKED** — no Upstash credentials supplied. Adapter code reviewed (see §B).

### Code review findings (UpstashCacheAdapter)

- Fail-closed constructor: throws if `url`/`token` missing.
- All operations THROW on failure (no silent fallback to in-memory) — rate
  limits and idempotency do NOT silently no-op when Redis is down. A Redis
  outage returns 502, not a security-bypassing default-allow.
- `incr()` returns the new value (needed for rate limiting).
- `expire()` sets TTL (needed for idempotency key expiry).

### To run when credentials are available

```bash
export CACHE_PROVIDER=redis
export REDIS_URL=<upstash_rest_url>
export REDIS_TOKEN=<upstash_token>
# Start the app, then:
# 1. Verify rate limiting: 25 rapid requests → ~20 succeed, then 429.
# 2. Verify cache is in Redis (not in-memory): check for rl:* keys in the
#    Upstash console.
# 3. Verify outage handling: unset REDIS_URL → container throws on startup
#    (UpstashCacheAdapter constructor).
# 4. Atomic incr under concurrency: 2 processes incr the same key 100x each
#    → final value = 200 (not 100 or some race-corrupted number).
```

## 6. Agent disconnection, restart, stale-job recovery

Verified end-to-end against real PostgreSQL 17 in the E2E flow (§9, step 15-16):
the agent claims the job (atomic conditional UPDATE → printing), then completes
it. The concurrency harness (§2, scenario S5) verifies that a worker crash
mid-claim leaves the job in `printing` state and a restarted worker cannot
re-claim it.

For the full 5-minute stale-recovery test against hosted PG:

```bash
# 1. Register agent + heartbeat (online)
# 2. Create + pay an order → PrintJob created as 'queued'
# 3. Agent claims the job (status='printing', agentId set)
# 4. Kill the agent (simulates crash)
# 5. Wait 5+ minutes
# 6. Restart the app — recoverStaleJobsOnStartup() runs and moves the
#    stale 'printing' job to 'needs_review'
# 7. Verify: SELECT status FROM "PrintJob" WHERE id=...; → 'needs_review'
#    (NOT 'queued' — no automatic reprint)
```

## 7. Payment-provider sandbox verification

> **BLOCKED** — no PhonePe/Paytm sandbox credentials supplied.

### Code review findings (PhonePePaymentAdapter)

- REAL X-VERIFY signature verification via Web Crypto `crypto.subtle.digest('SHA-256', ...)`.
- Constant-time hex comparison (`timingSafeEqualHex`) — defends against timing attacks.
- Salt index check (rejects wrong index).
- Payload is decoded (base64 → JSON) ONLY AFTER signature verification.
- The `utr` field is extracted from `paymentInstrument.utr` (UPI bank-side ID)
  and stored ONLY in the audit-log "paid" event (the reconciliation record).
  It is NEVER written to the application logger.

### Code review findings (PaytmPaymentAdapter)

- REAL CHECKSUMHASH verification (AES-128-CBC, the Paytm convention).
- All fields covered by the checksum (amount, orderId, txnId, etc.).

### Dev simulate route (production-guarded)

The `/api/v1/payments/dev/phonepe/simulate` route is **NOT a fake success** —
it computes a REAL X-VERIFY signature using the shop's dev salt key, feeds the
signed payload through the REAL `processWebhook` pipeline (signature verify +
idempotency + order flip), and is guarded by `requireDev()` (returns 404 in
`NODE_ENV=production`). This was verified end-to-end in the E2E flow (§9).

### To run against the real PhonePe sandbox

```bash
export PHONEPE_SALT_KEY=<sandbox_salt>
export PHONEPE_SALT_INDEX=1
export PHONEPE_MERCHANT_ID=<sandbox_mid>
# Configure the shop's paymentCredentials with the sandbox creds, then:
# 1. Checkout → get the PhonePe checkoutUrl
# 2. Open checkoutUrl in a browser → complete the sandbox payment
# 3. PhonePe sends a webhook to /api/v1/payments/phonepe/webhook
# 4. Verify: order.paid, paymentTxnId set, PrintJob created
# 5. Invalid signature test: flip one bit of the X-VERIFY header → 401
# 6. Wrong amount test: tamper the amount in the payload → signature fails
```

## 8. Backup and restore

Verified against real PostgreSQL 17 in the integration test (§1, assertion 8):
`pg_dump` produces non-empty SQL containing CREATE TABLE + PrintJob rows;
restoring to a fresh DB preserves all rows (job-1 completed, job-2 queued,
job-3 needs_review, order-1 paid with txn-001).

```bash
# Backup
pg_dump -d printshop_staging --no-owner --no-privileges > backup.sql
# Restore to a disposable DB
psql -d postgres -c "CREATE DATABASE printshop_restore"
psql -d printshop_restore -v ON_ERROR_STOP=1 -q -f backup.sql
# Verify
psql -d printshop_restore -c "SELECT COUNT(*) FROM \"PrintJob\";"
# Cleanup
psql -d postgres -c "DROP DATABASE printshop_restore"
```

## 9. End-to-end staging flow (verified 2026-10-17)

`scripts/e2e-staging-flow.sh` exercises the full production stack against real
PostgreSQL 17.11. The dev simulate route uses REAL sha256 X-VERIFY crypto
(constant-time compare) — not a fake success.

```bash
# Start the app against PostgreSQL (temporary switch):
cp prisma/schema.prisma /tmp/schema.sqlite.bak.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
DATABASE_URL="<pg>" bunx prisma generate
echo "DATABASE_URL=<pg>" > .env
setsid bash -c 'exec bun run dev' &  # detached so it survives the shell
# Wait for ready, then:
bash scripts/e2e-staging-flow.sh
# Restore SQLite config afterward:
cp /tmp/schema.sqlite.bak.prisma prisma/schema.prisma
bunx prisma generate  # regenerate for SQLite
```

**Verified 2026-10-17: 34/34 E2E assertions pass** against real PostgreSQL 17:

| Step | Assertion | Result |
|---|---|---|
| 1 | Demo shop + owner created in PostgreSQL | ✓ |
| 1 | paymentCredentials AES-256-GCM encrypted (v1: prefix) | ✓ |
| 2 | JWT access token (HS256, PBKDF2 verify) | ✓ |
| 3 | Print agent registered + device token issued (hash stored) | ✓ |
| 4 | Agent isOnline=true (in-process sim skipped) | ✓ |
| 5 | Order created, status=awaiting_payment in PostgreSQL | ✓ |
| 6 | Upload URL minted (HMAC-signed capability) | ✓ |
| 7 | Real PDF (963 bytes) uploaded via signed capability (HTTP 200) | ✓ |
| 8 | File registered + page count = 1 (pdf-lib) | ✓ |
| 9 | Price = 500 paise (pricing engine); order total updated | ✓ |
| 10 | Checkout done; merchantOrderId stored in payment session | ✓ |
| 11 | Payment applied via REAL X-VERIFY (sha256 + constant-time compare) | ✓ |
| 12 | Order status = paid→printing; paymentTxnId set; paidAt set | ✓ |
| 12 | PrintJob created as 'queued' (sim skipped because agent online) | ✓ |
| 13 | Audit log: paid event has txnId (reconciliation record) | ✓ |
| 13 | Received event = {path, contentLength, provider} — NO raw body | ✓ |
| 13 | No raw webhook body / CHECKSUMHASH / merchantTxnId in audit logs | ✓ |
| 13 | Application logs have NO UTR field | ✓ |
| 14 | Agent discovered 1 pending job (tenant-scoped query) | ✓ |
| 15 | Agent claimed the job (atomic conditional UPDATE → printing) | ✓ |
| 16 | Agent completed the job | ✓ |
| 17 | Duplicate simulate idempotent (applied=false, order already paid) | ✓ |
| 17 | Order still in valid state (not corrupted by duplicate) | ✓ |
| 17 | Exactly one PrintJob (no duplicate job creation) | ✓ |

## 10. Security review of application logs (verified 2026-10-17)

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

**Audit log (database AuditLog table) nuance:** the "paid" event stores
`{txnId, utr, amountPaise}`. This is the canonical reconciliation record —
the audit trail's PURPOSE is to record which transaction paid for which order,
and the UTR is needed to match against bank statements. This is intentional
and necessary; it is NOT the application log. If full UTR storage in the audit
trail is deemed too sensitive, it could be hashed/truncated, but reconciliation
would then require a separate secure store.

## 11. Regression suite (verified 2026-10-17)

```bash
cd /home/z/my-project
bun install                                              # exit 0
bunx tsc --noEmit                                        # exit 0, 0 errors
bun run lint                                             # exit 0, clean
bunx vitest run                                          # exit 0, 83/83 pass
NODE_ENV=production bun ./node_modules/.bin/next build   # exit 0
```

## Classification

| Test | Status (verified 2026-10-17) |
|---|---|
| PostgreSQL migration (DDL applied to real PG 17) | ✅ PASS — 54/54 integration assertions |
| Schema integrity (8 tables, 21 indexes, 9 FKs, 4 unique business constraints) | ✅ PASS — verified in real PG |
| Concurrent worker claim (2 independent TCP processes) | ✅ PASS — 23/23 concurrency assertions |
| Cross-tenant claim rejection | ✅ PASS |
| Duplicate completion ack idempotency | ✅ PASS |
| Stale printing → needs_review (NO auto-requeue) | ✅ PASS |
| needs_review blocks agent claim | ✅ PASS |
| pg_dump backup + restore round-trip | ✅ PASS |
| Atomic claim SQL behaviour (PGlite single-conn) | ✅ PASS (NOT counted for concurrency) |
| E2E flow (seed → upload → pay → claim → complete) | ✅ PASS — 34/34 assertions against real PG |
| Credential encryption (AES-256-GCM, v1: prefix) | ✅ PASS — verified in E2E |
| Real X-VERIFY payment signature (sha256 + constant-time) | ✅ PASS — verified via dev simulate (real crypto) |
| Webhook idempotency (UNIQUE + cache) | ✅ PASS — duplicate simulate is no-op |
| Audit log: received event has no raw body | ✅ PASS |
| App logs: no UTR / raw body / CHECKSUMHASH / credentials | ✅ PASS |
| R2 upload/download/deletion | ❌ BLOCKED — no R2 credentials |
| Upstash Redis set/get/incr/expiry | ❌ BLOCKED — no Upstash credentials |
| PhonePe sandbox end-to-end | ❌ BLOCKED — no sandbox credentials |
| Paytm sandbox end-to-end | ❌ BLOCKED — no sandbox credentials |
| Hosted PostgreSQL migration (Supabase/Neon) | ❌ BLOCKED — no hosted PG connection string |
| Production build on Vercel/Render | ❌ BLOCKED — no deploy account |

## Cleanup

After all tests:

```bash
# Drop the staging database (do NOT do this against production)
psql -d postgres -c "DROP DATABASE IF EXISTS printshop_staging;"

# Stop the user-space PostgreSQL server
pg_ctl -D /tmp/pgdata stop

# Delete R2 test objects (when tested)
# Delete Upstash test keys (when tested)
# Reset the shop's paymentCredentials (when sandbox tested)
```
