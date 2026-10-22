/**
 * Concurrent PrintJob-INSERT worker — a standalone bun process that opens
 * its OWN PostgreSQL TCP connection and races to INSERT a PrintJob for a
 * specific file. The partial unique index (PrintJob_active_file_unique)
 * ensures at most one worker succeeds; the other(s) get a unique constraint
 * violation (SQLSTATE 23505).
 *
 * This is the database-enforced invariant test. It does NOT use the
 * application's Prisma client — it uses the raw `pg` driver to test that the
 * PARTIAL UNIQUE INDEX itself prevents the check-then-insert TOCTOU race.
 *
 * Usage:
 *   bun run scripts/printjob-concurrent-worker.ts <raceId> <workerLabel> <fileId> <shopId>
 */
import { Pool } from 'pg';

const [raceId, workerLabel, fileId, shopId] = process.argv.slice(2);
if (!raceId || !workerLabel || !fileId || !shopId) {
  console.error('Usage: printjob-concurrent-worker.ts <raceId> <workerLabel> <fileId> <shopId>');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // single connection per worker — guarantees independence
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = 5000`);
    // Quote the channel identifier — raceId may contain characters that
    // PostgreSQL would parse as arithmetic (e.g., hyphens).
    const channel = `"race_${raceId}"`;
    await client.query(`LISTEN ${channel}`);
    // Signal ready
    await client.query(`SELECT pg_notify('ready_${raceId}', $1)`, [workerLabel]);

    // Wait for the START signal
    await new Promise<void>((resolve) => {
      client.on('notification', (msg) => {
        // msg.channel comes back WITHOUT quotes
        if (msg.channel === `race_${raceId}` && msg.payload === 'START') {
          resolve();
        }
      });
    });

    // ── RACE: INSERT a PrintJob for the same file ──
    // The partial unique index (WHERE status IN ('queued','printing')) should
    // cause exactly one worker to succeed and the other(s) to get a 23505.
    const jobId = `race_${raceId}_${workerLabel}`;
    try {
      const res = await client.query(
        `INSERT INTO "PrintJob" (id, "shopId", "fileId", status, attempts, "queuedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'queued', 0, NOW(), NOW(), NOW())
         RETURNING id`,
        [jobId, shopId, fileId],
      );
      console.log(JSON.stringify({ workerLabel, inserted: true, rows: res.rows.length, jobId }));
    } catch (e: any) {
      // Check for unique constraint violation (SQLSTATE 23505)
      const code = e.code ?? '';
      const isUnique = code === '23505' || /unique constraint/i.test(e.message ?? '') || /duplicate key/i.test(e.message ?? '');
      console.log(JSON.stringify({ workerLabel, inserted: false, error: code || e.message, isUniqueViolation: isUnique }));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ workerLabel, inserted: false, error: String(e), isUniqueViolation: false }));
  process.exit(1);
});
