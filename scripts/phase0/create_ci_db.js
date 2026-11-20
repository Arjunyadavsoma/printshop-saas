// Phase 0: create the printshop_ci database on the local portable Postgres
// (this minimal distribution ships no psql, so we use the pg client).
const { Client } = require('/home/z/my-project/repos/printshop-saas/node_modules/pg');
const c = new Client({ host: '127.0.0.1', port: 5433, user: 'printshop', password: 'printshop', database: 'postgres' });
(async () => {
  await c.connect();
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname='printshop_ci'");
  if (exists.rowCount === 0) {
    await c.query('CREATE DATABASE printshop_ci');
    console.log('created database printshop_ci');
  } else {
    console.log('printshop_ci already exists');
  }
  const v = await c.query('SELECT version()');
  console.log(v.rows[0].version);
  await c.end();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
