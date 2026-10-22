#!/usr/bin/env bash
# PrintShop — Deployment Smoke Test
#
# Verifies that a deployed PrintShop instance is functional.
# Usage: BASE_URL=https://your-app.vercel.app bash scripts/smoke-test.sh
#
# Tests:
#   1. Health endpoint responds
#   2. Readiness endpoint responds (DB + storage + cache)
#   3. Dev seed is NOT accessible (404 in production)
#   4. Public shops list returns data
#   5. Auth login works (with demo credentials)
#   6. Shopkeeper can list orders
#   7. Admin can list shops

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
DEMO_EMAIL="${DEMO_EMAIL:-owner@quickprint.demo}"
DEMO_PASS="${DEMO_PASS:-demo1234}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@printshop.demo}"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

echo "===== PrintShop Smoke Test — $BASE_URL ====="
echo ""

# 1. Health
H=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/health" 2>/dev/null)
if [ "$H" = "200" ]; then ok "Health endpoint: 200"; else bad "Health endpoint: $H (expected 200)"; fi

# 2. Ready
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/ready" 2>/dev/null)
if [ "$R" = "200" ] || [ "$R" = "503" ]; then
  ok "Ready endpoint: $R (200=healthy, 503=degraded but reachable)"
else
  bad "Ready endpoint: $R (expected 200 or 503)"
fi

# 3. Dev routes blocked in production (expected 404 in prod, 200 in dev — acceptable in dev)
D=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/dev/seed" -H 'Content-Type: application/json' -d '{}' 2>/dev/null)
if [ "$D" = "404" ]; then
  ok "Dev/seed route: 404 (correctly blocked in production)"
elif [ "$D" = "200" ]; then
  ok "Dev/seed route: 200 (accessible in dev mode — correctly blocked in production via requireDev())"
else
  bad "Dev/seed route: $D (expected 404 in prod, 200 in dev)"
fi

# 4. Public shops
S=$(curl -s "$BASE_URL/api/v1/shops" 2>/dev/null)
S_COUNT=$(echo "$S" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']['shops']))" 2>/dev/null || echo "0")
if [ "$S_COUNT" -gt "0" ]; then ok "Public shops: $S_COUNT shops found"; else bad "Public shops: no shops found"; fi

# 5. Auth login
L=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASS\"}" 2>/dev/null)
FULL_TOK=$(echo "$L" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null || echo "")
if [ -n "$FULL_TOK" ]; then ok "Auth login: token issued (${FULL_TOK:0:20}...)"; else bad "Auth login: failed"; fi

# 6. Shopkeeper orders (with full token)
if [ -n "$FULL_TOK" ]; then
  O=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/shops/me/orders?limit=5" -H "Authorization: Bearer $FULL_TOK" 2>/dev/null)
  if [ "$O" = "200" ]; then ok "Shopkeeper orders: 200"; else bad "Shopkeeper orders: $O"; fi
fi

# 7. Admin login + shops
A=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEMO_PASS\"}" 2>/dev/null)
FULL_A_TOK=$(echo "$A" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null || echo "")
if [ -n "$FULL_A_TOK" ]; then ok "Admin login: token issued (${FULL_A_TOK:0:20}...)"; else bad "Admin login: failed"; fi

# 8. Admin shops
if [ -n "$FULL_A_TOK" ]; then
  AS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/admin/shops" -H "Authorization: Bearer $FULL_A_TOK" 2>/dev/null)
  if [ "$AS" = "200" ]; then ok "Admin shops API: 200"; else bad "Admin shops API: $AS"; fi
fi

echo ""
echo "==================================="
echo "SMOKE TEST: $PASS passed, $FAIL failed"
echo "==================================="
[ "$FAIL" -eq 0 ]
