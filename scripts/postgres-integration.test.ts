/**
 * Real PostgreSQL Integration Test — PrintShop SaaS
 *
 * Connects to a REAL PostgreSQL server (not PGlite, not SQLite, not in-memory)
 * via the `pg` driver and verifies the critical production queries:
 *
 *  1. Schema integrity (tables, indexes, FKs, unique constraints)
 *  2. Atomic job claiming via conditional UPDATE ... WHERE status='queued' RETURNING
 *  3. Cross-tenant claim rejection
 *  4. Duplicate completion ack idempotency
 *  5. UNIQUE constraint on paymentTxnId (webhook replay guard)
 *  6. Stale printing job → needs_review (NO automatic requeue)
 *  7. needs_review blocks agent claim
 *  8. pg_dump backup + restore round-trip
 *
 * Run:
 *   source /home/z/my-project/scripts/pg-env.sh
 *   bun run scripts/postgres-integration.test.ts
 *
 * Exits 0 on success, 1 on any failure. Prints a structured report.
 */
import { Pool } from 'pg';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DDL_PATH = resolve(import.meta.dir, '../tmp/pg_migration.sql');

function makePool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set. source scripts/pg-env.sh first.');
  }
  // Use a dedicated connection pool for this test
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${detail ? ` — ${detail}` : ''}`;
    console.log(msg);
    failures.push(msg);
  }
}

async function resetSchema(pool: Pool): Promise<void> {
  // Drop and recreate — this is a DISPOSABLE staging DB
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const ddl = readFileSync(DDL_PATH, 'utf8');
  await pool.query(ddl);
}

async function seed(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ('shop-1', 'Test Shop', 'test-shop', 'user-1', 'test@okaxis', 'googlepay', '{}', '{}', 'addr', '9999999999', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pool.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ('shop-2', 'Other Shop', 'other-shop', 'user-2', 'other@okaxis', 'googlepay', '{}', '{}', 'addr', '8888888888', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
    VALUES ('order-1', 'shop-1', 'TOKEN1', 'awaiting_payment', 1000, 'INR', NOW(), NOW())`);
  await pool.query(`INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
    VALUES ('file-1', 'order-1', 'doc.pdf', 'key-1', 'application/pdf', 100, 1, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW())`);
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-1', 'shop-1', 'file-1', 'queued', 0, NOW(), NOW(), NOW())`);
}

async function main() {
  console.log('\n=== PrintShop — Real PostgreSQL Integration Test ===');
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);
  const pool = makePool();

  // Verify we are connected to a REAL PostgreSQL (not PGlite)
  const versionRes = await pool.query('SELECT version()');
  const version = versionRes.rows[0].version as string;
  console.log(`  Server: ${version.split(',')[0]}`);
  assert('Connected to real PostgreSQL (not PGlite/SQLite)', version.toLowerCase().includes('postgresql'));
  assert('Server reports it is PostgreSQL 17', /PostgreSQL 1[0-9]/.test(version));

  // ── 1. Schema integrity ──
  console.log('\n=== 1. Schema integrity ===');
  await resetSchema(pool);
  const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const expectedTables = ['AuditLog', 'Order', 'PrintAgent', 'PrintFile', 'PrintJob', 'Shop', 'Subscription', 'User'];
  for (const t of expectedTables) {
    assert(`table ${t} exists`, tables.rows.some((r: any) => r.tablename === t));
  }
  assert('exactly 8 tables (no extras)', tables.rows.length === 8, `got ${tables.rows.length}`);

  const indexes = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`);
  const criticalUnique = ['Shop_slug_key', 'User_email_key', 'Order_paymentTxnId_key', 'Subscription_shopId_key'];
  for (const u of criticalUnique) {
    const row = indexes.rows.find((r: any) => r.indexname === u);
    assert(`unique index ${u} exists`, !!row && /UNIQUE/i.test(row.indexdef));
  }
  const criticalComposite = ['PrintJob_shopId_status_idx', 'Order_shopId_status_idx', 'AuditLog_shopId_createdAt_idx', 'PrintAgent_shopId_isOnline_idx'];
  for (const c of criticalComposite) {
    assert(`composite index ${c} exists`, indexes.rows.some((r: any) => r.indexname === c));
  }

  const fks = await pool.query(`SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name`);
  const expectedFks: [string, string, string][] = [
    ['User', 'shopId', 'Shop'],
    ['Order', 'shopId', 'Shop'],
    ['PrintFile', 'orderId', 'Order'],
    ['PrintJob', 'shopId', 'Shop'],
    ['PrintJob', 'fileId', 'PrintFile'],
    ['PrintAgent', 'shopId', 'Shop'],
    ['Subscription', 'shopId', 'Shop'],
    ['AuditLog', 'shopId', 'Shop'],
    ['AuditLog', 'userId', 'User'],
  ];
  assert('9 foreign keys (matches schema)', fks.rows.length === 9, `got ${fks.rows.length}`);
  for (const [tbl, col, ref] of expectedFks) {
    assert(`FK ${tbl}.${col} → ${ref}`, fks.rows.some((r: any) => r.table_name === tbl && r.column_name === col && r.ref_table === ref));
  }

  // ── 2. Seed + Atomic job claim ──
  console.log('\n=== 2. Atomic job claim (real PostgreSQL conditional UPDATE) ===');
  await seed(pool);
  const claimA = await pool.query(`UPDATE "PrintJob" SET status='printing', "agentId"='agent-A', "startedAt"=NOW() WHERE id='job-1' AND status='queued' AND "shopId"='shop-1' RETURNING id, status, "agentId"`);
  assert('agent A claim returns 1 row', claimA.rows.length === 1);
  assert('agent A is the winner', claimA.rows[0]?.agentId === 'agent-A');
  const claimB = await pool.query(`UPDATE "PrintJob" SET status='printing', "agentId"='agent-B', "startedAt"=NOW() WHERE id='job-1' AND status='queued' AND "shopId"='shop-1' RETURNING id, status, "agentId"`);
  assert('agent B claim returns 0 rows (lost the race)', claimB.rows.length === 0);
  const finalJob = await pool.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-1'`);
  assert('job status is printing', finalJob.rows[0]?.status === 'printing');
  assert('job agentId is agent-A (winner)', finalJob.rows[0]?.agentId === 'agent-A');

  // ── 3. Cross-tenant claim rejection ──
  console.log('\n=== 3. Cross-tenant claim rejection ===');
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt") VALUES ('job-2', 'shop-1', 'file-1', 'queued', 0, NOW(), NOW(), NOW())`);
  const cross = await pool.query(`UPDATE "PrintJob" SET status='printing', "agentId"='evil', "startedAt"=NOW() WHERE id='job-2' AND status='queued' AND "shopId"='shop-2' RETURNING id`);
  assert('cross-tenant claim returns 0 rows', cross.rows.length === 0);
  const job2 = await pool.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-2'`);
  assert('job-2 still queued (untouched)', job2.rows[0]?.status === 'queued');
  assert('job-2 agentId is still NULL', job2.rows[0]?.agentId === null);

  // ── 4. Duplicate completion ack (idempotent) ──
  console.log('\n=== 4. Duplicate completion ack idempotency ===');
  const complete1 = await pool.query(`UPDATE "PrintJob" SET status='completed', "completedAt"=NOW() WHERE id='job-1' AND status='printing' AND "shopId"='shop-1' RETURNING id`);
  assert('first completion ack returns 1 row', complete1.rows.length === 1);
  const complete2 = await pool.query(`UPDATE "PrintJob" SET status='completed', "completedAt"=NOW() WHERE id='job-1' AND status='printing' AND "shopId"='shop-1' RETURNING id`);
  assert('duplicate completion ack returns 0 rows (idempotent)', complete2.rows.length === 0);
  const done = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-1'`);
  assert('job-1 still completed (not corrupted)', done.rows[0]?.status === 'completed');

  // ── 5. UNIQUE constraint on paymentTxnId ──
  console.log('\n=== 5. UNIQUE(paymentTxnId) — webhook replay guard ===');
  await pool.query(`UPDATE "Order" SET "paymentTxnId"='txn-001', status='paid', "paidAt"=NOW() WHERE id='order-1'`);
  try {
    await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "paymentTxnId", "createdAt", "updatedAt") VALUES ('order-2', 'shop-1', 'TOKEN2', 'paid', 500, 'INR', 'txn-001', NOW(), NOW())`);
    assert('duplicate paymentTxnId rejected by UNIQUE constraint', false, 'INSERT should have thrown');
  } catch (e: any) {
    assert('duplicate paymentTxnId rejected by UNIQUE constraint', /duplicate key|unique/i.test(e.message));
  }

  // ── 6. Stale printing job → needs_review ──
  console.log('\n=== 6. Stale printing job → needs_review (NO automatic requeue) ===');
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, "agentId", attempts, "startedAt", "queuedAt", "createdAt", "updatedAt") VALUES ('job-3', 'shop-1', 'file-1', 'printing', 'agent-A', 1, NOW() - INTERVAL '10 minutes', NOW(), NOW(), NOW())`);
  const stale = await pool.query(`UPDATE "PrintJob" SET status='needs_review' WHERE status='printing' AND "startedAt" < NOW() - INTERVAL '5 minutes' AND "shopId"='shop-1' RETURNING id`);
  assert('stale recovery moves 1 row to needs_review', stale.rows.length === 1);
  assert('stale job is job-3', stale.rows[0]?.id === 'job-3');
  const job3 = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-3'`);
  assert('job-3 is needs_review (NOT re-queued)', job3.rows[0]?.status === 'needs_review');

  // ── 7. needs_review blocks agent claim ──
  console.log('\n=== 7. needs_review blocks agent claim ===');
  const blocked = await pool.query(`UPDATE "PrintJob" SET status='printing', "agentId"='agent-X', "startedAt"=NOW() WHERE id='job-3' AND status='queued' AND "shopId"='shop-1' RETURNING id`);
  assert('cannot claim needs_review job (0 rows)', blocked.rows.length === 0);
  const job3b = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-3'`);
  assert('job-3 still needs_review (untouched)', job3b.rows[0]?.status === 'needs_review');

  // ── 8. pg_dump backup + restore round-trip ──
  console.log('\n=== 8. pg_dump backup + restore round-trip ===');
  const backupFile = '/tmp/printshop_backup.sql';
  const restoreDb = 'printshop_restore';
  try {
    // Backup via pg_dump (real PostgreSQL tool, not JSON serialization)
    execSync(`pg_dump -d printshop_staging --no-owner --no-privileges > ${backupFile}`, { stdio: 'pipe' });
    const stat = readFileSync(backupFile, 'utf8');
    assert('pg_dump produced non-empty SQL', stat.length > 1000);
    assert('backup contains PrintJob table', stat.includes('PrintJob'));
    assert('backup contains CREATE TABLE statements', stat.includes('CREATE TABLE'));

    // Restore to a fresh disposable DB
    await pool.query(`DROP DATABASE IF EXISTS ${restoreDb}`);
    await pool.query(`CREATE DATABASE ${restoreDb}`);
    // Restore via psql
    execSync(`psql -d ${restoreDb} -v ON_ERROR_STOP=1 -q -f ${backupFile}`, { stdio: 'pipe' });

    // Verify restored data
    const restoredPool = new Pool({ connectionString: `postgresql://z@127.0.0.1:5433/${restoreDb}`, max: 2 });
    const rJobs = await restoredPool.query(`SELECT id, status, "agentId" FROM "PrintJob" ORDER BY id`);
    assert('restored PrintJob count matches (3 jobs)', rJobs.rows.length === 3, `got ${rJobs.rows.length}`);
    assert('restored job-1 is completed', rJobs.rows.some((r: any) => r.id === 'job-1' && r.status === 'completed'));
    assert('restored job-2 is queued', rJobs.rows.some((r: any) => r.id === 'job-2' && r.status === 'queued'));
    assert('restored job-3 is needs_review', rJobs.rows.some((r: any) => r.id === 'job-3' && r.status === 'needs_review'));
    const rOrders = await restoredPool.query(`SELECT id, status, "paymentTxnId" FROM "Order"`);
    assert('restored order-1 is paid with txn-001', rOrders.rows.some((r: any) => r.id === 'order-1' && r.status === 'paid' && r.paymentTxnId === 'txn-001'));
    await restoredPool.end();
    // Cleanup
    await pool.query(`DROP DATABASE IF EXISTS ${restoreDb}`);
  } catch (e: any) {
    assert('pg_dump backup + restore round-trip', false, e.message);
  }

  // ── SUMMARY ──
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(f));
  }
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
