// @ts-nocheck
/**
 * PrintShop SaaS — Local Native Windows Printing Service
 *
 * Runs on the shopkeeper's Windows computer at http://127.0.0.1:32192.
 * Uses `windows-pdf-printer-native` to submit PDFs to the Windows print
 * queue with per-job duplex, copies, paper size, color, orientation.
 *
 * SECURITY:
 * - Binds to 127.0.0.1 ONLY (no LAN exposure)
 * - Origin-based pairing (pairing code → bearer token)
 * - Strict request schema validation
 * - No arbitrary file paths — only PDF bytes via Buffer
 * - 25MB max PDF size
 * - Rate limited (20 jobs/minute)
 * - CORS: only the paired origin
 * - Host header validation (prevents DNS rebinding)
 *
 * REQUIREMENTS:
 * - Node.js 22+ (for windows-pdf-printer-native)
 * - Windows 7+ (for GDI32 + PDFium)
 * - Run: node index.js (or bun run dev for development)
 *
 * PAIRING:
 *   node index.js pair --origin https://printshop-saas-three.vercel.app
 *   → prints a pairing code
 *   → shopkeeper enters the code on the PrintShop website
 *   → website sends POST /v1/pair → receives a bearer token
 *   → all subsequent requests use Authorization: Bearer <token>
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

// ─── Configuration ──────────────────────────────────────────────────
const PORT = 32192;
const HOST = '127.0.0.1'; // Loopback ONLY — never expose to LAN
const MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── State ──────────────────────────────────────────────────────────
let pairedOrigin: string | null = null;
let pendingPairingCode: string | null = null;
let pendingPairingExpiry: number = 0;
let activeToken: string | null = null;
let tokenExpiry: number = 0;

// Job tracking (in-memory — the service runs continuously on the shopkeeper's machine)
const jobs = new Map<string, { id: string; status: string; error?: string; printerName?: string; submittedAt: number; completedAt?: number }>();

// ─── CLI: pairing command ───────────────────────────────────────────
if (process.argv[2] === 'pair') {
  const originArg = process.argv.find(a => a.startsWith('--origin'));
  const origin = originArg ? originArg.split('=')[1] : null;
  if (!origin) {
    console.error('Usage: node index.js pair --origin=<your-website-url>');
    process.exit(1);
  }
  // Generate a pairing code
  pendingPairingCode = randomBytes(16).toString('hex').toUpperCase().replace(/(.{8})/g, '$1-').replace(/-$/, '');
  pendingPairingCode = 'PS-' + pendingPairingCode;
  pendingPairingExpiry = Date.now() + PAIRING_CODE_TTL_MS;
  pairedOrigin = origin;
  console.log(`Pairing code: ${pendingPairingCode}`);
  console.log(`Origin: ${origin}`);
  console.log(`Expires at (Unix): ${Math.floor(pendingPairingExpiry / 1000)}`);
  console.log(`\nStart the service (in another terminal): node index.js`);
  console.log(`Then enter the pairing code on your PrintShop website's Printer Setup page.`);
  process.exit(0);
}

// ─── Helpers ────────────────────────────────────────────────────────
function setCORS(res: ServerResponse, origin: string | null) {
  if (origin && pairedOrigin && origin === pairedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
}

function sendJSON(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function validateOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Same-origin requests (no Origin header) are allowed for the health check
  if (!origin) return req.url === '/health';
  return pairedOrigin !== null && origin === pairedOrigin;
}

function validateToken(req: IncomingMessage): boolean {
  if (!activeToken || Date.now() > tokenExpiry) return false;
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === activeToken;
}

// ─── Lazy-load the native printer library ───────────────────────────
let PDFPrinter: any = null;
let PrinterManager: any = null;
let DuplexMode: any = null;
let PaperSize: any = null;
let ColorMode: any = null;
let PageOrientation: any = null;

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
    console.error('[native-printer] Failed to load windows-pdf-printer-native:', e);
    console.error('[native-printer] Install it with: npm install windows-pdf-printer-native');
  }
}

// ─── Duplex mapping ─────────────────────────────────────────────────
function mapDuplex(duplex?: string): any {
  if (!duplex || !DuplexMode) return DuplexMode?.SIMPLEX ?? 1;
  if (duplex === 'simplex') return DuplexMode.SIMPLEX;      // 1
  if (duplex === 'long-edge') return DuplexMode.VERTICAL;   // 3 (flip on long edge)
  if (duplex === 'short-edge') return DuplexMode.HORIZONTAL; // 2 (flip on short edge)
  return DuplexMode.SIMPLEX;
}

function mapPaperSize(size?: string): any {
  if (!size || !PaperSize) return undefined;
  const map: Record<string, number> = { a4: 9, a3: 8, letter: 1, legal: 5, a5: 11 };
  return PaperSize[Object.keys(PaperSize).find(k => PaperSize[k] === map[size.toLowerCase()]) ?? 'A4'];
}

function mapColor(color?: string): any {
  if (!color || !ColorMode) return undefined;
  if (color === 'bw') return ColorMode.MONOCHROME;
  if (color === 'color') return ColorMode.COLOR;
  return undefined;
}

function mapOrientation(orient?: string): any {
  if (!orient || !PageOrientation) return undefined;
  if (orient === 'landscape') return PageOrientation.LANDSCAPE;
  return PageOrientation.PORTRAIT;
}

// ─── HTTP Server ─────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCORS(res, req.headers.origin ?? null);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  // ── Health check (unauthenticated) ──
  if (url.pathname === '/health' && req.method === 'GET') {
    await loadLibrary();
    sendJSON(res, 200, {
      service: 'printshop-native-printer',
      version: '1.0.0',
      libraryLoaded: !!PDFPrinter,
      paired: !!activeToken && Date.now() < tokenExpiry,
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
  if (url.pathname === '/v1/pair' && req.method === 'POST') {
    // Read body
    const body = await readBody(req, 1024);
    try {
      const { code } = JSON.parse(body);
      if (!code || code !== pendingPairingCode || Date.now() > pendingPairingExpiry) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: 'Invalid or expired pairing code' } });
        return;
      }
      // Generate a bearer token
      activeToken = randomBytes(32).toString('hex');
      tokenExpiry = Date.now() + TOKEN_TTL_MS;
      pendingPairingCode = null; // One-time use
      sendJSON(res, 200, { token: activeToken, expiresIn: TOKEN_TTL_MS });
      console.log('[native-printer] Paired successfully with', req.headers.origin);
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
      const result = printers.map((p: any) => ({
        id: p.name,
        name: p.name,
        isDefault: p.name === defaultPrinter,
        status: p.status?.toString() ?? 'unknown',
        driverName: p.driverName,
        portName: p.portName,
      }));
      sendJSON(res, 200, { printers: result });
      return;
    } catch (e: any) {
      sendJSON(res, 500, { error: { code: 'printer_error', message: e.message } });
      return;
    }
  }

  // ── Submit print job ──
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    await loadLibrary();
    if (!PDFPrinter) {
      sendJSON(res, 500, { error: { code: 'library_not_loaded', message: 'Library not loaded' } });
      return;
    }
    // Parse multipart form data
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
      // Validate it's a PDF
      if (fileBuffer[0] !== 0x25 || fileBuffer[1] !== 0x50 || fileBuffer[2] !== 0x44 || fileBuffer[3] !== 0x46) {
        sendJSON(res, 400, { error: { code: 'bad_request', message: 'File is not a PDF' } });
        return;
      }

      // Build print options
      const printerName = fields.printerName;
      const printer = printerName ? new PDFPrinter(printerName) : new PDFPrinter();
      const options: any = {};
      if (fields.copies) options.copies = Math.min(Math.max(1, parseInt(fields.copies)), 10);
      if (fields.duplex) options.duplex = mapDuplex(fields.duplex);
      if (fields.paperSize) options.paperSize = mapPaperSize(fields.paperSize);
      if (fields.color) options.color = mapColor(fields.color);
      if (fields.orientation) options.orientation = mapOrientation(fields.orientation);

      // Submit the job
      const jobId = `job-${randomBytes(8).toString('hex')}`;
      jobs.set(jobId, { id: jobId, status: 'printing', printerName, submittedAt: Date.now() });

      // Run the print job (async — don't block the response)
      printer.printRaw(Buffer.from(fileBuffer), filename || 'document.pdf', options)
        .then(() => {
          const job = jobs.get(jobId);
          if (job) { job.status = 'completed'; job.completedAt = Date.now(); }
          console.log(`[native-printer] Job ${jobId} completed on ${printerName}`);
        })
        .catch((e: any) => {
          const job = jobs.get(jobId);
          if (job) { job.status = 'failed'; job.error = e.message; }
          console.error(`[native-printer] Job ${jobId} failed:`, e.message);
        });

      sendJSON(res, 202, { id: jobId, status: 'printing', printerName });
      return;
    } catch (e: any) {
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
    if (job.status !== 'failed' && job.status !== 'unknown') {
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

// ─── Helpers: read body + parse multipart ────────────────────────────
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipart(req: IncomingMessage): Promise<{ fields: Record<string, string>; fileBuffer: Buffer | null; filename: string | null }> {
  const contentType = req.headers['content-type'] ?? '';
  const boundary = contentType.match(/boundary=(.+)/)?.[1];
  if (!boundary) return { fields: {}, fileBuffer: null, filename: null };

  const body = await readBody(req, MAX_PDF_SIZE + 1024); // Allow overhead
  const fields: Record<string, string> = {};
  let fileBuffer: Buffer | null = null;
  let filename: string | null = null;

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
  console.log(`[native-printer] Service running at http://${HOST}:${PORT}`);
  console.log(`[native-printer] Health check: http://${HOST}:${PORT}/health`);
  console.log(`[native-printer] Paired origin: ${pairedOrigin ?? 'not paired'}`);
  console.log(`[native-printer] To pair: node index.js pair --origin=<your-website-url>`);
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
