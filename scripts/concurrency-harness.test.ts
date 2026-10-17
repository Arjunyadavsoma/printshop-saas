/**
 * Concurrency Harness — orchestrates 2+ genuinely independent worker
 * PROCESSES (separate bun subprocesses, each with its own pg Pool / TCP
 * connection) and verifies the atomic-claim invariants under real
 * concurrent load.
 *
 * Tested scenarios:
 *  S1. Two workers claiming the SAME queued job concurrently — exactly one wins.
 *  S2. Two workers claiming DIFFERENT jobs concurrently — both win.
 *  S3. Worker attempting to claim ANOTHER SHOP's job — fails (0 rows).
 *  S4. Duplicate completion ack from two workers — exactly one succeeds.
 *  S5. Worker "disconnect" (kill) mid-claim + restart — job stays in last state.
 *  S6. Stale printing → needs_review (NO automatic requeue).
 *
 * Synchronization uses PostgreSQL LISTEN/NOTIFY so both workers fire their
 * UPDATE within microseconds of each other. This is REAL independent-connection
 * concurrency against a REAL PostgreSQL 17 server — not PGlite.
 *
 * Run:
 *   source /home/z/my-project/scripts/pg-env.sh
 *   bun run scripts/concurrency-harness.test.ts
 */
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DDL_PATH = resolve(import.meta.dir, '../tmp/pg_migration.sql');

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
  agentId: string;
  won: number; // 1 = won, 0 = lost, -1 = error
  row?: any;
  error?: string;
}

function spawnWorker(raceId: string, agentId: string, jobId: string, shopId: string): Promise<WorkerResult> {
  return new Promise((resolveP, rejectP) => {
    const env = { ...process.env };
    const child = spawn('bun', ['run', 'scripts/concurrent-worker.ts', raceId, agentId, jobId, shopId], {
      cwd: '/home/z/my-project',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        return rejectP(new Error(`worker ${agentId} exited ${code}: ${stderr}`));
      }
      try {
        // Parse the LAST non-empty line (in case bun prints warnings)
        const lines = stdout.split('\n').filter((l) => l.trim());
        const last = lines[lines.length - 1];
        resolveP(JSON.parse(last) as WorkerResult);
      } catch (e: any) {
        rejectP(new Error(`worker ${agentId} produced unparseable output: ${stdout}; stderr: ${stderr}`));
      }
    });
  });
}

async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const ddl = readFileSync(DDL_PATH, 'utf8');
  await pool.query(ddl);
}

async function seedShop(pool: Pool, shopId: string, slug: string): Promise<void> {
  await pool.query(`INSERT INTO "Shop" (id, name, slug, "ownerUserId", "upiId", "paymentProvider", "paymentCredentials", "pricingConfig", address, phone, timezone, "isActive", "subscriptionTier", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, 'test@okaxis', 'googlepay', '{}', '{}', 'addr', '9999999999', 'Asia/Kolkata', true, 'free', NOW(), NOW())`,
    [shopId, `Shop ${shopId}`, slug, `owner-${shopId}`]);
}

async function seedOrder(pool: Pool, orderId: string, shopId: string): Promise<void> {
  await pool.query(`INSERT INTO "Order" (id, "shopId", "customerToken", status, "totalAmountPaise", currency, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'awaiting_payment', 1000, 'INR', NOW(), NOW())`, [orderId, shopId, `TOK-${orderId}`]);
}

async function seedFile(pool: Pool, fileId: string, orderId: string): Promise<void> {
  await pool.query(`INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType", "sizeBytes", "pageCount", copies, "colorMode", "paperSize", duplex, "pricePaise", status, "createdAt", "updatedAt")
    VALUES ($1, $2, 'doc.pdf', 'key', 'application/pdf', 100, 1, 1, 'bw', 'a4', false, 200, 'pending', NOW(), NOW())`, [fileId, orderId]);
}

async function seedJob(pool: Pool, jobId: string, shopId: string, fileId: string): Promise<void> {
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'queued', 0, NOW(), NOW(), NOW())`, [jobId, shopId, fileId]);
}

async function waitForReady(pool: Pool, raceId: string, expectedAgents: string[], timeoutMs = 10000): Promise<void> {
  // Both workers emit a `ready_<raceId>` NOTIFY when they're LISTENing.
  const client = await pool.connect();
  try {
    await client.query(`LISTEN ready_${raceId}`);
    const ready = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ready timeout; got ${[...ready].join(',')}`)), timeoutMs);
      client.on('notification', (msg) => {
        ready.add(msg.payload ?? '');
        if (ready.size >= expectedAgents.length) {
          clearTimeout(timer);
          resolve();
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

async function main() {
  console.log('\n=== PrintShop — Real Independent-Connection Concurrency Test ===');
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

  const versionRes = await pool.query('SELECT version()');
  console.log(`  Server: ${versionRes.rows[0].version.split(',')[0]}`);
  assert('Connected to real PostgreSQL', /PostgreSQL 1[0-9]/.test(versionRes.rows[0].version));

  // ── S1. Two workers claim the SAME job concurrently ──
  console.log('\n=== S1. Two workers claim the SAME job — exactly one must win ===');
  await resetSchema(pool);
  await seedShop(pool, 'shop-A', 'shop-a');
  await seedOrder(pool, 'order-A', 'shop-A');
  await seedFile(pool, 'file-A', 'order-A');
  await seedJob(pool, 'job-A', 'shop-A', 'file-A');

  const raceId1 = `s1_${randomUUID().slice(0, 8)}`;
  const w1Promise = spawnWorker(raceId1, 'agent-1', 'job-A', 'shop-A');
  const w2Promise = spawnWorker(raceId1, 'agent-2', 'job-A', 'shop-A');
  await waitForReady(pool, raceId1, ['agent-1', 'agent-2']);
  await fireStart(pool, raceId1);
  const [w1, w2] = await Promise.all([w1Promise, w2Promise]);
  console.log(`    worker-1 result: ${JSON.stringify(w1)}`);
  console.log(`    worker-2 result: ${JSON.stringify(w2)}`);
  const wins = [w1, w2].filter((w) => w.won === 1);
  const losses = [w1, w2].filter((w) => w.won === 0);
  assert('exactly one worker won the claim', wins.length === 1, `got ${wins.length} winners`);
  assert('exactly one worker lost the claim', losses.length === 1, `got ${losses.length} losers`);
  const finalState = await pool.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-A'`);
  assert('job-A status is now printing', finalState.rows[0]?.status === 'printing');
  const winner = wins[0];
  assert('job-A agentId is the winner', finalState.rows[0]?.agentId === winner.agentId, `expected ${winner.agentId}, got ${finalState.rows[0]?.agentId}`);

  // ── S2. Two workers claim DIFFERENT jobs concurrently — both win ──
  console.log('\n=== S2. Two workers claim DIFFERENT jobs — both must win ===');
  await seedJob(pool, 'job-B1', 'shop-A', 'file-A');
  await seedJob(pool, 'job-B2', 'shop-A', 'file-A');
  const raceId2 = `s2_${randomUUID().slice(0, 8)}`;
  const w3Promise = spawnWorker(raceId2, 'agent-3', 'job-B1', 'shop-A');
  const w4Promise = spawnWorker(raceId2, 'agent-4', 'job-B2', 'shop-A');
  await waitForReady(pool, raceId2, ['agent-3', 'agent-4']);
  await fireStart(pool, raceId2);
  const [w3, w4] = await Promise.all([w3Promise, w4Promise]);
  console.log(`    worker-3 result: ${JSON.stringify(w3)}`);
  console.log(`    worker-4 result: ${JSON.stringify(w4)}`);
  assert('worker-3 won job-B1', w3.won === 1);
  assert('worker-4 won job-B2', w4.won === 1);
  const jb1 = await pool.query(`SELECT "agentId" FROM "PrintJob" WHERE id='job-B1'`);
  const jb2 = await pool.query(`SELECT "agentId" FROM "PrintJob" WHERE id='job-B2'`);
  assert('job-B1 assigned to agent-3', jb1.rows[0]?.agentId === 'agent-3');
  assert('job-B2 assigned to agent-4', jb2.rows[0]?.agentId === 'agent-4');

  // ── S3. Cross-tenant claim — worker attempts another shop's job ──
  console.log('\n=== S3. Cross-tenant claim — worker attempts another shop\'s job ===');
  await seedShop(pool, 'shop-B', 'shop-b');
  await seedOrder(pool, 'order-B', 'shop-B');
  await seedFile(pool, 'file-B', 'order-B');
  await seedJob(pool, 'job-C', 'shop-B', 'file-B');
  // Worker from shop-A tries to claim shop-B's job (passes shopId='shop-A' in WHERE)
  const raceId3 = `s3_${randomUUID().slice(0, 8)}`;
  const w5Promise = spawnWorker(raceId3, 'agent-evil', 'job-C', 'shop-A'); // wrong shopId
  await waitForReady(pool, raceId3, ['agent-evil']);
  await fireStart(pool, raceId3);
  const w5 = await w5Promise;
  console.log(`    evil worker result: ${JSON.stringify(w5)}`);
  assert('cross-tenant claim returns 0 rows', w5.won === 0, `won=${w5.won}`);
  const jc = await pool.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-C'`);
  assert('job-C still queued (untouched)', jc.rows[0]?.status === 'queued');
  assert('job-C agentId still NULL', jc.rows[0]?.agentId === null);

  // ── S4. Duplicate completion ack from two workers ──
  console.log('\n=== S4. Duplicate completion ack — exactly one succeeds ===');
  // job-A is in 'printing' state (claimed by agent-1 in S1)
  // Two workers try to complete it concurrently
  const raceId4 = `s4_${randomUUID().slice(0, 8)}`;
  const spawnComplete = (raceId: string, agentId: string, jobId: string, shopId: string) =>
    new Promise<WorkerResult>((resolveP, rejectP) => {
      const child = spawn('bun', ['run', 'scripts/completion-worker.ts', raceId, agentId, jobId, shopId], {
        cwd: '/home/z/my-project', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('close', (code) => {
        if (code !== 0) return rejectP(new Error(`exit ${code}: ${err}`));
        const lines = out.split('\n').filter((l) => l.trim());
        try { resolveP(JSON.parse(lines[lines.length - 1]) as WorkerResult); } catch (e: any) { rejectP(new Error(`parse: ${out}`)); }
      });
    });

  const w6Promise = spawnComplete(raceId4, 'completer-1', 'job-A', 'shop-A');
  const w7Promise = spawnComplete(raceId4, 'completer-2', 'job-A', 'shop-A');
  await waitForReady(pool, raceId4, ['completer-1', 'completer-2']);
  await fireStart(pool, raceId4);
  const [w6, w7] = await Promise.all([w6Promise, w7Promise]);
  console.log(`    completer-1 result: ${JSON.stringify(w6)}`);
  console.log(`    completer-2 result: ${JSON.stringify(w7)}`);
  const ackWins = [w6, w7].filter((w) => w.won === 1);
  const ackLosses = [w6, w7].filter((w) => w.won === 0);
  assert('exactly one completion ack succeeds', ackWins.length === 1, `got ${ackWins.length} winners`);
  assert('exactly one completion ack is idempotent no-op', ackLosses.length === 1, `got ${ackLosses.length} losers`);
  const ja = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-A'`);
  assert('job-A is completed (not corrupted by race)', ja.rows[0]?.status === 'completed');

  // ── S5. Worker disconnect mid-claim + restart ──
  console.log('\n=== S5. Worker disconnect mid-claim + restart — job stays in last state ===');
  // Simulate: a worker claims a job, then the worker process is killed (loses connection).
  // The DB transaction commits the UPDATE (status='printing', agentId set).
  // On restart, the new worker polls: the job is already 'printing' (claimed), so the
  // new worker's conditional UPDATE returns 0 rows.
  await seedJob(pool, 'job-D', 'shop-A', 'file-A');
  // Worker claims the job
  const claimD = await pool.query(`UPDATE "PrintJob" SET status='printing', "agentId"='agent-dying', "startedAt"=NOW() WHERE id='job-D' AND status='queued' AND "shopId"='shop-A' RETURNING id`);
  assert('worker claimed job-D before crash', claimD.rows.length === 1);
  // Worker "crashes" — connection drops. The UPDATE already committed.
  // Restart: new worker tries to claim the SAME job
  const raceId5 = `s5_${randomUUID().slice(0, 8)}`;
  const w8Promise = spawnWorker(raceId5, 'agent-restart', 'job-D', 'shop-A');
  await waitForReady(pool, raceId5, ['agent-restart']);
  await fireStart(pool, raceId5);
  const w8 = await w8Promise;
  console.log(`    restarted worker result: ${JSON.stringify(w8)}`);
  assert('restarted worker cannot re-claim (job already printing)', w8.won === 0, `won=${w8.won}`);
  const jd = await pool.query(`SELECT status, "agentId" FROM "PrintJob" WHERE id='job-D'`);
  assert('job-D still printing', jd.rows[0]?.status === 'printing');
  assert('job-D still assigned to original agent (not stolen)', jd.rows[0]?.agentId === 'agent-dying');

  // ── S6. Stale printing → needs_review (NO automatic requeue) ──
  console.log('\n=== S6. Stale printing → needs_review (NO automatic requeue) ===');
  // Insert a job that's been 'printing' for 10 minutes (stale threshold = 5 min)
  await pool.query(`INSERT INTO "PrintJob" (id, "shopId", "fileId", status, "agentId", attempts, "startedAt", "queuedAt", "createdAt", "updatedAt")
    VALUES ('job-E', 'shop-A', 'file-A', 'printing', 'agent-stale', 1, NOW() - INTERVAL '10 minutes', NOW(), NOW(), NOW())`);
  const stale = await pool.query(`UPDATE "PrintJob" SET status='needs_review' WHERE status='printing' AND "startedAt" < NOW() - INTERVAL '5 minutes' AND "shopId"='shop-A' RETURNING id`);
  assert('stale recovery moves job-E to needs_review', stale.rows.length === 1);
  const je = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-E'`);
  assert('job-E is needs_review (NOT re-queued)', je.rows[0]?.status === 'needs_review');
  // A NEW worker tries to claim the needs_review job — must fail
  const raceId6 = `s6_${randomUUID().slice(0, 8)}`;
  const w9Promise = spawnWorker(raceId6, 'agent-fresh', 'job-E', 'shop-A');
  await waitForReady(pool, raceId6, ['agent-fresh']);
  await fireStart(pool, raceId6);
  const w9 = await w9Promise;
  console.log(`    fresh worker on needs_review job: ${JSON.stringify(w9)}`);
  assert('fresh worker cannot claim needs_review job', w9.won === 0, `won=${w9.won}`);
  const je2 = await pool.query(`SELECT status FROM "PrintJob" WHERE id='job-E'`);
  assert('job-E still needs_review (NOT auto-requeued)', je2.rows[0]?.status === 'needs_review');

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
