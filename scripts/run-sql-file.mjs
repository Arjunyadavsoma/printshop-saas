/**
 * Minimal SQL file runner — executes a .sql file against DATABASE_URL.
 *
 * Why not `prisma db execute`: the bunx-resolved Prisma CLI version varies
 * between environments (6.19.2 locally on Vercel, 8.x if bunx fetches
 * fresh), and `db execute` was removed in Prisma 8. A 20-line pg runner is
 * version-proof and needs nothing beyond the `pg` package that is already
 * a dependency. Used by scripts/vercel-build.sh to apply
 * scripts/ensure-upload-tables.sql (idempotent CREATE TABLE IF NOT EXISTS).
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

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log(`  ✓ applied ${file}`);
} finally {
  await client.end();
}
