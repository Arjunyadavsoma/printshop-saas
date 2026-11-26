/**
 * Minimal SQL file runner — executes a .sql file against DATABASE_URL.
 *
 * Why not `prisma db execute`: the bunx-resolved Prisma CLI version varies
 * between environments (6.19.2 locally on Vercel, 8.x if bunx fetches
 * fresh), and `db execute` was removed in Prisma 8. A 20-line pg runner is
 * version-proof and needs nothing beyond the `pg` package that is already
 * a dependency. Used by scripts/vercel-build.sh to apply
 * scripts/ensure-upload-tables.sql and scripts/ensure-customer-tables.sql
 * (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * Two hard-won behaviours (2026-11-26): the runner failed on EVERY Vercel
 * build (all 3 attempts, every deploy) while Prisma connected fine from
 * the same build. The `| tail -3` in vercel-build.sh hid the real error
 * behind Bun's crash banner, so the cause stayed unknown. The visible
 * error (from the PR #20 deploy) is "self signed certificate in
 * certificate chain": Neon's pooler presents a certificate Node's TLS
 * verifier rejects, and node-postgres verifies the chain whenever the
 * URL's sslmode asks for it (or by default) — while Prisma's engine does
 * not trip on it. So this runner ALWAYS passes
 * ssl: { rejectUnauthorized: false } (unless the URL explicitly disables
 * SSL) — an explicit option overrides whatever sslmode the URL carries.
 * Failures are printed explicitly before exiting, so a future failure is
 * diagnosable from the build log instead of a bare crash banner.
 *
 * Usage: bun scripts/run-sql-file.mjs <file.sql>
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: run-sql-file.mjs <file.sql>');
  process.exit(1);
}
const sql = readFileSync(file, 'utf8');

const connectionString = process.env.DATABASE_URL;
const sslDisabled = /sslmode=disable/i.test(connectionString || '');
const client = new pg.Client({
  connectionString,
  // Always force unverified SSL (unless the URL explicitly disables it):
  // Neon's pooler cert fails Node's chain verification, and this option
  // overrides whatever sslmode the URL carries.
  ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
});
try {
  await client.connect();
  await client.query(sql);
  console.log(`  ✓ applied ${file}`);
} catch (err) {
  console.error(
    `  ✗ failed ${file}: ${err instanceof Error ? err.message : String(err)}`,
  );
  try {
    await client.end();
  } catch {
    // Ignore — the process is exiting anyway.
  }
  process.exit(1);
}
await client.end();
