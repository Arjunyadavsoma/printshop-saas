#!/usr/bin/env bash
# PrintShop — PostgreSQL Unavailability + Recovery Test
#
# Verifies that when PostgreSQL becomes unavailable:
#   - /health still responds (no DB call) — the app process stays alive
#   - /ready returns 503 (DB health check fails)
#   - DB-querying endpoints return 500 (NOT a silent fallback to in-memory)
# And after PostgreSQL restarts:
#   - /ready recovers to 200 (Prisma reconnects)
#   - DB queries succeed again
#
# Run: source scripts/pg-env.sh && bash scripts/pg-unavailability-test.sh

set -uo pipefail
cd /home/z/my-project
source scripts/pg-env.sh

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

# 1. Switch to PG config
cp prisma/schema.prisma /tmp/schema.sqlite.bak3.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
cp .env /tmp/env.sqlite.bak3
echo 'DATABASE_URL=postgresql://z@127.0.0.1:5433/printshop_staging?schema=public' > .env
DATABASE_URL="postgresql://z@127.0.0.1:5433/printshop_staging?schema=public" bunx prisma generate >/dev/null 2>&1

# 2. Ensure PG is up + schema applied
pg_ctl -D /tmp/pgdata start 2>/dev/null || true
sleep 1
psql -d printshop_staging -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
psql -d printshop_staging -v ON_ERROR_STOP=1 -q -f tmp/pg_migration.sql >/dev/null 2>&1

# 3. Seed demo data (so /shops/me/analytics has a user to query)
psql -d printshop_staging -c "INSERT INTO \"Shop\" (id, name, slug, \"ownerUserId\", \"upiId\", \"paymentProvider\", \"paymentCredentials\", \"pricingConfig\", address, phone, timezone, \"isActive\", \"subscriptionTier\", \"createdAt\", \"updatedAt\") VALUES ('s1', 'Test', 'test', 'u1', 't@o', 'g', '{}', '{}', 'x', 'x', 'UTC', true, 'free', NOW(), NOW());" >/dev/null 2>&1
psql -d printshop_staging -c "INSERT INTO \"User\" (id, email, phone, \"passwordHash\", role, \"shopId\", \"createdAt\", \"updatedAt\") VALUES ('u1', 'owner@test.demo', '9999999999', 'x', 'owner', 's1', NOW(), NOW());" >/dev/null 2>&1

# 4. Start the app
pkill -9 -f 'next' 2>/dev/null; sleep 1
> /home/z/my-project/dev.log
setsid bash -c 'exec bun run dev' </dev/null >/home/z/my-project/dev.log 2>&1 &
disown
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then break; fi
  sleep 1
done

echo "=== Step A: PG UP — baseline ==="
H1=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
R1=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/ready)
echo "  /health = $H1 (expected 200 — no DB call)"
echo "  /ready  = $R1 (expected 200 — DB reachable)"
[ "$H1" = "200" ] && ok "health 200 with PG up" || bad "health $H1"
[ "$R1" = "200" ] && ok "ready 200 with PG up" || bad "ready $R1"

echo ""
echo "=== Step B: Kill PostgreSQL — app must FAIL LOUDLY (not silent fallback) ==="
pg_ctl -D /tmp/pgdata -m fast stop >/dev/null 2>&1
sleep 2
H2=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
R2=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/ready)
# /shops/me/analytics requires a JWT; without one it returns 401. Test /dev/seed (no auth, hits DB)
S2=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/v1/dev/seed -H 'Content-Type: application/json' -d '{}')
echo "  /health (PG DOWN) = $H2 (expected 200 — no DB call)"
echo "  /ready  (PG DOWN) = $R2 (expected 503 — DB unreachable)"
echo "  POST /dev/seed (PG DOWN) = $S2 (expected 500 — DB insert fails, NOT silent success)"
[ "$H2" = "200" ] && ok "health still 200 (app process alive)" || bad "health $H2"
[ "$R2" = "503" ] || [ "$R2" = "500" ] && ok "ready fails loudly ($R2) when PG down" || bad "ready $R2 (should fail)"
# The seed route should NOT return 200 (that would mean silent fallback). It should 500.
if [ "$S2" = "500" ] || [ "$S2" = "502" ] || [ "$S2" = "503" ]; then
  ok "dev/seed fails loudly ($S2) — NO silent in-memory fallback"
else
  bad "dev/seed returned $S2 (expected 500 — silent fallback is a security/correctness bug)"
fi

echo ""
echo "=== Step C: Restart PostgreSQL — verify recovery ==="
pg_ctl -D /tmp/pgdata start >/dev/null 2>&1
sleep 3
H3=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
R3=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/ready)
echo "  /health (PG RECOVERED) = $H3"
echo "  /ready  (PG RECOVERED) = $R3 (expected 200 — Prisma reconnects)"
[ "$H3" = "200" ] && ok "health 200 after recovery" || bad "health $H3"
[ "$R3" = "200" ] && ok "ready 200 after recovery (Prisma reconnects)" || bad "ready $R3"

echo ""
echo "==================================="
echo "PG UNAVAILABILITY TEST: $PASS passed, $FAIL failed"
echo "==================================="

# Cleanup
pkill -9 -f 'next' 2>/dev/null
cp /tmp/schema.sqlite.bak3.prisma prisma/schema.prisma
cp /tmp/env.sqlite.bak3 .env
bunx prisma generate >/dev/null 2>&1
echo "Restored SQLite config."

[ "$FAIL" -eq 0 ]
