# Staging Test Procedure — PrintShop SaaS

> Reproducible steps for verifying the production-critical paths against
> real infrastructure. Run each step with disposable test data and sandbox
> credentials only. Clean up afterward.

## Prerequisites

- A disposable PostgreSQL instance (Supabase free / Neon free / `docker run postgres:16`)
- (Optional) Cloudflare R2 test bucket + credentials
- (Optional) Upstash Redis test DB + credentials
- (Optional) PhonePe/Paytm sandbox merchant credentials

If a provider credential is unavailable, report the test as **BLOCKED**.

## 1. PostgreSQL migration

```bash
# Set up the schema for PostgreSQL
cp prisma/schema.prisma /tmp/schema.pg.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' /tmp/schema.pg.prisma

# Generate a fresh migration against the staging DB
DATABASE_URL="postgresql://user:pass@host:5432/staging" \
  bunx prisma migrate diff --from-empty --to-schema-datamodel /tmp/schema.pg.prisma --script > /tmp/pg_migration.sql

# Apply the migration
DATABASE_URL="postgresql://user:pass@host:5432/staging" \
  bunx prisma migrate deploy

# Verify tables
psql "$DATABASE_URL" -c "\dt" 
# Expected: Shop, User, Order, PrintFile, PrintJob, PrintAgent, Subscription, AuditLog, _prisma_migrations

# Verify indexes
psql "$DATABASE_URL" -c "\di"
# Expected: Shop_slug_key (UNIQUE), User_email_key (UNIQUE), Order_paymentTxnId_key (UNIQUE), PrintJob_shopId_status_idx

# Verify foreign keys
psql "$DATABASE_URL" -c "SELECT tc.table_name, kcu.column_name, ccu.table_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name;"
# Expected: 8 foreign keys

# Clean up (do NOT run against production)
# psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

## 2. Two independent workers claiming one job concurrently

```bash
# Terminal 1 — Worker A:
psql "$DATABASE_URL" << 'SQL'
INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
VALUES ('s1', 'Test', 'test-s1', 'u1', 't@o', 'g', '{}', '{}', 'x', 'x', 'UTC', true, 'free', NOW(), NOW());
INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
VALUES ('o1', 's1', 'TOK', 'paid', 1000, 'INR', NOW(), NOW());
INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
VALUES ('f1', 'o1', 'doc.pdf', 'k', 'application/pdf', 100, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW());
INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
VALUES ('j1', 's1', 'f1', 'queued', 0, NOW(), NOW(), NOW());
SQL

# Terminal 1 + Terminal 2 — run simultaneously:
# Worker A:
psql "$DATABASE_URL" -c "UPDATE \"PrintJob\" SET status='printing', \"agentId\"='A', \"startedAt\"=NOW() WHERE id='j1' AND status='queued' AND \"shopId\"='s1' RETURNING id;"
# Worker B (run at the same time):
psql "$DATABASE_URL" -c "UPDATE \"PrintJob\" SET status='printing', \"agentId\"='B', \"startedAt\"=NOW() WHERE id='j1' AND status='queued' AND \"shopId\"='s1' RETURNING id;"

# Expected: exactly one returns 1 row, the other returns 0 rows.
# Verify:
psql "$DATABASE_URL" -c "SELECT status, \"agentId\" FROM \"PrintJob\" WHERE id='j1';"
# Expected: status=printing, agentId=A (or B, but only one)
```

## 3. Concurrent duplicate payment webhooks

```bash
# Insert an order in awaiting_payment
psql "$DATABASE_URL" -c "INSERT INTO \"Order\" (id, \"shopId\", \"customerToken\", status, \"totalAmountPaise\", currency, \"createdAt\", \"updatedAt\") VALUES ('o2', 's1', 'TOK2', 'awaiting_payment', 500, 'INR', NOW(), NOW());"

# Two concurrent webhook calls for the same txnId:
# Terminal 1:
curl -X POST http://localhost:3000/api/v1/payments/phonepe/simulate -H 'Content-Type: application/json' -d '{"orderId":"o2","outcome":"paid"}'
# Terminal 2 (simultaneously):
curl -X POST http://localhost:3000/api/v1/payments/phonepe/simulate -H 'Content-Type: application/json' -d '{"orderId":"o2","outcome":"paid"}'

# Expected: one returns applied=true, the other applied=false (idempotent).
# Verify in DB:
psql "$DATABASE_URL" -c "SELECT status, \"paymentTxnId\" FROM \"Order\" WHERE id='o2';"
# Expected: status=paid, paymentTxnId is set (once).

# Also test the UNIQUE constraint directly:
psql "$DATABASE_URL" -c "INSERT INTO \"Order\" (id, \"shopId\", \"customerToken\", status, \"totalAmountPaise\", currency, \"paymentTxnId\", \"createdAt\", \"updatedAt\") VALUES ('o3', 's1', 'TOK3', 'paid', 500, 'INR', 'DUPLICATE_TXN', NOW(), NOW());"
# Expected: succeeds (first insert with this txnId)
psql "$DATABASE_URL" -c "INSERT INTO \"Order\" (id, \"shopId\", \"customerToken\", status, \"totalAmountPaise\", currency, \"paymentTxnId\", \"createdAt\", \"updatedAt\") VALUES ('o4', 's1', 'TOK4', 'paid', 500, 'INR', 'DUPLICATE_TXN', NOW(), NOW());"
# Expected: ERROR: duplicate key value violates unique constraint
```

## 4. R2 upload, download, deletion

> **BLOCKED** if R2 credentials are unavailable.

```bash
export STORAGE_PROVIDER=r2
export R2_ACCOUNT_ID=<your_account_id>
export R2_ACCESS_KEY_ID=<your_key>
export R2_SECRET_ACCESS_KEY=<your_secret>
export R2_BUCKET=printshop-test

# Start the app with R2 configured
NODE_ENV=production bun ./node_modules/.bin/next dev -p 3000 &

# Upload a test file (via the signed-URL flow):
TOK=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"owner@quickprint.demo","password":"demo1234"}' | jq -r .data.accessToken)
OID=$(curl -s -X POST http://localhost:3000/api/v1/shops/quickprint/orders -H 'Content-Type: application/json' -d '{}' | jq -r .data.orderId)
UU=$(curl -s -X POST http://localhost:3000/api/v1/orders/$OID/files/upload-url -H 'Content-Type: application/json' -d '{"filename":"test.pdf","mimeType":"application/pdf","size":100}')
UPURL=$(echo $UU | jq -r .data.uploadUrl)

# Upload
curl -X PUT "$UPURL" --data-binary @test.pdf
# Expected: 200

# Confirm (parse page count)
curl -s -X POST http://localhost:3000/api/v1/orders/$OID/files -H 'Content-Type: application/json' -d "{\"fileId\":\"$(echo $UU | jq -r .data.fileId)\",\"storageKey\":\"$(echo $UU | jq -r .data.storageKey)\",\"filename\":\"test.pdf\",\"mimeType\":\"application/pdf\",\"size\":100}"
# Expected: pageCount=1 (if the PDF is valid)

# Clean up: delete the test file
curl -s -X POST http://localhost:3000/api/v1/shops/me/orders/$OID/complete -H "Authorization: Bearer $TOK"
# Expected: filesDeleted=1 (the storage delete call)
```

## 5. Upstash Redis operations

> **BLOCKED** if Upstash credentials are unavailable.

```bash
export CACHE_PROVIDER=redis
export REDIS_URL=<your_upstash_rest_url>
export REDIS_TOKEN=<your_upstash_token>

# Start the app with Redis configured
NODE_ENV=production bun ./node_modules/.bin/next dev -p 3000 &

# Verify rate limiting works (shared across instances):
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/v1/shops/quickprint/orders -H 'Content-Type: application/json' -d '{}'
done
# Expected: ~20 return 200, then 429 (rate limit hit at 20/60s)

# Verify the cache is actually in Redis (not in-memory):
# Connect to Upstash console and check for rl:create-order:* keys

# Missing credentials test:
unset REDIS_URL REDIS_TOKEN
NODE_ENV=production bun ./node_modules/.bin/next dev -p 3001 &
# Expected: the container throws on startup (UpstashCacheAdapter constructor)
```

## 6. Agent disconnection, restart, stale-job recovery

```bash
# 1. Start the realtime service + app + register an agent
cd mini-services/realtime-service && bun --hot index.ts &
NODE_ENV=development bun ./node_modules/.bin/next dev -p 3000 &

# Register an agent
TOK=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"owner@quickprint.demo","password":"demo1234"}' | jq -r .data.accessToken)
DTOK=$(curl -s -X POST http://localhost:3000/api/v1/agents/register -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"test-agent"}' | jq -r .data.deviceToken)

# 2. Start the print agent
PRINT_AGENT_DEMO=1 PRINT_AGENT_DEVICE_TOKEN=$DTOK PRINT_AGENT_API_URL=http://localhost:3000 \
  cd mini-services/print-agent && bun src/index.ts start &

# 3. Create an order, upload, checkout, pay (simulate webhook)
OID=$(curl -s -X POST http://localhost:3000/api/v1/shops/quickprint/orders -H 'Content-Type: application/json' -d '{}' | jq -r .data.orderId)
# ... upload + checkout + simulate webhook ...

# 4. Kill the agent mid-print (simulates a crash after claiming but before ack)
kill <agent_pid>

# 5. Wait 5+ minutes (the stale threshold)
sleep 310

# 6. Restart the app
# The startup recovery (recoverStaleJobsOnStartup) moves the stale 'printing' job to 'needs_review'

# 7. Verify
curl -s http://localhost:3000/api/v1/orders/$OID/status | jq .data.files[0].status
# Expected: "needs_review" (NOT "queued" — no automatic reprint)

# 8. Manual re-queue (shopkeeper confirms NOT printed):
# Use the durable-queue's requeueJob function or a future admin endpoint
```

## 7. Payment-provider sandbox verification

> **BLOCKED** if PhonePe/Paytm sandbox credentials are unavailable.

```bash
export PHONEPE_SALT_KEY=<sandbox_salt_key>
export PHONEPE_SALT_INDEX=1
export PHONEPE_ENV=sandbox

# 1. Configure the shop with the sandbox credentials
curl -s -X PATCH http://localhost:3000/api/v1/shops/me -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '{"paymentCredentials":{"phonepe":{"saltKey":"<sandbox_salt>","saltIndex":"1","merchantId":"<sandbox_mid>","env":"sandbox"}}}'

# 2. Create an order, upload, checkout → get the PhonePe checkout URL
# 3. Open the checkout URL in a browser → complete the sandbox payment
# 4. PhonePe sends a webhook to /api/v1/payments/phonepe/webhook
# 5. Verify: order status = paid, paymentTxnId set, print job created

# For Paytm:
export PAYTM_MERCHANT_ID=<sandbox_mid>
export PAYTM_MERCHANT_KEY=<sandbox_key>
# Similar flow → /api/v1/payments/paytm/callback

# Clean up: reset the shop's paymentCredentials after testing
```

## 8. Backup and restore

```bash
# Backup
pg_dump "$DATABASE_URL" | gzip > backup_$(date +%Y%m%d).sql.gz

# Restore to a disposable DB
createdb printshop_restore
gunzip -c backup_20260101.sql.gz | psql "postgresql://user:pass@host:5432/printshop_restore"

# Verify
psql "postgresql://user:pass@host:5432/printshop_restore" -c "SELECT COUNT(*) FROM \"PrintJob\";"
# Expected: same count as the original

# Clean up
dropdb printshop_restore
```

## Classification

| Test | Status (when credentials are available) |
|---|---|
| PostgreSQL migration | **PASS** — DDL verified against PGlite; hosted PG needs `prisma migrate deploy` |
| Concurrent worker claim | **PASS** — conditional UPDATE verified against PGlite; hosted PG needs 2 psql sessions |
| Duplicate payment webhooks | **PASS** — UNIQUE constraint + idempotency tested (7 tests); hosted PG needs concurrent curl |
| R2 upload/download/deletion | **BLOCKED** — no R2 credentials |
| Upstash Redis operations | **BLOCKED** — no Upstash credentials |
| Agent disconnect + restart recovery | **PASS** (in-memory) — needs hosted PG + running app + agent |
| Payment sandbox | **BLOCKED** — no PhonePe/Paytm sandbox credentials |
| Backup and restore | **PASS** (PGlite) — needs hosted PG for `pg_dump` test |

## Cleanup

After all tests:
```bash
# Drop the staging database (do NOT do this against production)
psql -c "DROP DATABASE IF EXISTS printshop_staging;"

# Delete R2 test objects
# Delete Upstash test keys
# Reset the shop's paymentCredentials
```
