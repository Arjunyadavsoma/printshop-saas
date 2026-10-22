/**
 * PrintJob Concurrency Harness — races 2+ independent worker processes that
 * all try to INSERT a PrintJob for the SAME file. Verifies the partial
 * unique index (PrintJob_active_file_unique) prevents duplicates under
 * genuine concurrent load.
 *
 * Scenarios tested:
 *   C1. Two workers INSERT for the SAME file — exactly one wins, one gets 23505.
 *   C2. Two workers INSERT for DIFFERENT files — both win (no cross-file blocking).
 *   C3. Three workers INSERT for the same file — exactly one wins.
 *   C4. Reprint after completion: insert (ok) → mark completed → insert again (ok).
 *   C5. needs_review does NOT block: insert (ok) → mark needs_review → insert again (ok).
 *   C6. A 'printing' job blocks: insert (ok) → mark printing → insert again (23505).
 *
 * Uses real PostgreSQL with genuinely independent TCP connections (2+ separate
 * bun worker processes, synchronised via LISTEN/NOTIFY). NOT a sequential
 * unit test. NOT PGlite.
 *
 * Run:
 *   source scripts/pg-env.sh
 *   bun run scripts/printjob-concurrency-harness.test.ts
 */
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DDL_PATH = resolve(import.meta.dir, '../tmp/pg_migration.sql');
const CONSTRAINTS_PATH = resolve(import.meta.dir, '../prisma/pg-constraints.sql');

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

interface WorkerResult {
  workerLabel: string;
  inserted: boolean;
  rows?: number;
  jobId?: string;
  error?: string;
  isUniqueViolation?: boolean;
}

function spawnWorker(raceId: string, workerLabel: string, fileId: string, shopId: string): Promise<WorkerResult> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('bun', ['run', 'scripts/printjob-concurrent-worker.ts', raceId, workerLabel, fileId, shopId], {
      cwd: '/home/z/my-project',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        // The worker may exit non-zero if the INSERT failed — that's expected for
        // the loser. Parse the stdout for the result.
      }
      try {
        const lines = stdout.split('\n').filter((l) => l.trim());
        const last = lines[lines.length - 1];
        resolveP(JSON.parse(last) as WorkerResult);
      } catch (e: any) {
        rejectP(new Error(`worker ${workerLabel} unparseable: ${stdout}; stderr: ${stderr}`));
      }
    });
  });
}

async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query(readFileSync(DDL_PATH, 'utf8'));
  await pool.query(readFileSync(CONSTRAINTS_PATH, 'utf8'));
}

async function seedShopOrderFile(pool: Pool, shopId: string, orderId: string, fileId: string): Promise<void> {
  // INSERT ... ON CONFLICT DO NOTHING so the same shop can be used for multiple orders/files.
  await pool.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ($1, $2, $2, 'u1', 't@o', 'g', '{}', '{}', 'x', 'x', 'UTC', true, 'free', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`, [shopId, shopId]);
  await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'paid', 1000, 'INR', NOW(), NOW())`, [orderId, shopId, `TOK_${orderId}`]);
  await pool.query(`INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
    VALUES ($1, $2, 'doc.pdf', 'k', 'application/pdf', 100, 1, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW())`, [fileId, orderId]);
}

async function waitForReady(pool: Pool, raceId: string, expected: string[], timeoutMs = 10000): Promise<void> {
  const client = await pool.connect();
  try {
    // Quote the channel identifier — raceId chars might not be valid bare identifiers.
    await client.query(`LISTEN "ready_${raceId}"`);
    const ready = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ready timeout; got ${[...ready].join(',')}`)), timeoutMs);
      client.on('notification', (msg) => {
        // msg.channel comes back WITHOUT quotes
        if (msg.channel === `ready_${raceId}`) {
          ready.add(msg.payload ?? '');
          if (ready.size >= expected.length) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });
  } finally {
    client.release();
  }
}

async function fireStart(pool: Pool, raceId: string): Promise<void> {
  await pool.query(`SELECT pg_notify('race_${raceId}', 'START')`);
}

async function countActiveJobs(pool: Pool, fileId: string): Promise<number> {
  const res = await pool.query(`SELECT COUNT(*)::int AS count FROM "PrintJob" WHERE "fileId" = $1 AND status IN ('queued','printing')`, [fileId]);
  return res.rows[0].count;
}

async function countAllJobs(pool: Pool, fileId: string): Promise<number> {
  const res = await pool.query(`SELECT COUNT(*)::int AS count FROM "PrintJob" WHERE "fileId" = $1`, [fileId]);
  return res.rows[0].count;
}

async function main() {
  console.log('\n=== PrintShop — PrintJob Concurrency Invariant Test ===');
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  const versionRes = await pool.query('SELECT version()');
  console.log(`  Server: ${versionRes.rows[0].version.split(',')[0]}`);
  assert('Connected to real PostgreSQL', /PostgreSQL 1[0-9]/.test(versionRes.rows[0].version));

  // ── C1. Two workers INSERT for the SAME file — exactly one wins ──
  console.log('\n=== C1. Two workers INSERT same file — exactly one wins ===');
  await resetSchema(pool);
  await seedShopOrderFile(pool, 'shop-C1', 'order-C1', 'file-C1');
  const raceId1 = `c1_${randomUUID().slice(0, 8)}`;
  const w1 = spawnWorker(raceId1, 'w1', 'file-C1', 'shop-C1');
  const w2 = spawnWorker(raceId1, 'w2', 'file-C1', 'shop-C1');
  await waitForReady(pool, raceId1, ['w1', 'w2']);
  await fireStart(pool, raceId1);
  const [r1, r2] = await Promise.all([w1, w2]);
  console.log(`    w1: ${JSON.stringify(r1)}`);
  console.log(`    w2: ${JSON.stringify(r2)}`);
  const winners = [r1, r2].filter((r) => r.inserted);
  const losers = [r1, r2].filter((r) => !r.inserted && r.isUniqueViolation);
  const otherFailures = [r1, r2].filter((r) => !r.inserted && !r.isUniqueViolation);
  assert('exactly one worker INSERT succeeded', winners.length === 1, `got ${winners.length}`);
  assert('exactly one worker got a unique violation (23505)', losers.length === 1, `got ${losers.length}`);
  assert('no other failures', otherFailures.length === 0, `${otherFailures.length} unexpected failures`);
  const activeCount = await countActiveJobs(pool, 'file-C1');
  assert('exactly 1 active PrintJob in the DB', activeCount === 1, `got ${activeCount}`);

  // ── C2. Two workers INSERT for DIFFERENT files — both win ──
  console.log('\n=== C2. Two workers INSERT different files — both win ===');
  await resetSchema(pool);
  // Two different files under the same shop (idempotent seed handles the shop dup).
  await seedShopOrderFile(pool, 'shop-C2', 'order-C2a', 'file-C2a');
  await seedShopOrderFile(pool, 'shop-C2', 'order-C2b', 'file-C2b');
  const raceId2 = `c2_${randomUUID().slice(0, 8)}`;
  const w3 = spawnWorker(raceId2, 'w3', 'file-C2a', 'shop-C2');
  const w4 = spawnWorker(raceId2, 'w4', 'file-C2b', 'shop-C2');
  await waitForReady(pool, raceId2, ['w3', 'w4']);
  await fireStart(pool, raceId2);
  const [r3, r4] = await Promise.all([w3, w4]);
  console.log(`    w3: ${JSON.stringify(r3)}`);
  console.log(`    w4: ${JSON.stringify(r4)}`);
  assert('w3 (file-C2a) INSERT succeeded', r3.inserted === true);
  assert('w4 (file-C2b) INSERT succeeded', r4.inserted === true);
  assert('both different-file jobs exist', await countActiveJobs(pool, 'file-C2a') === 1 && await countActiveJobs(pool, 'file-C2b') === 1);

  // ── C3. Three workers INSERT for the same file — exactly one wins ──
  console.log('\n=== C3. Three workers INSERT same file — exactly one wins ===');
  await resetSchema(pool);
  await seedShopOrderFile(pool, 'shop-C3', 'order-C3', 'file-C3');
  const raceId3 = `c3_${randomUUID().slice(0, 8)}`;
  const workers = [
    spawnWorker(raceId3, 'w5', 'file-C3', 'shop-C3'),
    spawnWorker(raceId3, 'w6', 'file-C3', 'shop-C3'),
    spawnWorker(raceId3, 'w7', 'file-C3', 'shop-C3'),
  ];
  await waitForReady(pool, raceId3, ['w5', 'w6', 'w7']);
  await fireStart(pool, raceId3);
  const results = await Promise.all(workers);
  results.forEach((r, i) => console.log(`    w${5 + i}: ${JSON.stringify(r)}`));
  const winners3 = results.filter((r) => r.inserted);
  const losers3 = results.filter((r) => !r.inserted && r.isUniqueViolation);
  assert('exactly one of three won', winners3.length === 1, `got ${winners3.length}`);
  assert('two of three got unique violations', losers3.length === 2, `got ${losers3.length}`);
  assert('exactly 1 active job in DB', await countActiveJobs(pool, 'file-C3') === 1);

  // ── C4. Reprint after completion: insert → complete → insert again (ok) ──
  console.log('\n=== C4. Reprint after completion — a completed job does NOT block a new one ===');
  await resetSchema(pool);
  await seedShopOrderFile(pool, 'shop-C4', 'order-C4', 'file-C4');
  // First insert (queued)
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-C4-1', 'shop-C4', 'file-C4', 'queued', 0, NOW(), NOW(), NOW())`);
  // Mark completed
  await pool.query(`UPDATE "PrintJob" SET status='completed', "completedAt"=NOW() WHERE id='job-C4-1'`);
  // Second insert — should SUCCEED (the partial index excludes 'completed')
  const raceId4 = `c4_${randomUUID().slice(0, 8)}`;
  const w8 = spawnWorker(raceId4, 'w8', 'file-C4', 'shop-C4');
  await waitForReady(pool, raceId4, ['w8']);
  await fireStart(pool, raceId4);
  const r8 = await w8;
  console.log(`    w8: ${JSON.stringify(r8)}`);
  assert('reprint insert after completion succeeded', r8.inserted === true);
  assert('2 total jobs for the file (1 completed + 1 queued)', await countAllJobs(pool, 'file-C4') === 2);
  assert('1 ACTIVE job (the new reprint)', await countActiveJobs(pool, 'file-C4') === 1);

  // ── C5. needs_review does NOT block a new job ──
  console.log('\n=== C5. needs_review — does NOT block a new job ===');
  await resetSchema(pool);
  await seedShopOrderFile(pool, 'shop-C5', 'order-C5', 'file-C5');
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-C5-1', 'shop-C5', 'file-C5', 'queued', 0, NOW(), NOW(), NOW())`);
  await pool.query(`UPDATE "PrintJob" SET status='needs_review' WHERE id='job-C5-1'`);
  const raceId5 = `c5_${randomUUID().slice(0, 8)}`;
  const w9 = spawnWorker(raceId5, 'w9', 'file-C5', 'shop-C5');
  await waitForReady(pool, raceId5, ['w9']);
  await fireStart(pool, raceId5);
  const r9 = await w9;
  console.log(`    w9: ${JSON.stringify(r9)}`);
  assert('new job after needs_review succeeded', r9.inserted === true);
  assert('2 total jobs (1 needs_review + 1 queued)', await countAllJobs(pool, 'file-C5') === 2);

  // ── C6. A 'printing' job blocks a new job ──
  console.log('\n=== C6. A printing job blocks a new job (23505) ===');
  await resetSchema(pool);
  await seedShopOrderFile(pool, 'shop-C6', 'order-C6', 'file-C6');
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-C6-1', 'shop-C6', 'file-C6', 'printing', 0, NOW(), NOW(), NOW())`);
  const raceId6 = `c6_${randomUUID().slice(0, 8)}`;
  const w10 = spawnWorker(raceId6, 'w10', 'file-C6', 'shop-C6');
  await waitForReady(pool, raceId6, ['w10']);
  await fireStart(pool, raceId6);
  const r10 = await w10;
  console.log(`    w10: ${JSON.stringify(r10)}`);
  assert('insert while printing is BLOCKED (not inserted)', r10.inserted === false);
  assert('the failure is a unique violation (23505)', r10.isUniqueViolation === true);
  assert('still only 1 active job (the printing one)', await countActiveJobs(pool, 'file-C6') === 1);

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
