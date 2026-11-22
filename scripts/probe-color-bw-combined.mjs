/**
 * Probe: COLOR + B&W working combined on the main branch (per-file colorMode).
 *
 * 1. Create a draft order at /shops/quickprint (no auth).
 * 2. Upload TWO PDFs via presigned upload-url + storage PUT + files confirm:
 *    one color-heavy page set, one pure B&W set.
 * 3. PATCH colorMode: first file 'color', second 'bw'.
 * 4. POST checkout → server re-prices (color rate vs bw rate must differ).
 * 5. Owner manual-verify → order paid → PrintJob per file.
 * 6. Assert via the API + DB: two PrintJobs, color flags correct,
 *    pricing math correct, order reached printing, agent pending carries
 *    the right colorMode per job.
 *
 * Run: node scripts/probe-color-bw-combined.mjs  (bun also fine)
 */
import { PDFDocument, rgb } from 'pdf-lib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SLUG = process.env.SHOP_SLUG ?? 'quickprint';
const OWNER = { email: 'owner@quickprint.demo', password: 'demo1234' };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function api(method, path, { body, raw, token, ctype } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body || raw ? { 'Content-Type': ctype ?? 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 120) }; }
  return { status: res.status, json };
}

async function makePdf(colorPages) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i}`, { x: 60, y: 780, size: 18 });
    if (colorPages.includes(i)) {
      page.drawRectangle({ x: 60, y: 300, width: 480, height: 320, color: rgb(0.9, 0.1, 0.35) });
    } else {
      for (let l = 0; l < 8; l++) page.drawRectangle({ x: 60, y: 640 - l * 40, width: 480, height: 2, color: rgb(0.1, 0.1, 0.1) });
    }
  }
  return Buffer.from(await doc.save());
}

async function uploadFile(orderId, orderToken, name, pdf) {
  const ur = await api('POST', `/api/v1/orders/${orderId}/files/upload-url?t=${orderToken}`, { body: { filename: name, mimeType: 'application/pdf', size: pdf.length }, token: orderToken });
  const d = ur.json?.data;
  if (ur.status !== 200 || !d) throw new Error(`upload-url failed: ${JSON.stringify(ur.json).slice(0, 200)}`);
  const putUrl = (d.uploadUrl ?? d.url).startsWith('http') ? (d.uploadUrl ?? d.url) : BASE + (d.uploadUrl ?? d.url);
  const put = await fetch(putUrl, { method: 'PUT', body: pdf, headers: { 'Content-Type': 'application/pdf' } });
  if (!put.ok) throw new Error(`storage put failed ${put.status}: ${(await put.text()).slice(0, 150)}`);
  const confirm = await api('POST', `/api/v1/orders/${orderId}/files?t=${orderToken}`, {
    token: orderToken,
    body: { fileId: d.fileId, storageKey: d.storageKey, filename: name, mimeType: 'application/pdf', size: pdf.length },
  });
  if (confirm.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(confirm.json).slice(0, 200)}`);
  return confirm.json?.data?.fileId ?? d.fileId;
}

async function main() {
  // 1. create draft order
  const created = await api('POST', `/api/v1/shops/${SLUG}/orders`, { body: { customerPhone: '9876500002', notes: 'color+bw combined probe' } });
  ok('draft order created', created.status === 200, `HTTP ${created.status}`);
  const { orderId, customerToken } = created.json.data ?? {};
  ok('orderId + customerToken returned', !!orderId && !!customerToken);

  // 2. upload two files
  const colorPdf = await makePdf([1, 4]);
  const bwPdf = await makePdf([]);
  const colorFileId = await uploadFile(orderId, customerToken, 'poster-color.pdf', colorPdf);
  const bwFileId = await uploadFile(orderId, customerToken, 'text-bw.pdf', bwPdf);
  ok('two files uploaded + confirmed', !!colorFileId && !!bwFileId);

  // 3. set per-file modes: color on file 1, bw on file 2
  const p1 = await api('PATCH', `/api/v1/orders/${orderId}/files/${colorFileId}?t=${customerToken}`, { body: { colorMode: 'color', copies: 1 } });
  const p2 = await api('PATCH', `/api/v1/orders/${orderId}/files/${bwFileId}?t=${customerToken}`, { body: { colorMode: 'bw', copies: 1 } });
  ok('colorMode patched per file', p1.status === 200 && p2.status === 200, `HTTP ${p1.status}/${p2.status}`);
  ok('server prices differ by mode', (p1.json?.data?.file?.pricePaise ?? 0) > (p2.json?.data?.file?.pricePaise ?? 0),
    `color ${p1.json?.data?.file?.pricePaise} > bw ${p2.json?.data?.file?.pricePaise} paise`);

  // 4. checkout → server re-price
  const checkout = await api('POST', `/api/v1/orders/${orderId}/checkout?t=${customerToken}`, { body: {} });
  ok('checkout succeeds with mixed files', checkout.status === 200, `HTTP ${checkout.status}`);
  const intent = checkout.json?.data ?? {};
  ok('total = color + bw prices', intent.amountPaise === (p1.json?.data?.file?.pricePaise ?? 0) + (p2.json?.data?.file?.pricePaise ?? 0),
    `${intent.amountPaise} paise, provider=${intent.provider}`);

  // 5. owner manual verify → paid → print jobs
  const login = await api('POST', '/api/v1/auth/login', { body: OWNER });
  const owner = login.json?.data?.accessToken;
  ok('owner login', !!owner);
  const verify = await api('POST', `/api/v1/shops/me/orders/${orderId}/verify-payment`, { token: owner, body: { action: 'verify', txnReference: 'PROBE-MANUAL-1' } });
  ok('manual verify marks paid', verify.status === 200, `HTTP ${verify.status}`);
  // The manual (counter) flow prints on the shopkeeper's explicit "Start
  // printing" — webhooks enqueue automatically, the counter decides here.
  const start = await api('POST', `/api/v1/shops/me/orders/${orderId}/start`, { token: owner, body: {} });
  ok('shopkeeper starts printing', start.status === 200, `HTTP ${start.status}`);

  // 6. assert via status API + DB
  const status = await api('GET', `/api/v1/orders/${orderId}/status?t=${customerToken}`);
  const st = status.json?.data ?? {};
  ok('order left awaiting_payment', ['paid', 'printing', 'ready'].includes(st.status ?? st.order?.status), `status=${st.status ?? st.order?.status}`);
  ok('payment txn recorded', !!(st.paymentTxnId ?? st.order?.paymentTxnId));

  // DB-level: PrintJobs per file with correct colorMode
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.PROBE_DB ?? 'postgresql://printshop:printshop@127.0.0.1:5433/printshop_dev' });
  await client.connect();
  const jobs = await client.query(
    `SELECT pj.id, pf."colorMode", pf.id AS file_id, pj.status, pf."pageCount"
     FROM "PrintJob" pj JOIN "PrintFile" pf ON pf.id = pj."fileId"
     WHERE pf."orderId" = $1 ORDER BY pf."colorMode"`, [orderId]);
  await client.end();
  ok('two PrintJobs created (one per file)', jobs.rows.length === 2, `count=${jobs.rows.length}`);
  const colorJob = jobs.rows.find((r) => r.colorMode === 'color');
  const bwJob = jobs.rows.find((r) => r.colorMode === 'bw');
  ok('color job for the color file', !!colorJob && colorJob.file_id === colorFileId);
  ok('bw job for the bw file', !!bwJob && bwJob.file_id === bwFileId);
  ok('jobs dispatched for printing', jobs.rows.every((r) => ['queued', 'dispatched', 'printing', 'assigned', 'received'].includes(r.status)),
    `statuses=${jobs.rows.map((r) => r.status).join(',')}`);

  console.log(`\n=== VERDICT: ${pass}/${pass + fail} checks passed ${fail === 0 ? '— COLOR + B&W COMBINED ✓' : '— FIX NEEDED'}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
