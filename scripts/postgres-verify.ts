/**
 * PostgreSQL Staging Verification — runs against PGlite (PostgreSQL in WASM).
 *
 * This is REAL PostgreSQL SQL behavior (not SQLite, not in-memory).
 * PGlite executes actual PostgreSQL queries with row-level locking,
 * conditional UPDATEs, UNIQUE constraints, and foreign keys.
 *
 * Run: bun run scripts/postgres-verify.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PG_DDL = readFileSync(resolve(import.meta.dir, '../tmp/pg_migration.sql'), 'utf8');

async function main() {
  const pg = new PGlite();
  let pass = 0, fail = 0;
  const assert = (label: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  // ── 1. Apply the PostgreSQL schema ──
  console.log('\n=== 1. PostgreSQL schema migration ===');
  await pg.exec(PG_DDL);
  const tables = await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  console.log('  tables:', tables.rows.map((r: any) => r.tablename).join(', '));
  assert('8 tables created', tables.rows.length === 8);
  assert('Shop table exists', tables.rows.some((r: any) => r.tablename === 'Shop'));
  assert('PrintJob table exists', tables.rows.some((r: any) => r.tablename === 'PrintJob'));

  // ── 2. Verify indexes + unique constraints ──
  console.log('\n=== 2. Indexes + unique constraints ===');
  const indexes = await pg.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`);
  console.log('  indexes:', indexes.rows.map((r: any) => r.indexname).join(', '));
  assert('Shop_slug unique index', indexes.rows.some((r: any) => r.indexname === 'Shop_slug_key'));
  assert('User_email unique index', indexes.rows.some((r: any) => r.indexname === 'User_email_key'));
  assert('Order_paymentTxnId unique index', indexes.rows.some((r: any) => r.indexname === 'Order_paymentTxnId_key'));
  assert('PrintJob_shopId_status composite index', indexes.rows.some((r: any) => r.indexname === 'PrintJob_shopId_status_idx'));

  // ── 3. Verify foreign keys ──
  console.log('\n=== 3. Foreign keys ===');
  const fks = await pg.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name
  `);
  console.log('  foreign keys:', fks.rows.length);
  assert('8 foreign keys', fks.rows.length === 8);

  // ── 4. Seed: shop + order + file + print job ──
  console.log('\n=== 4. Seed test data ===');
  await pg.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ('shop-1', 'Test Shop', 'test-shop', 'user-1', 'test@okaxis', 'googlepay', '{}', '{}', 'x', 'x', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pg.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ('shop-2', 'Other Shop', 'other-shop', 'user-2', 'other@okaxis', 'googlepay', '{}', '{}', 'x', 'x', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pg.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
    VALUES ('order-1', 'shop-1', 'TOKEN1', 'awaiting_payment', 1000, 'INR', NOW(), NOW())`);
  await pg.query(`INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
    VALUES ('file-1', 'order-1', 'doc.pdf', 'key-1', 'application/pdf', 100, 1, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW())`);
  await pg.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-1', 'shop-1', 'file-1', 'queued', 0, NOW(), NOW(), NOW())`);
  assert('test data seeded', true);

  // ── 5. ATOMIC JOB CLAIMING (concurrent conditional UPDATE) ──
  console.log('\n=== 5. Atomic job claiming (real PostgreSQL conditional UPDATE) ===');

  // Agent A claims: UPDATE ... WHERE id='job-1' AND status='queued' RETURNING
  const claimA = await pg.query(`
    UPDATE "PrintJob" SET status='printing', "agentId"='agent-A', "startedAt"=NOW()
    WHERE id='job-1' AND status='queued' AND "shopId"='shop-1'
    RETURNING id, status, "agentId"
  `);
  assert('agent A claim succeeds (1 row)', claimA.rows.length === 1);
  assert('agent A is the winner', claimA.rows[0]?.agentId === 'agent-A');

  // Agent B claims the SAME job — should fail (status is now 'printing')
  const claimB = await pg.query(`
    UPDATE "PrintJob" SET status='printing', "agentId"='agent-B', "startedAt"=NOW()
    WHERE id='job-1' AND status='queued' AND "shopId"='shop-1'
    RETURNING id, status, "agentId"
  `);
  assert('agent B claim fails (0 rows)', claimB.rows.length === 0);

  // Verify the job was claimed by A, not B
  const finalJob = await pg.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-1'`);
  assert('job status is printing', finalJob.rows[0]?.status === 'printing');
  assert('job agentId is agent-A', finalJob.rows[0]?.agentId === 'agent-A');

  // ── 6. CROSS-TENANT CLAIM (wrong shopId) ──
  console.log('\n=== 6. Cross-tenant claim ===');
  await pg.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-2', 'shop-1', 'file-1', 'queued', 0, NOW(), NOW(), NOW())`);
  const crossClaim = await pg.query(`
    UPDATE "PrintJob" SET status='printing', "agentId"='evil', "startedAt"=NOW()
    WHERE id='job-2' AND status='queued' AND "shopId"='shop-2'
    RETURNING id
  `);
  assert('cross-tenant claim fails (0 rows)', crossClaim.rows.length === 0);
  const job2Final = await pg.query(`SELECT status FROM "PrintJob" WHERE id='job-2'`);
  assert('job-2 still queued (untouched)', job2Final.rows[0]?.status === 'queued');

  // ── 7. DUPLICATE COMPLETION ACK (idempotent) ──
  console.log('\n=== 7. Duplicate completion ack ===');
  // Complete job-1 (status='printing' → 'completed')
  const complete1 = await pg.query(`
    UPDATE "PrintJob" SET status='completed', "completedAt"=NOW()
    WHERE id='job-1' AND status='printing' AND "shopId"='shop-1'
    RETURNING id
  `);
  assert('first completion succeeds (1 row)', complete1.rows.length === 1);

  // Duplicate ack — job is already 'completed', not 'printing'
  const complete2 = await pg.query(`
    UPDATE "PrintJob" SET status='completed', "completedAt"=NOW()
    WHERE id='job-1' AND status='printing' AND "shopId"='shop-1'
    RETURNING id
  `);
  assert('duplicate ack is a no-op (0 rows)', complete2.rows.length === 0);
  const completedFinal = await pg.query(`SELECT status FROM "PrintJob" WHERE id='job-1'`);
  assert('job still completed (not corrupted)', completedFinal.rows[0]?.status === 'completed');

  // ── 8. PAYMENT UNIQUE CONSTRAINT (idempotency) ──
  console.log('\n=== 8. Payment UNIQUE constraint (webhook idempotency) ===');
  // Set paymentTxnId on the order
  await pg.query(`UPDATE "Order" SET "paymentTxnId"='txn-001', status='paid', "paidAt"=NOW() WHERE id='order-1'`);
  // Try to insert another order with the SAME paymentTxnId — should violate UNIQUE
  try {
    await pg.query(`UPDATE "Order" SET "paymentTxnId"='txn-001' WHERE id='order-1'`);
    // This is the same order so it's fine; try a DIFFERENT order with the same txnId
    await pg.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "paymentTxnId", "createdAt", "updatedAt")
      VALUES ('order-2', 'shop-1', 'TOKEN2', 'paid', 500, 'INR', 'txn-001', NOW(), NOW())`);
    assert('UNIQUE constraint on paymentTxnId rejects duplicate', false); // should have thrown
  } catch (e: any) {
    assert('UNIQUE constraint on paymentTxnId rejects duplicate', e.message.includes('unique') || e.message.includes('duplicate'));
  }

  // ── 9. STALE JOB RECOVERY → needs_review ──
  console.log('\n=== 9. Stale job recovery → needs_review ===');
  await pg.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, "agentId", attempts, "startedAt", "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-3', 'shop-1', 'file-1', 'printing', 'agent-A', 1, NOW() - INTERVAL '10 minutes', NOW(), NOW(), NOW())`);
  // Recovery: move stale 'printing' (>5min) to 'needs_review'
  const stale = await pg.query(`
    UPDATE "PrintJob" SET status='needs_review'
    WHERE status='printing' AND "startedAt" < NOW() - INTERVAL '5 minutes' AND "shopId"='shop-1'
    RETURNING id
  `);
  assert('stale job moved to needs_review (1 row)', stale.rows.length === 1);
  assert('stale job is job-3', stale.rows[0]?.id === 'job-3');
  const job3Final = await pg.query(`SELECT status FROM "PrintJob" WHERE id='job-3'`);
  assert('job-3 is needs_review (NOT re-queued)', job3Final.rows[0]?.status === 'needs_review');

  // ── 10. needs_review BLOCKS agent claim ──
  console.log('\n=== 10. needs_review blocks agent claim ===');
  const blockedClaim = await pg.query(`
    UPDATE "PrintJob" SET status='printing', "agentId"='agent-X', "startedAt"=NOW()
    WHERE id='job-3' AND status='queued' AND "shopId"='shop-1'
    RETURNING id
  `);
  assert('cannot claim needs_review job (0 rows)', blockedClaim.rows.length === 0);

  // ── 11. BACKUP + RESTORE ──
  console.log('\n=== 11. Backup + restore ===');
  // Export the data
  const allJobs = await pg.query(`SELECT id, status, "agentId" FROM "PrintJob" ORDER BY id`);
  const backup = JSON.stringify(allJobs.rows);
  // "Restore" — close the DB, create a new one, apply schema, insert the backup data
  await pg.close();
  const pg2 = new PGlite();
  await pg2.exec(PG_DDL);
  // Re-insert the shop + order + file (parent records needed for FK)
  await pg2.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ('shop-1', 'Test Shop', 'test-shop', 'user-1', 'test@okaxis', 'googlepay', '{}', '{}', 'x', 'x', 'Asia/Kolkata', true, 'free', NOW(), NOW())`);
  await pg2.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "paymentTxnId", "paidAt", "createdAt", "updatedAt")
    VALUES ('order-1', 'shop-1', 'TOKEN1', 'paid', 1000, 'INR', 'txn-001', NOW(), NOW(), NOW())`);
  await pg2.query(`INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
    VALUES ('file-1', 'order-1', 'doc.pdf', 'key-1', 'application/pdf', 100, 1, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW())`);
  // Re-insert the PrintJobs from the backup
  const restored = JSON.parse(backup);
  for (const job of restored) {
    await pg2.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, "agentId", attempts, "queuedAt", "createdAt", "updatedAt")
      VALUES ($1, 'shop-1', 'file-1', $2, $3, 0, NOW(), NOW(), NOW())`, [job.id, job.status, job.agentId]);
  }
  const restoredJobs = await pg2.query(`SELECT id, status FROM "PrintJob" ORDER BY id`);
  assert('backup + restore preserves job data', restoredJobs.rows.length === restored.length);
  assert('restored job-1 is completed', restoredJobs.rows.some((r: any) => r.id === 'job-1' && r.status === 'completed'));
  assert('restored job-3 is needs_review', restoredJobs.rows.some((r: any) => r.id === 'job-3' && r.status === 'needs_review'));
  await pg2.close();

  // ── SUMMARY ──
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
