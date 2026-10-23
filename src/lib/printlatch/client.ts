/**
 * PrintLatch browser client — communicates with the locally-installed
 * PrintLatch agent on the shopkeeper's Windows machine.
 *
 * Based on the official PrintLatch API documentation:
 * https://github.com/arturict/printlatch/blob/main/docs/api.md
 *
 * ARCHITECTURE:
 *   1. Shopkeeper runs `printlatch pair --origin <url>` on Windows → gets a pairing code.
 *   2. Shopkeeper enters the code on the website → we POST it to the agent's /v1/pair.
 *   3. The agent returns a browser token (pl_live_...) — stored in localStorage.
 *   4. All subsequent /v1/* calls include `Authorization: Bearer pl_live_...`.
 *   5. Print jobs: POST /v1/jobs with multipart (file, mode, printer_id, copies).
 *   6. Status polling: GET /v1/jobs/:id.
 *   7. Retry: POST /v1/jobs/:id/retry. Cancel: POST /v1/jobs/:id/cancel.
 *
 * SECURITY:
 *   - The browser token is origin-bound (the agent only accepts it from the
 *     paired origin).
 *   - The presigned PDF URL is short-lived (60s) + object-specific.
 *   - No server secrets in the browser bundle.
 *   - The token is stored in localStorage (NOT a cookie — avoids CSRF).
 */

const AGENT_BASE_URL = 'http://127.0.0.1:32191';
const TOKEN_STORAGE_KEY = 'printlatch_token';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PrintLatchConnectionState =
  | 'not-configured'
  | 'pairing-required'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface PrintLatchHealth {
  product?: string;
  version?: string;
  loopback?: boolean;
  telemetry?: boolean;
}

export interface PrintLatchPrinter {
  id: string;
  name: string;
  kind: string;
  tested?: boolean;
  detail?: string;
}

export interface PrintLatchJobRequest {
  pdf: Uint8Array;
  filename: string;
  /** "preview" uses the built-in PDF capture (no real printer). "print" sends to a real printer. */
  mode: 'preview' | 'print';
  /** Required for mode="print". Get from GET /v1/printers. */
  printerId?: string;
  /** 1 through 10, default 1. */
  copies?: number;
}

export interface PrintLatchJob {
  id: string;
  status: 'queued' | 'printing' | 'completed' | 'failed' | 'canceled' | 'unknown';
  mode?: string;
  printer_id?: string;
  copies?: number;
  error?: { code?: string; message?: string };
  created_at?: string;
  updated_at?: string;
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

// ─── Status check (GET /health — unauthenticated) ─────────────────────────

export async function checkPrintLatchStatus(): Promise<{ state: PrintLatchConnectionState; health: PrintLatchHealth | null; printers: PrintLatchPrinter[] | null; error: string | null }> {
  try {
    // Step 1: Check if the agent is running (unauthenticated health check).
    const healthRes = await fetch(`${AGENT_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!healthRes.ok) {
      return { state: 'error', health: null, printers: null, error: `Agent responded HTTP ${healthRes.status}` };
    }
    const health = (await healthRes.json()) as PrintLatchHealth;

    // Step 2: If we have a browser token, try to fetch printers (authenticated).
    const token = getToken();
    if (!token) {
      return { state: 'pairing-required', health, printers: null, error: null };
    }

    try {
      const printersRes = await fetch(`${AGENT_BASE_URL}/v1/printers`, {
        method: 'GET',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (printersRes.status === 401 || printersRes.status === 403) {
        // Token expired or revoked — need to re-pair.
        clearToken();
        return { state: 'pairing-required', health, printers: null, error: 'Token expired — please re-pair.' };
      }
      if (!printersRes.ok) {
        return { state: 'error', health, printers: null, error: `Printers check failed (HTTP ${printersRes.status})` };
      }
      const printersData = await printersRes.json();
      const printers = (printersData.printers ?? []) as PrintLatchPrinter[];
      return { state: 'connected', health, printers, error: null };
    } catch (e: any) {
      // Token exists but printers endpoint failed — still consider connected
      // (the agent is running, we just can't list printers right now).
      if (e.name === 'TypeError') {
        return { state: 'connected', health, printers: null, error: 'Agent running but printers endpoint unreachable (CORS?). Try submitting a job directly.' };
      }
      return { state: 'connected', health, printers: null, error: null };
    }
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { state: 'disconnected', health: null, printers: null, error: 'Agent did not respond (5s timeout). Is PrintLatch running on THIS computer?' };
    }
    if (e.name === 'TypeError' && /fetch|Failed/i.test(e.message)) {
      return { state: 'disconnected', health: null, printers: null, error: 'Agent not reachable. (1) Is PrintLatch running? (2) Are you on the same Windows machine? (3) Run the pairing command first.' };
    }
    return { state: 'error', health: null, printers: null, error: e.message ?? 'Unknown error' };
  }
}

// ─── Pairing (POST /v1/pair — browser only) ───────────────────────────────

export async function confirmPrintLatchPairing(pairingCode: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE_URL}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairingCode }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.error?.message ?? `HTTP ${res.status}`;
      return { success: false, error: errMsg };
    }
    const data = await res.json();
    // The agent returns a browser token — store it for future API calls.
    if (data?.token) {
      setToken(data.token);
      return { success: true };
    }
    return { success: false, error: 'Pairing succeeded but no token was returned.' };
  } catch (e: any) {
    if (e.name === 'TypeError' && /fetch|Failed/i.test(e.message)) {
      return { success: false, error: 'Agent not reachable. Run the pairing command in PowerShell FIRST, then click Confirm.' };
    }
    return { success: false, error: e.message ?? 'Unknown error during pairing' };
  }
}

// ─── Printers (GET /v1/printers — authenticated) ─────────────────────────

export async function getPrintLatchPrinters(): Promise<PrintLatchPrinter[]> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/printers`, {
    method: 'GET',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Failed to get printers (HTTP ${res.status})`);
  const data = await res.json();
  return (data.printers ?? []) as PrintLatchPrinter[];
}

// ─── Submit print job (POST /v1/jobs — authenticated) ─────────────────────

export async function submitPrintLatchJob(req: PrintLatchJobRequest): Promise<PrintLatchJob> {
  const formData = new FormData();
  const blob = new Blob([req.pdf as unknown as BlobPart], { type: 'application/pdf' });
  formData.append('file', blob, req.filename);
  formData.append('mode', req.mode);
  if (req.printerId) formData.append('printer_id', req.printerId);
  if (req.copies) formData.append('copies', String(req.copies));

  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs`, {
    method: 'POST',
    headers: authHeaders(), // No Content-Type — multipart/formData sets it automatically
    body: formData,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Print job submission failed: ${errMsg}`);
  }
  return (await res.json()) as PrintLatchJob;
}

// ─── Job status (GET /v1/jobs/:id — authenticated) ────────────────────────

export async function getPrintLatchJobStatus(jobId: string): Promise<PrintLatchJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}`, {
    method: 'GET',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { id: jobId, status: 'unknown', error: { message: 'Job not found — may have been completed or lost.' } };
    }
    throw new Error(`Status check failed (HTTP ${res.status})`);
  }
  return (await res.json()) as PrintLatchJob;
}

// ─── Retry failed job (POST /v1/jobs/:id/retry — authenticated) ────────────

export async function retryPrintLatchJob(jobId: string): Promise<PrintLatchJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message ?? `Retry failed (HTTP ${res.status})`);
  }
  return (await res.json()) as PrintLatchJob;
}

// ─── Cancel queued job (POST /v1/jobs/:id/cancel — authenticated) ──────────

export async function cancelPrintLatchJob(jobId: string): Promise<PrintLatchJob> {
  const res = await fetch(`${AGENT_BASE_URL}/v1/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message ?? `Cancel failed (HTTP ${res.status})`);
  }
  return (await res.json()) as PrintLatchJob;
}

// ─── Fetch PDF bytes (from the server's presigned URL) ─────────────────────

export async function fetchPdfBytes(presignedUrl: string): Promise<Uint8Array> {
  const res = await fetch(presignedUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── Constants + helpers ────────────────────────────────────────────────────

export const PRINTLATCH_AGENT_URL = AGENT_BASE_URL;
export const PRINTLATCH_DASHBOARD_URL = `${AGENT_BASE_URL}/app/`;
export const PRINTLATCH_EXE_PATH = '%LOCALAPPDATA%\\PrintLatch\\bin\\printlatch.exe';

export function getPairingCommand(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-printshop.vercel.app';
  // PowerShell requires the call operator (&) + $env: prefix (NOT %VAR%).
  return `& "$env:LOCALAPPDATA\\PrintLatch\\bin\\printlatch.exe" pair --origin ${origin} --name "PrintShop SaaS"`;
}

/** Disconnect — clears the stored browser token. The agent stays running. */
export function disconnectPrintLatch(): void {
  clearToken();
}
