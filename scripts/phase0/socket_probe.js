// Phase 0c — realtime end-to-end probe against the LOCAL stack:
//   next dev :3000  (register + login -> shop-owner access JWT)
//   realtime :3003  (socket.io, auth event, room shop:<shopId>)
//   realtime :3004  (POST /emit relay, x-emit-secret)
// Asserts: connect -> auth-ok -> relayed event delivered to the room.
const io = require('/home/z/my-project/repos/printshop-saas/node_modules/socket.io-client');

const API = 'http://127.0.0.1:3000/api/v1';
const WS = 'http://127.0.0.1:3003';
const EMIT = 'http://127.0.0.1:3004/emit';
const EMIT_SECRET = 'dev-emit-secret';
const stamp = String(Math.floor(Date.now() / 1000));

async function api(path, method, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

(async () => {
  const results = [];
  const rec = (step, ok, detail) => { results.push(ok); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${step}: ${detail}`); };

  // 1. register + login (shop owner)
  const email = `qa-socket-${stamp}@printshop.test`;
  const reg = await api('/auth/register', 'POST', {
    email, password: 'TestPass123!', name: 'QA Socket', shopName: `QA Socket Shop ${stamp}`,
    phone: '9876543210', slug: `qa-socket-${stamp}`, upiId: 'qasocket@upi',
    address: 'QA', services: ['bw_print'], paymentMethods: 'both',
  });
  rec('register (owner)', reg.status === 200 || reg.status === 201 || reg.status === 409, `HTTP ${reg.status}`);
  const login = await api('/auth/login', 'POST', { email, password: 'TestPass123!' });
  const token = (login.json.data || {}).accessToken || '';
  const shopId = ((login.json.data || {}).user || {}).shopId || '';
  rec('login (owner JWT)', login.status === 200 && !!token && !!shopId, `HTTP ${login.status}, shopId=${shopId}`);

  // 2. socket connect + auth
  const socket = io(WS, { path: '/', transports: ['websocket'], reconnection: false, timeout: 5000 });
  const authOk = new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 8000);
    socket.on('auth-ok', (d) => { clearTimeout(t); resolve(d); });
    socket.on('auth-error', (d) => { clearTimeout(t); resolve({ error: d }); });
    socket.on('connect_error', (e) => { clearTimeout(t); resolve({ error: e.message }); });
  });
  socket.on('connect', () => socket.emit('auth', { token }));
  const auth = await authOk;
  rec('socket auth-ok', !!(auth && auth.shopId), JSON.stringify(auth));

  // 3. relay emit -> room delivery
  const got = new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 6000);
    socket.on('test.hello', (p) => { clearTimeout(t); resolve(p); });
  });
  const emitRes = await fetch(EMIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-emit-secret': EMIT_SECRET },
    body: JSON.stringify({ channel: `shop:${shopId}`, event: 'test.hello', payload: { n: 42 } }),
  });
  rec('POST /emit relay', emitRes.status === 200, `HTTP ${emitRes.status}`);
  const payload = await got;
  rec('event delivered to shop room', payload && payload.n === 42, JSON.stringify(payload));

  // 4. negative: bad secret rejected
  const bad = await fetch(EMIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-emit-secret': 'wrong' },
    body: JSON.stringify({ channel: `shop:${shopId}`, event: 'test.hello', payload: {} }),
  });
  rec('emit rejects bad secret (401)', bad.status === 401, `HTTP ${bad.status}`);

  socket.disconnect();
  const passed = results.filter(Boolean).length;
  console.log(`\nREALTIME: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
