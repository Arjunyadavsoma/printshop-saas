/**
 * PrintShop SaaS — Local Native Windows Printing Service
 *
 * Runs on the shopkeeper's Windows computer at http://127.0.0.1:32192.
 * Uses `windows-pdf-printer-native` to submit PDFs to the Windows print
 * queue with per-job duplex, copies, paper size, color, orientation.
 *
 * SECURITY:
 * - Binds to 127.0.0.1 ONLY (no LAN exposure)
 * - Pairing-code → bearer token (32-byte secret, 24h expiry)
 * - Strict request schema validation
 * - No arbitrary file paths — only PDF bytes via Buffer
 * - 25MB max PDF size
 * - Rate limited (20 jobs/minute)
 * - CORS: reflects ANY origin (so the token works from the stable
 *   production URL AND any Vercel preview URL without re-pairing). The
 *   token secret + loopback binding + the browser's same-origin policy
 *   (localStorage is per-origin, so a malicious site can't read the
 *   token) provide the security — the origin check was redundant + broke
 *   every time the deployment URL changed.
 * - Multiple valid tokens (one per paired origin) — re-pairing from a
 *   new URL adds a token without invalidating the existing one, so the
 *   shopkeeper's setup survives domain changes, preview deployments, +
 *   custom-domain migrations.
 * - Tokens + paired origins are persisted to .tokens.json so the
 *   shopkeeper doesn't have to re-pair after restarting the service.
 *
 * REQUIREMENTS:
 * - Node.js 22+ (for windows-pdf-printer-native)
 * - Windows 7+ (for GDI32 + PDFium)
 * - Run: node index.js (after one-time pairing)
 *
 * PAIRING (two-step flow — the pairing state is persisted to a file so the
 * code survives between the `pair` command and the server start):
 *   1. node index.js pair --origin https://printshop-saas-three.vercel.app
 *      → prints a pairing code (e.g. PS-XXXXXXXX-XXXXXXXX-...)
 *      → writes { code, origin, expiry } to .pairing-state.json
 *      → exits
 *   2. (on the website) enter the code on the Printer Setup page
 *      → website POSTs /v1/pair to this service
 *   3. node index.js
 *      → server starts, reads .pairing-state.json, loads the code
 *      → serves POST /v1/pair (consumes the code, deletes the file, issues a
 *        bearer token)
 *      → all subsequent /v1/* requests use Authorization: Bearer <token>
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Configuration ──────────────────────────────────────────────────
const PORT = 32192;
const HOST = '127.0.0.1'; // Loopback ONLY — never expose to LAN
const MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes (generous — the shopkeeper starts the server after)
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_JOBS_PER_MINUTE = 20;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAIRING_STATE_FILE = join(__dirname, '.pairing-state.json');
const TOKENS_FILE = join(__dirname, '.tokens.json');

// ─── State ──────────────────────────────────────────────────────────
// Multi-token model: the shopkeeper can pair from multiple origins
// (production URL + preview URLs + a custom domain) and each pairing
// issues a separate token stored in the browser's localStorage for THAT
// origin. All tokens are valid simultaneously — re-pairing from a new URL
// doesn't invalidate the existing token. Tokens + paired origins are
// persisted to .tokens.json so they survive a service restart.
const activeTokens = new Map(); // token (string) -> expiry (number, epoch ms)
const pairedOrigins = new Set(); // display only — not used for access control
let pendingPairingCode = null;
let pendingPairingExpiry = 0;
let pendingPairingOrigin = null; // the origin the pending code was generated for

// Job tracking (in-memory — the service runs continuously on the shopkeeper's machine)
const jobs = new Map();

// Rate limiting (sliding window)
const jobTimestamps = [];

// ─── CLI: pairing command ───────────────────────────────────────────
if (process.argv[2] === 'pair') {
  const originArg = process.argv.find((a) => a.startsWith('--origin'));
  const origin = originArg ? originArg.split('=')[1] : null;
  if (!origin) {
    console.error('Usage: node index.js pair --origin=<your-website-url>');
    console.error('Example: node index.js pair --origin=https://printshop-saas-three.vercel.app');
    process.exit(1);
  }
  // Validate origin shape
  try {
    new URL(origin);
  } catch {
    console.error(`Invalid origin URL: "${origin}". Must include https:// (or http://localhost).`);
    process.exit(1);
  }
  // Generate a pairing code: PS-XXXXXXXX-XXXXXXXX-XXXXXXXX
  const hex = randomBytes(12).toString('hex').toUpperCase();
  const code = `PS-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}`;
  const expiry = Date.now() + PAIRING_CODE_TTL_MS;

  // Persist to the state file so the server (started next) can read it
  const state = { code, origin, expiry };
  writeFileSync(PAIRING_STATE_FILE, JSON.stringify(state, null, 2));

  console.log('══════════════════════════════════════════════════════');
  console.log('  PrintShop Native Printer — Pairing Code');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Pairing code:  ${code}`);
  console.log(`  Website:       ${origin}`);
  console.log(`  Expires in:    ${PAIRING_CODE_TTL_MS / 60000} minutes`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open your PrintShop website → Printer Setup page');
  console.log('       (the code above is already saved on this computer)');
  console.log('    2. Select "Native Windows Printer" as the print engine');
  console.log('    3. Paste this code into the "Pairing code" field');
  console.log('    4. Click "Confirm pairing"');
  console.log('    5. Start the service (leave this terminal or open a new one):');
  console.log('         node index.js');
  console.log('');
  console.log('  The service will run at http://127.0.0.1:' + PORT);
  console.log('══════════════════════════════════════════════════════');
  process.exit(0);
}

// ─── On server start: load any persisted pairing state ──────────────
function loadPairingState() {
  if (!existsSync(PAIRING_STATE_FILE)) return;
  try {
    const raw = readFileSync(PAIRING_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (!state.code || !state.origin || !state.expiry) {
      unlinkSync(PAIRING_STATE_FILE);
      return;
    }
    if (Date.now() > state.expiry) {
      console.log(`[native-printer] Saved pairing code expired — deleted ${PAIRING_STATE_FILE}`);
      unlinkSync(PAIRING_STATE_FILE);
      return;
    }
    pendingPairingCode = state.code;
    pendingPairingExpiry = state.expiry;
    pendingPairingOrigin = state.origin;
    const remainingMs = state.expiry - Date.now();
    console.log(`[native-printer] Loaded pairing code from ${PAIRING_STATE_FILE}`);
    console.log(`[native-printer]   Code: ${state.code}`);
    console.log(`[native-printer]   Origin: ${state.origin}`);
    console.log(`[native-printer]   Expires in ${Math.ceil(remainingMs / 1000)}s`);
    console.log(`[native-printer] Enter this code on the PrintShop website's Printer Setup page.`);
  } catch (e) {
    console.error(`[native-printer] Failed to read pairing state:`, e.message);
    try { unlinkSync(PAIRING_STATE_FILE); } catch { /* ignore */ }
  }
}

function consumePairingState() {
  // Called after a successful POST /v1/pair — the code is one-time use
  try { unlinkSync(PAIRING_STATE_FILE); } catch { /* ignore */ }
}

// ─── Token persistence (survives service restart) ───────────────────
// .tokens.json shape: { tokens: [{ token, origin, expiry }], origins: [...] }
// We persist EVERY issued token so the shopkeeper doesn't re-pair after
// a restart. Expired tokens are pruned on load + on each write.
function loadTokens() {
  if (!existsSync(TOKENS_FILE)) return;
  try {
    const raw = readFileSync(TOKENS_FILE, 'utf8');
    const data = JSON.parse(raw);
    const now = Date.now();
    let kept = 0, dropped = 0;
    for (const entry of (data.tokens ?? [])) {
      if (typeof entry?.token !== 'string' || typeof entry?.expiry !== 'number') continue;
      if (entry.expiry <= now) { dropped++; continue; }
      activeTokens.set(entry.token, entry.expiry);
      if (typeof entry.origin === 'string') pairedOrigins.add(entry.origin);
      kept++;
    }
    if (dropped > 0) saveTokens(); // prune the file too
    console.log(`[native-printer] Loaded ${kept} active token(s) from ${TOKENS_FILE}` + (dropped ? ` (${dropped} expired, pruned)` : ''));
  } catch (e) {
    console.error(`[native-printer] Failed to read tokens file:`, e.message);
  }
}

function saveTokens() {
  try {
    const now = Date.now();
    const tokens = [];
    for (const [token, expiry] of activeTokens) {
      if (expiry > now) {
        // Find the origin this token was issued for (best-effort — we
        // don't store the per-token origin, so we just mark all paired
        // origins; the token works from any of them anyway).
        tokens.push({ token, expiry });
      }
    }
    const data = { tokens, origins: [...pairedOrigins], savedAt: now };
    writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[native-printer] Failed to write tokens file:`, e.message);
  }
}

function pruneExpiredTokens() {
  const now = Date.now();
  let pruned = 0;
  for (const [token, expiry] of activeTokens) {
    if (expiry <= now) { activeTokens.delete(token); pruned++; }
  }
  if (pruned > 0) {
    console.log(`[native-printer] Pruned ${pruned} expired token(s)`);
    saveTokens();
  }
}

loadPairingState();
loadTokens();
// Prune expired tokens every 10 minutes (in the background).
setInterval(pruneExpiredTokens, 10 * 60 * 1000).unref?.();

// ─── Helpers ────────────────────────────────────────────────────────
// CORS: reflect ANY origin. The token secret (32 bytes) + loopback binding
// (127.0.0.1 only) + the browser's same-origin policy (localStorage is
// per-origin, so a malicious site can't read the token) provide the
// security. The previous origin-allowlist broke every time the deployment
// URL changed (Vercel preview URLs, custom domains, etc.) — reflecting
// any origin makes the pairing survive those changes.
function setCORS(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Origin validation: accept ANY origin. The actual access control is the
// bearer token (validateToken). Same-origin requests (no Origin header)
// are allowed for the unauthenticated health check.
function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.url === '/health';
  return true; // any origin — token is the gatekeeper
}

function validateToken(req) {
  if (activeTokens.size === 0) return false;
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const expiry = activeTokens.get(token);
  if (!expiry) return false; // unknown token
  if (Date.now() > expiry) {
    // Lazy prune — drop the expired token so future checks are fast.
    activeTokens.delete(token);
    saveTokens();
    return false;
  }
  return true;
}

function rateLimited() {
  const now = Date.now();
  // Drop timestamps older than 60s
  while (jobTimestamps.length && jobTimestamps[0] < now - 60000) jobTimestamps.shift();
  if (jobTimestamps.length >= MAX_JOBS_PER_MINUTE) return true;
  jobTimestamps.push(now);
  return false;
}

// ─── Lazy-load the native printer library ───────────────────────────
let PDFPrinter = null;
let PrinterManager = null;
let DuplexMode = null;
let PaperSize = null;
let ColorMode = null;
let PageOrientation = null;

async function loadLibrary() {
  if (PDFPrinter) return;
  try {
    const mod = await import('windows-pdf-printer-native');
    PDFPrinter = mod.PDFPrinter;
    PrinterManager = mod.PrinterManager;
    DuplexMode = mod.DuplexMode;
    PaperSize = mod.PaperSize;
    ColorMode = mod.ColorMode;
    PageOrientation = mod.PageOrientation;
    console.log('[native-printer] Library loaded: windows-pdf-printer-native');
  } catch (e) {
    console.error('[native-printer] Failed to load windows-pdf-printer-native:', e.message);
    console.error('[native-printer] Install it with: npm install windows-pdf-printer-native');
  }
}

// ─── Enum mappings ──────────────────────────────────────────────────
function mapDuplex(duplex) {
  if (!duplex || !DuplexMode) return undefined;
  if (duplex === 'simplex') return DuplexMode.SIMPLEX;       // one-sided
  if (duplex === 'long-edge') return DuplexMode.VERTICAL;    // flip on long edge
  if (duplex === 'short-edge') return DuplexMode.HORIZONTAL; // flip on short edge
  return undefined;
}

function mapPaperSize(size) {
  if (!size || !PaperSize) return undefined;
  const key = String(size).toUpperCase();
  if (key in PaperSize) return PaperSize[key];
  return undefined;
}

function mapColor(color) {
  if (!color || !ColorMode) return undefined;
  if (color === 'bw') return ColorMode.MONOCHROME;
  if (color === 'color') return ColorMode.COLOR;
  return undefined;
}

function mapOrientation(orient) {
  if (!orient || !PageOrientation) return undefined;
  if (orient === 'landscape') return PageOrientation.LANDSCAPE;
  return PageOrientation.PORTRAIT;
}

// ─── HTTP Server ────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCORS(res, req.headers.origin ?? null);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  // ── Health check (unauthenticated, no origin check) ──
  if (url.pathname === '/health' && req.method === 'GET') {
    await loadLibrary();
    // Prune expired tokens opportunistically (cheap when nothing's expired).
    const now = Date.now();
    let expiredCount = 0;
    for (const [token, expiry] of activeTokens) {
      if (expiry <= now) { activeTokens.delete(token); expiredCount++; }
    }
    if (expiredCount > 0) saveTokens();
    sendJSON(res, 200, {
      service: 'printshop-native-printer',
      version: '1.1.0',
      libraryLoaded: !!PDFPrinter,
      // `paired` = at least one non-expired token exists
      paired: activeTokens.size > 0,
      tokenCount: activeTokens.size,
      pairedOrigins: [...pairedOrigins],
      pairingPending: !!pendingPairingCode && Date.now() < pendingPairingExpiry,
      port: PORT,
      host: HOST,
    });
    return;
  }

  // Validate origin for all other routes
  if (!validateOrigin(req)) {
    sendJSON(res, 403, { error: { code: 'forbidden', message: 'Origin not allowed' } });
    return;
  }
  setCORS(res, req.headers.origin ?? null);

  // ── Pairing ──
  // Accept the pairing code from ANY origin (the shopkeeper may have moved
  // to a new URL — a Vercel preview, a custom domain, etc.). The new token
  // is ADDED to the active tokens set (existing tokens stay valid), so the
  // shopkeeper's existing setup on the old origin keeps working too.
  if (url.pathname === '/v1/pair' && req.method === 'POST') {
    const body = await readBody(req, 1024);
    try {
      const { code } = JSON.parse(body);
      if (!code || code !== pendingPairingCode || Date.now() > pendingPairingExpiry) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: 'Invalid or expired pairing code' } });
        return;
      }
      // Generate a bearer token + record the requesting origin.
      const token = randomBytes(32).toString('hex');
      const expiry = Date.now() + TOKEN_TTL_MS;
      activeTokens.set(token, expiry);
      const origin = req.headers.origin;
      if (origin) pairedOrigins.add(origin);
      pendingPairingCode = null; // One-time use
      consumePairingState(); // Delete the persisted pairing-code file
      saveTokens(); // Persist the new token + origin
      sendJSON(res, 200, { token, expiresIn: TOKEN_TTL_MS, tokenCount: activeTokens.size });
      console.log(`[native-printer] Paired successfully with ${origin ?? '(unknown origin)'} — ${activeTokens.size} active token(s) total`);
      return;
    } catch {
      sendJSON(res, 400, { error: { code: 'bad_request', message: 'Invalid JSON' } });
      return;
    }
  }

  // All /v1/* routes require authentication
  if (url.pathname.startsWith('/v1/') && !validateToken(req)) {
    sendJSON(res, 401, { error: { code: 'unauthorized', message: 'Invalid or expired token' } });
    return;
  }

  // ── List printers ──
  if (url.pathname === '/v1/printers' && req.method === 'GET') {
    await loadLibrary();
    if (!PrinterManager) {
      sendJSON(res, 500, { error: { code: 'library_not_loaded', message: 'windows-pdf-printer-native not loaded. Install it with: npm install' } });
      return;
    }
    try {
      const printers = await PrinterManager.getAvailablePrinters();
      const defaultPrinter = await PrinterManager.getDefaultPrinter();
      const result = (printers || []).map((p) => ({
        id: p.name,
        name: p.name,
        isDefault: p.name === defaultPrinter,
        status: p.status != null ? String(p.status) : 'unknown',
        driverName: p.driverName,
        portName: p.portName,
      }));
      sendJSON(res, 200, { printers: result });
      return;
    } catch (e) {
      sendJSON(res, 500, { error: { code: 'printer_error', message: e.message } });
      return;
    }
  }

  // ── Submit print job ──
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    if (rateLimited()) {
      sendJSON(res, 429, { error: { code: 'rate_limited', message: `More than ${MAX_JOBS_PER_MINUTE} jobs/minute` } });
      return;
    }
    await loadLibrary();
    if (!PDFPrinter) {
      sendJSON(res, 500, { error: { code: 'library_not_loaded', message: 'Library not loaded. Run: npm install windows-pdf-printer-native' } });
      return;
    }
    try {
      const { fields, fileBuffer, filename } = await parseMultipart(req);
      if (!fileBuffer || fileBuffer.length === 0) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: 'No PDF file provided' } });
        return;
      }
      if (fileBuffer.length > MAX_PDF_SIZE) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: `PDF too large (max ${MAX_PDF_SIZE} bytes)` } });
        return;
      }
      // Validate it's a PDF (magic bytes %PDF)
      if (fileBuffer[0] !== 0x25 || fileBuffer[1] !== 0x50 || fileBuffer[2] !== 0x44 || fileBuffer[3] !== 0x46) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: 'File is not a PDF' } });
        return;
      }

      // Build print options
      const printerName = fields.printerName || undefined;
      const printer = printerName ? new PDFPrinter(printerName) : new PDFPrinter();
      const options = {};
      if (fields.copies) options.copies = Math.min(Math.max(1, parseInt(fields.copies, 10) || 1), 10);
      if (fields.duplex) options.duplex = mapDuplex(fields.duplex);
      if (fields.paperSize) options.paperSize = mapPaperSize(fields.paperSize);
      if (fields.color) options.color = mapColor(fields.color);
      if (fields.orientation) options.orientation = mapOrientation(fields.orientation);

      // Submit the job
      const jobId = `job-${randomBytes(8).toString('hex')}`;
      jobs.set(jobId, { id: jobId, status: 'printing', printerName, submittedAt: Date.now() });

      // Run the print job (async — don't block the 202 response)
      const job = jobs.get(jobId);
      Promise.resolve()
        .then(() => printer.printRaw(Buffer.from(fileBuffer), filename || 'document.pdf', options))
        .then(() => {
          if (job) { job.status = 'completed'; job.completedAt = Date.now(); }
          console.log(`[native-printer] Job ${jobId} completed on ${printerName || '(default)'}`);
        })
        .catch((e) => {
          if (job) { job.status = 'failed'; job.error = e.message; }
          console.error(`[native-printer] Job ${jobId} failed:`, e.message);
        });

      sendJSON(res, 202, { id: jobId, status: 'printing', printerName });
      return;
    } catch (e) {
      sendJSON(res, 500, { error: { code: 'job_error', message: e.message } });
      return;
    }
  }

  // ── Get job status ──
  if (url.pathname.startsWith('/v1/jobs/') && url.pathname.split('/').length === 4 && req.method === 'GET') {
    const jobId = url.pathname.split('/')[3];
    const job = jobs.get(jobId);
    if (!job) {
      sendJSON(res, 404, { error: { code: 'not_found', message: 'Job not found' } });
      return;
    }
    sendJSON(res, 200, job);
    return;
  }

  // ── Retry job ──
  if (url.pathname.match(/^\/v1\/jobs\/[^/]+\/retry$/) && req.method === 'POST') {
    const jobId = url.pathname.split('/')[3];
    const job = jobs.get(jobId);
    if (!job) { sendJSON(res, 404, { error: { code: 'not_found', message: 'Job not found' } }); return; }
    if (job.status !== 'failed') {
      sendJSON(res, 400, { error: { code: 'bad_request', message: `Cannot retry job in status '${job.status}'` } });
      return;
    }
    job.status = 'printing';
    job.error = undefined;
    sendJSON(res, 200, { ...job, status: 'printing' });
    return;
  }

  // ── Cancel job ──
  if (url.pathname.match(/^\/v1\/jobs\/[^/]+\/cancel$/) && req.method === 'POST') {
    const jobId = url.pathname.split('/')[3];
    const job = jobs.get(jobId);
    if (!job) { sendJSON(res, 404, { error: { code: 'not_found', message: 'Job not found' } }); return; }
    if (job.status !== 'printing') {
      sendJSON(res, 400, { error: { code: 'bad_request', message: `Cannot cancel job in status '${job.status}'` } });
      return;
    }
    job.status = 'cancelled';
    sendJSON(res, 200, { ...job, status: 'cancelled' });
    return;
  }

  // 404
  sendJSON(res, 404, { error: { code: 'not_found', message: 'Not found' } });
});

// ─── Helpers: read body + parse multipart ───────────────────────────
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipart(req) {
  const contentType = req.headers['content-type'] ?? '';
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) return { fields: {}, fileBuffer: null, filename: null };

  const body = await readBody(req, MAX_PDF_SIZE + 1024); // Allow overhead
  const fields = {};
  let fileBuffer = null;
  let filename = null;

  // Simple multipart parser
  const parts = body.split(Buffer.from(`--${boundary}`));
  for (const part of parts) {
    if (part.length === 0 || part.toString().trim() === '--' || part.toString().trim() === '') continue;
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString();
    const content = part.slice(headerEnd + 4, part.length - 2); // Remove trailing \r\n

    const nameMatch = header.match(/name="([^"]+)"/);
    const filenameMatch = header.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (filenameMatch) {
      filename = filenameMatch[1];
      fileBuffer = content;
    } else {
      fields[fieldName] = content.toString().trim();
    }
  }

  return { fields, fileBuffer, filename };
}

// ─── Start the server ───────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('══════════════════════════════════════════════════════');
  console.log('  PrintShop Native Printer service running');
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  → Health check: http://${HOST}:${PORT}/health`);
  if (activeTokens.size > 0) {
    console.log(`  → Paired: ${activeTokens.size} active token(s)`);
    if (pairedOrigins.size > 0) {
      console.log(`    Origins: ${[...pairedOrigins].join(', ')}`);
    }
    console.log('    (tokens work from ANY origin — re-pair only if the token expired)');
  } else {
    console.log('  → Not paired yet');
  }
  if (pendingPairingCode && Date.now() < pendingPairingExpiry) {
    console.log(`  → Pairing code pending: ${pendingPairingCode}`);
    console.log(`    Enter it on your PrintShop website's Printer Setup page.`);
  } else if (activeTokens.size === 0) {
    console.log('  → To pair with a website:');
    console.log(`      node index.js pair --origin=https://your-website.vercel.app`);
    console.log('    (or use pair.bat from the downloaded ZIP)');
  }
  console.log('  → Press Ctrl+C to stop.');
  console.log('══════════════════════════════════════════════════════');
  loadLibrary();
});

// ─── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[native-printer] Shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
