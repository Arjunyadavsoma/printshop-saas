/**
 * Native Windows Printer browser client — communicates with the locally-
 * installed `printshop-native-printer` Node.js service on the shopkeeper's
 * Windows machine (port 32192).
 *
 * ARCHITECTURE:
 *   1. Shopkeeper runs `node index.js pair --origin <url>` on Windows →
 *      the service writes a pairing code to .pairing-state.json + prints it.
 *   2. Shopkeeper enters the code on the website → we POST it to
 *      /v1/pair. (The service must be running for this to succeed — the
 *      code is consumed from the persisted state file.)
 *   3. The service returns a bearer token — stored in localStorage.
 *   4. All subsequent /v1/* calls include `Authorization: Bearer <token>`.
 *   5. Print jobs: POST /v1/jobs with multipart (file, printerName, copies,
 *      duplex, paperSize, color, orientation).
 *   6. Status polling: GET /v1/jobs/:id.
 *   7. Retry: POST /v1/jobs/:id/retry. Cancel: POST /v1/jobs/:id/cancel.
 *
 * The shopkeeper must keep the `node index.js` process running for prints
 * to work. Unlike PrintLatch (which auto-starts on Windows boot via a
 * scheduled task), this service runs only while the terminal is open.
 *
 * SECURITY:
 *   - The token is origin-bound (the service only accepts it from the
 *     paired origin).
 *   - The presigned PDF URL is short-lived (60s) + object-specific.
 *   - The token is stored in localStorage (NOT a cookie — avoids CSRF).
 */

const AGENT_BASE_URL = 'http://127.0.0.1:32192';
const TOKEN_STORAGE_KEY = 'native_printer_token';

// ─── Engine preference (shared with the PrintLatch client) ───────────────

const ENGINE_PREF_KEY = 'printshop_print_engine';

export type PrintEngine = 'printlatch' | 'native';

export function getEnginePref(): PrintEngine | null {
  try {
    const v = localStorage.getItem(ENGINE_PREF_KEY);
    return v === 'printlatch' || v === 'native' ? v : null;
  } catch {
    return null;
  }
}

export function saveEnginePref(engine: PrintEngine): void {
  try {
    localStorage.setItem(ENGINE_PREF_KEY, engine);
  } catch { /* ignore */ }
}

export function clearEnginePref(): void {
  try {
    localStorage.removeItem(ENGINE_PREF_KEY);
  } catch { /* ignore */ }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type NativePrinterConnectionState =
  | 'not-configured'
  | 'pairing-required'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface NativePrinterHealth {
  version?: string;
  libraryLoaded?: boolean;
  paired?: boolean;
  pairingPending?: boolean;
}

export interface NativePrinterPrinter {
  id: string;
  name: string;
  isDefault?: boolean;
  status?: string;
  driverName?: string;
  portName?: string;
}

export interface NativePrinterJobRequest {
  pdf: Uint8Array;
  filename: string;
  /** Printer name (from GET /v1/printers). Omit to use the default printer. */
  printerName?: string;
  /** 1 through 10, default 1. */
  copies?: number;
  /** 'simplex' | 'long-edge' | 'short-edge'. Omit for printer default. */
  duplex?: 'simplex' | 'long-edge' | 'short-edge';
  /** 'a4' | 'a3' | 'letter' | 'legal' | 'a5'. Omit for printer default. */
  paperSize?: 'a4' | 'a3' | 'letter' | 'legal' | 'a5';
  /** 'bw' | 'color'. Omit for printer default. */
  color?: 'bw' | 'color';
  /** 'portrait' | 'landscape'. Omit for printer default. */
  orientation?: 'portrait' | 'landscape';
}

export interface NativePrinterJob {
  id: string;
  status: 'printing' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  error?: string;
  printerName?: string;
  submittedAt?: number;
  completedAt?: number;
}

// ─── Token management ──────────────────────────────────────────────────────

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}

function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* ignore */ }
}

function clearToken(): void {
  try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Status check ─────────────────────────────────────────────────────────
//
// Two-stage probe:
//   1. GET /health (unauthenticated, no Origin header required) — confirms
//      the service is running + whether the native library is loaded.
//   2. If a token is stored, GET /v1/printers (authenticated, CORS-enabled
//      for the paired origin only) — confirms the token is still valid and
//      returns the printer list.
//
// The state mapping:
//   - no token + health ok            → pairing-required (service is up, waiting for a code)
//   - no token + health unreachable   → disconnected (service not running)
//   - token + printers ok             → connected
//   - token + 401/403                  → disconnected (token expired/restarted)
//   - token + fetch error              → disconnected (service down)

export async function checkNativePrinterStatus(): Promise<{
  state: NativePrinterConnectionState;
  health: NativePrinterHealth | null;
  printers: NativePrinterPrinter[] | null;
  error: string | null;
}> {
  const token = getToken();

  // Stage 1: health check (always — tells us if the service is up at all)
  let health: NativePrinterHealth | null = null;
  try {
    const healthRes = await fetch(`${AGENT_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (healthRes.ok) {
      health = (await healthRes.json()) as NativePrinterHealth;
    }
  } catch {
    // Service not reachable at all
    if (!token) {
      return {
        state: 'disconnected',
        health: null,
        printers: null,
        error: 'Native Printer service is not running. Start it with: node index.js',
      };
    }
    // Token exists but service is down → disconnected (token may still be valid
    // when the service comes back)
    return {
      state: 'disconnected',
      health: null,
      printers: null,
      error: 'Service not reachable. Is `node index.js` running on THIS computer?',
    };
  }

  // Stage 2: if no token, the shopkeeper hasn't paired yet
  if (!token) {
    return { state: 'pairing-required', health, printers: null, error: null };
  }

  // Stage 3: token exists — verify it by fetching printers
  try {
    const printersRes = await fetch(`${AGENT_BASE_URL}/v1/printers`, {
      method: 'GET',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (printersRes.status === 401 || printersRes.status === 403) {
      return {
        state: 'disconnected',
        health,
        printers: null,
        error: 'Service rejected the stored token (it may have been restarted). Click "Disconnect" to re-pair.',
      };
    }
    if (!printersRes.ok) {
      return {
        state: 'error',
        health,
        printers: null,
        error: `Printers check failed (HTTP ${printersRes.status})`,
      };
    }
    const data = await printersRes.json();
    const printers = (data.printers ?? []) as NativePrinterPrinter[];
    return { state: 'connected', health, printers, error: null };
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return {
        state: 'disconnected',
        health,
        printers: null,
        error: 'Service did not respond (5s timeout). Is `node index.js` running?',
      };
    }
    return { state: 'error', health, printers: null, error: err?.message ?? 'Unknown error' };
  }
}

// ─── Pairing (POST /v1/pair — browser only) ───────────────────────────────

export async function confirmNativePrinterPairing(pairingCode: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE_URL}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairingCode }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
      return { success: false, error: errMsg };
    }
    const data = await res.json();
    if (data?.token) {
      setToken(data.token);
      return { success: true };
    }
    return { success: false, error: 'Pairing succeeded but no token was returned.' };
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'TypeError' && /fetch|Failed/i.test(err?.message ?? '')) {
      return {
        success: false,
        error: 'Service not reachable. Start it with `node index.js` (the service must be running when you click Confirm).',
      };
    }
    return { success: false, error: err?.message ?? 'Unknown error during pairing' };
  }
}

// ─── Printers (GET /v1/printers — authenticated) ─────────────────────────

export async function getNativePrinterPrinters(): Promise<NativePrinterPrinter[]> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/printers`, {
    method: 'GET',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Failed to get printers (HTTP ${res.status})`);
  const data = await res.json();
  return (data.printers ?? []) as NativePrinterPrinter[];
}

// ─── Submit print job (POST /v1/jobs — authenticated) ─────────────────────

export async function submitNativePrinterJob(req: NativePrinterJobRequest): Promise<NativePrinterJob> {
  const formData = new FormData();
  const blob = new Blob([req.pdf as unknown as BlobPart], { type: 'application/pdf' });
  formData.append('file', blob, req.filename);
  if (req.printerName) formData.append('printerName', req.printerName);
  if (req.copies) formData.append('copies', String(req.copies));
  if (req.duplex) formData.append('duplex', req.duplex);
  if (req.paperSize) formData.append('paperSize', req.paperSize);
  if (req.color) formData.append('color', req.color);
  if (req.orientation) formData.append('orientation', req.orientation);

  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs`, {
    method: 'POST',
    headers: authHeaders(), // No Content-Type — FormData sets it automatically
    body: formData,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = (errBody as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Print job submission failed: ${errMsg}`);
  }
  return (await res.json()) as NativePrinterJob;
}

// ─── Job status (GET /v1/jobs/:id — authenticated) ────────────────────────

export async function getNativePrinterJobStatus(jobId: string): Promise<NativePrinterJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}`, {
    method: 'GET',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { id: jobId, status: 'unknown', error: 'Job not found — the service may have been restarted.' };
    }
    throw new Error(`Status check failed (HTTP ${res.status})`);
  }
  return (await res.json()) as NativePrinterJob;
}

// ─── Retry failed job (POST /v1/jobs/:id/retry — authenticated) ────────────

export async function retryNativePrinterJob(jobId: string): Promise<NativePrinterJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: { message?: string } })?.error?.message ?? `Retry failed (HTTP ${res.status})`);
  }
  return (await res.json()) as NativePrinterJob;
}

// ─── Cancel printing job (POST /v1/jobs/:id/cancel — authenticated) ────────

export async function cancelNativePrinterJob(jobId: string): Promise<NativePrinterJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: { message?: string } })?.error?.message ?? `Cancel failed (HTTP ${res.status})`);
  }
  return (await res.json()) as NativePrinterJob;
}

// ─── Disconnect — clears the stored browser token. The service stays running. ──

export function disconnectNativePrinter(): void {
  clearToken();
}

// ─── Fetch PDF bytes (from the server's presigned URL) ─────────────────────
// (Same helper as the PrintLatch client — duplicated here so the native
// printer flow can fetch PDFs without importing the printlatch client.)

export async function fetchPdfBytes(presignedUrl: string): Promise<Uint8Array> {
  const res = await fetch(presignedUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── Constants + helpers ────────────────────────────────────────────────────

export const NATIVE_PRINTER_AGENT_URL = AGENT_BASE_URL;
export const NATIVE_PRINTER_PORT = 32192;

/**
 * The pairing command the shopkeeper runs in PowerShell/CMD.
 * Uses the current website origin so the service only accepts requests
 * from this site.
 */
export function getNativePairingCommand(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://printshop-saas-three.vercel.app';
  return `node index.js pair --origin=${origin}`;
}

/** The command to start the service (after pairing). */
export function getNativeStartCommand(): string {
  return 'node index.js';
}

/** The command to install dependencies. */
export function getNativeInstallCommand(): string {
  return 'npm install';
}

/** The health-check URL the shopkeeper can open in a browser to verify the service is up. */
export function getNativeHealthUrl(): string {
  return `${AGENT_BASE_URL}/health`;
}
