/**
 * Concurrent Print-Worker — a standalone bun process that opens its OWN
 * independent PostgreSQL TCP connection and races to claim a print job.
 *
 * Each worker is a SEPARATE process with its own event loop, its own pg
 * client, its own TCP connection to PostgreSQL. This is genuinely
 * independent-connection concurrency (NOT PGlite's single-connection).
 *
 * Protocol:
 *  1. Connect to PostgreSQL (own Pool with max=1 connection).
 *  2. LISTEN on channel `race_<raceId>`.
 *  3. Wait for the START NOTIFY (issued by the harness when all workers are ready).
 *  4. On notify, immediately issue the conditional UPDATE that claims the job:
 *       UPDATE "PrintJob" SET status='printing', "agentId"=$1, "startedAt"=NOW()
 *       WHERE id=$2 AND status='queued' AND "shopId"=$3
 *       RETURNING id, "agentId";
 *  5. Print a single JSON line to stdout: { agentId, won: <0|1>, rows: [...] }
 *  6. Exit 0.
 *
 * Usage:
 *   bun run scripts/concurrent-worker.ts <raceId> <agentId> <jobId> <shopId>
 */
import { Pool } from 'pg';

const [raceId, agentId, jobId, shopId] = process.argv.slice(2);
if (!raceId || !agentId || !jobId || !shopId) {
  console.error('Usage: concurrent-worker.ts <raceId> <agentId> <jobId> <shopId>');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // single connection per worker — guarantees independence
});

async function main() {
  const client = await pool.connect();
  try {
    // Set a statement timeout so a stuck worker can't hang the test
    await client.query(`SET statement_timeout = 5000`);
    // LISTEN for the race start signal
    await client.query(`LISTEN race_${raceId}`);
    // Notify the harness that this worker is ready
    await client.query(`SELECT pg_notify('ready_${raceId}', $1)`, [agentId]);

    // Wait for the START signal
    await new Promise<void>((resolve) => {
      client.on('notification', (msg) => {
        if (msg.channel === `race_${raceId}` && msg.payload === 'START') {
          resolve();
        }
      });
    });

    // ── RACE: immediately issue the conditional UPDATE ──
    const res = await client.query(
      `UPDATE "PrintJob" SET status='printing', "agentId"=$1, "startedAt"=NOW()
       WHERE id=$2 AND status='queued' AND "shopId"=$3
       RETURNING id, "agentId", status`,
      [agentId, jobId, shopId],
    );

    const result = {
      agentId,
      won: res.rows.length, // 1 = won the claim, 0 = lost
      row: res.rows[0] ?? null,
    };
    // Single JSON line — the harness parses this
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ agentId, won: -1, error: String(e) }));
  process.exit(1);
});
