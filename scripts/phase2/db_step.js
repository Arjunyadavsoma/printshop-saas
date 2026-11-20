// Phase 2 — DB steps for the payment E2E probe (local portable PG, printshop_dev).
// Usage: bun db_step.js <command> <arg>
//   seed-file <orderId>          insert a completed PrintFile row (₹2.00, 2 pages)
//   get-attempt <orderId>        print the latest PaymentAttempt row as JSON
//   get-status <orderId>         print the Order row status as JSON
//   get-events <merchantOrderId> print PaymentEvent rows for the attempt as JSON
const { Client } = require('/home/z/my-project/repos/printshop-saas/node_modules/pg');

const DB = 'postgresql://printshop:printshop@127.0.0.1:5433/printshop_dev';
const [cmd, arg] = process.argv.slice(2);

(async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    if (cmd === 'seed-file') {
      const o = await c.query('SELECT "shopId" FROM "Order" WHERE id=$1', [arg]);
      if (o.rows.length === 0) throw new Error('order not found: ' + arg);
      const shopId = o.rows[0].shopId;
      await c.query(
        `INSERT INTO "PrintFile" (id, "orderId", "originalFilename", "storageKey", "mimeType",
          "sizeBytes", "pageCount", "pageCountSource", copies, "colorMode", "paperSize", "pricePaise", status,
          "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'auto_extracted',$8,$9,$10,$11,'completed', NOW(), NOW())`,
        [
          require('node:crypto').randomUUID(),
          arg,
          'probe.pdf',
          `shops/${shopId}/orders/${arg}/probe.pdf`,
          'application/pdf',
          1200,
          2,
          1,
          'bw',
          'a4',
          200, // ₹2.00 — the authoritative total checkout will charge
        ],
      );
      console.log(JSON.stringify({ seeded: true, orderId: arg, pricePaise: 200 }));
    } else if (cmd === 'get-attempt') {
      const r = await c.query(
        `SELECT id, "merchantOrderId", "amountPaise", status, "expiresAt", "createdAt"
         FROM "PaymentAttempt" WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
        [arg],
      );
      console.log(JSON.stringify(r.rows[0] ?? null));
    } else if (cmd === 'get-status') {
      const r = await c.query('SELECT id, status, "paidAt" FROM "Order" WHERE id=$1', [arg]);
      console.log(JSON.stringify(r.rows[0] ?? null));
    } else if (cmd === 'get-events') {
      const r = await c.query(
        `SELECT "eventId", "providerTransactionId", "processingStatus", "signatureValid"
         FROM "PaymentEvent" WHERE "merchantOrderId"=$1 ORDER BY "receivedAt" ASC`,
        [arg],
      );
      console.log(JSON.stringify(r.rows));
    } else {
      throw new Error('unknown command: ' + cmd);
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
