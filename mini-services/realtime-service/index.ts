/**
 * Realtime mini-service — the WebSocket relay for the shop dashboard.
 *
 * Runs on TWO ports in one process:
 *  - 3003: socket.io server (path '/'), for browser dashboards (via Caddy
 *    `/?XTransformPort=3003`). Clients authenticate with the shop-owner JWT
 *    (HS256, verified with JWT_ACCESS_SECRET) and join room `shop:<shopId>`.
 *  - 3004: plain HTTP `POST /emit` relay, for the Next.js RealtimeAdapter to
 *    push events server-to-server (bypasses Caddy; authenticated with
 *    REALTIME_EMIT_SECRET). Broadcasts to the shop rooms.
 *
 * Both ports share the same `io` instance, so an /emit POST reaches every
 * connected dashboard in the target shop room.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Server, type Socket } from 'socket.io';

const PORT_WS = 3003;
const PORT_EMIT = 3004;
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me';
const EMIT_SECRET = process.env.REALTIME_EMIT_SECRET ?? 'dev-emit-secret';
const MAX_EMIT_BODY = 64 * 1024; // 64 KB — events are small payloads

// Fail-fast in production if the secrets are still the dev defaults.
if (process.env.NODE_ENV === 'production') {
  const DEV = new Set(['dev-access-secret-change-me', 'dev-emit-secret']);
  if (!process.env.JWT_ACCESS_SECRET || DEV.has(process.env.JWT_ACCESS_SECRET)) {
    console.error('FATAL: JWT_ACCESS_SECRET is missing or still the dev default.');
    process.exit(1);
  }
  if (!process.env.REALTIME_EMIT_SECRET || DEV.has(process.env.REALTIME_EMIT_SECRET)) {
    console.error('FATAL: REALTIME_EMIT_SECRET is missing or still the dev default.');
    process.exit(1);
  }
}

/** Timing-safe comparison that handles unequal-length inputs (doesn't throw). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface JwtClaims {
  sub: string;
  shopId: string | null;
  role: string;
  type: string;
  exp: number;
}

/** Verify an HS256 JWT and return its claims, or null. */
function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64!, 'base64url');
  } catch {
    return null;
  }
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8')) as JwtClaims;
    if (typeof claims.exp !== 'number' || Date.now() / 1000 > claims.exp) return null;
    if (claims.type !== 'access') return null;
    return claims;
  } catch {
    return null;
  }
}

// --- socket.io server (browser dashboards) ---
// CORS: restrict to configured origins in production; allow all in dev.
const CORS_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : '*'; // dev default
const wsHttp = createServer();
const io = new Server(wsHttp, {
  path: '/',
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on('connection', (socket: Socket) => {
  // The client must send its JWT before any events are accepted.
  socket.on('auth', (data: { token?: string }) => {
    const token = data?.token;
    if (!token) {
      socket.emit('auth-error', { message: 'missing token' });
      socket.disconnect(true);
      return;
    }
    const claims = verifyJwt(token);
    if (!claims || !claims.shopId) {
      socket.emit('auth-error', { message: 'invalid or expired token' });
      socket.disconnect(true);
      return;
    }
    socket.data.claims = claims;
    socket.join(`shop:${claims.shopId}`);
    socket.emit('auth-ok', { shopId: claims.shopId, role: claims.role });
  });

  socket.on('disconnect', () => {
    /* rooms auto-cleaned */
  });
});

// --- HTTP /emit relay (Next.js RealtimeAdapter → dashboard rooms) ---
const emitHttp = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/emit')) {
    res.writeHead(404).end('not found');
    return;
  }
  const secret = req.headers['x-emit-secret'];
  if (typeof secret !== 'string' || !safeEqual(secret, EMIT_SECRET)) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  // Bounded body read (prevents memory exhaustion).
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const c of req) {
      total += c.length;
      if (total > MAX_EMIT_BODY) { res.writeHead(413).end('body too large'); return; }
      chunks.push(c as Buffer);
    }
  } catch {
    res.writeHead(400).end('read error');
    return;
  }
  let body: { channel?: string; event?: string; payload?: unknown };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400).end('invalid json');
    return;
  }
  if (!body.channel || !body.event || typeof body.channel !== 'string' || typeof body.event !== 'string') {
    res.writeHead(400).end('missing channel/event');
    return;
  }
  // Only allow shop-channel broadcasts (prevents spoofing system/internal rooms).
  if (!body.channel.startsWith('shop:')) {
    res.writeHead(403).end('channel not allowed');
    return;
  }
  try {
    io.to(body.channel).emit(body.event, body.payload ?? null);
    res.writeHead(200).end('ok');
  } catch {
    res.writeHead(500).end('emit error');
  }
});

wsHttp.listen(PORT_WS, () => console.log(`[realtime] socket.io on :${PORT_WS}`));
emitHttp.listen(PORT_EMIT, () => console.log(`[realtime] /emit relay on :${PORT_EMIT}`));

process.on('SIGTERM', () => { wsHttp.close(); emitHttp.close(); process.exit(0); });
process.on('SIGINT', () => { wsHttp.close(); emitHttp.close(); process.exit(0); });
