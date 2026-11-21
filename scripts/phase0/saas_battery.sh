#!/usr/bin/env bash
# Phase 0a — SaaS baseline battery. Every step tees FULL output into
# docs/audit/phase0/ and the script prints a compact pass/fail summary.
# Env matches .github/workflows/ci.yml except DB credentials point at the
# local portable PostgreSQL (127.0.0.1:5433, user printshop).
set -u
cd /home/z/my-project/repos/printshop-saas
export DATABASE_URL='postgresql://printshop:printshop@127.0.0.1:5433/printshop_ci?schema=public'
export TEST_DATABASE_URL='postgresql://printshop:printshop@127.0.0.1:5433/printshop_ci'
AUD=docs/audit/phase0
mkdir -p "$AUD"

# versions for reproducibility
{ node --version; bun --version; echo "postgres: $(psql_not_available=1)"; PGPASSWORD=printshop /home/z/my-project/tools/pg16/bin/pg_ctl -D /home/z/my-project/tools/pgdata status 2>/dev/null | head -1; } > "$AUD/00-env.log" 2>&1

run() { # run <exitcode-file> <logfile> <cmd...>
  local codef="$1" logf="$2"; shift 2
  echo "── $* ──"
  "$@" > "$AUD/$logf" 2>&1
  local rc=$?
  echo "$rc" > "$AUD/.code-$codef"
  echo "   exit=$rc  log=$AUD/$logf ($(wc -l < "$AUD/$logf") lines)"
  return 0
}

run install 01-bun-install.log   bun install --frozen-lockfile
run gen    02-prisma-generate.log  bunx prisma generate
run routes 03-route-conflicts.log  bash scripts/check-route-conflicts.sh
run tsc    04-typecheck.log        npx tsc --noEmit
run lint   05-lint.log             bun run lint
run pval   06-prisma-validate.log  bunx prisma validate
run migr   07-migrate-deploy.log   bunx prisma migrate deploy
run tests  08-tests.log            bunx vitest run
run build  09-next-build.log       bun run build:check

echo "════════ SUMMARY ════════"
for f in gen routes tsc lint pval migr tests build; do
  printf "%-8s exit=%s\n" "$f" "$(cat "$AUD/.code-$f")"
done
