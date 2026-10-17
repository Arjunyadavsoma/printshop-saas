/**
 * Completion Worker — standalone bun process that opens its OWN PostgreSQL
 * TCP connection and races to complete a print job.
 *
 * Used by concurrency-harness.test.ts S4 (duplicate completion ack).
 *
 * Usage:
 *   bun run scripts/completion-worker.ts <raceId> <agentId> <jobId> <shopId>
 */
import { Pool } from 'pg';

const [raceId, agentId, jobId, shopId] = process.argv.slice(2);
if (!raceId || !agentId || !jobId || !shopId) {
  console.error('Usage: completion-worker.ts <raceId> <agentId> <jobId> <shopId>');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = 5000`);
    const channel = `race_${raceId}`;
    await client.query(`LISTEN ${channel}`);
    await client.query(`SELECT pg_notify('ready_${raceId}', $1)`, [agentId]);

    await new Promise<void>((resolve) => {
      client.on('notification', (msg) => {
        if (msg.channel === channel && msg.payload === 'START') {
          resolve();
        }
      });
    });

    const res = await client.query(
      `UPDATE "PrintJob" SET status='completed', "completedAt"=NOW()
       WHERE id=$1 AND status='printing' AND "shopId"=$2
       RETURNING id`,
      [jobId, shopId],
    );

    console.log(JSON.stringify({ agentId, won: res.rows.length }));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ agentId, won: -1, error: String(e) }));
  process.exit(1);
});
