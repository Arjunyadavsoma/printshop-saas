#!/usr/bin/env bash
# Phase 0c — boot the full local stack on the fix/e2e-printshop branch:
#   portable PG16 (already running) -> printshop_dev DB + migrations
#   realtime-service (bun) on 3003 (socket.io) + 3004 (/emit relay)
#   next dev on 3000 with memory/relay providers
# Everything is sandbox-local; dev secrets are throwaway.
set -u
SaaS=/home/z/my-project/repos/printshop-saas
AUD="$SaaS/docs/audit/phase0"
mkdir -p "$AUD"

# 1. throwaway dev secrets
ACC=$(openssl rand -hex 32); REF=$(openssl rand -hex 32); PEP=$(openssl rand -hex 32)
cat > "$SaaS/.env.local" <<EOF
DATABASE_URL=postgresql://printshop:printshop@127.0.0.1:5433/printshop_dev?schema=public
JWT_ACCESS_SECRET=$ACC
JWT_REFRESH_SECRET=$REF
DEVICE_TOKEN_PEPPER=$PEP
STORAGE_PROVIDER=memory
REALTIME_PROVIDER=relay
REALTIME_EMIT_URL=http://127.0.0.1:3004/emit
REALTIME_EMIT_SECRET=dev-emit-secret
CACHE_PROVIDER=memory
EOF
chmod 600 "$SaaS/.env.local"

# 2. dev database + migrations (psql absent in this distro; use node pg)
node - <<'EOF'
const { Client } = require('/home/z/my-project/repos/printshop-saas/node_modules/pg');
const c = new Client({ host: '127.0.0.1', port: 5433, user: 'printshop', password: 'printshop', database: 'postgres' });
(async () => {
  await c.connect();
  const e = await c.query("SELECT 1 FROM pg_database WHERE datname='printshop_dev'");
  if (e.rowCount === 0) await c.query('CREATE DATABASE printshop_dev');
  console.log('printshop_dev ready');
  await c.end();
})().catch(err => { console.error(err.message); process.exit(1); });
EOF

cd "$SaaS"
export DATABASE_URL='postgresql://printshop:printshop@127.0.0.1:5433/printshop_dev?schema=public'
bunx prisma migrate deploy > "$AUD/10-dev-db-migrate.log" 2>&1
echo "dev migrate exit=$?"

# 3. realtime-service (background, log to audit)
# NOTE: the mini-service verifies the same HS256 JWTs the SaaS mints, so it
# MUST run with the SAME JWT_ACCESS_SECRET as .env.local — this shared-secret
# step is not documented anywhere in the repo (baseline finding B-013).
cd "$SaaS/mini-services/realtime-service"
[ -d node_modules ] || bun install >> "$AUD/11-realtime-install.log" 2>&1
JWT_ACCESS_SECRET="$ACC" REALTIME_EMIT_SECRET=dev-emit-secret nohup bun index.ts > "$AUD/12-realtime.log" 2>&1 &
echo $! > /tmp/realtime.pid
sleep 3
curl -s -o /dev/null -w "realtime :3003 http=%{http_code}\n" "http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling" | tee -a "$AUD/13-boot-probes.log"

# 4. next dev (background)
cd "$SaaS"
nohup bun run dev > "$AUD/14-nextdev.log" 2>&1 &
echo $! > /tmp/nextdev.pid
for i in $(seq 1 30); do
  sleep 2
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api/v1/health" || true)
  if [ "$CODE" != "000" ]; then break; fi
done
echo "next dev /api/v1/health http=$CODE after ~$((i*2))s" | tee -a "$AUD/13-boot-probes.log"
curl -s "http://127.0.0.1:3000/api/v1/health" | head -c 400 | tee -a "$AUD/13-boot-probes.log"; echo
echo "PIDs: realtime=$(cat /tmp/realtime.pid) nextdev=$(cat /tmp/nextdev.pid)"
