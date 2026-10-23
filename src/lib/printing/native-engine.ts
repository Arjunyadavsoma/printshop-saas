/**
 * Native Windows printing engine adapter.
 *
 * Talks to a local Node.js service running on the shopkeeper's Windows
 * computer at http://127.0.0.1:32192. The service uses the
 * `windows-pdf-printer-native` library to submit PDFs to the Windows
 * print queue with per-job duplex, copies, paper size, color, etc.
 *
 * SECURITY:
 * - The local service binds to 127.0.0.1 only (no LAN exposure)
 * - Origin-based pairing (similar to PrintLatch's pairing flow)
 * - Bearer token stored in localStorage (per-origin, short-lived)
 * - Strict request schema validation on the service side
 * - No arbitrary file paths accepted — only PDF bytes via Buffer
 */

import type {
  PrintEngine, PrintEngineId, PrintJobSettings, PrintJobResult,
  PrintJobState, DiscoveredPrinter, DuplexSetting,
} from './types';

const SERVICE_BASE_URL = 'http://127.0.0.1:32192';
const TOKEN_KEY = 'native_printer_token';
const PREFS_KEY = 'native_printer_prefs';

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface NativePrinterPrefs {
  engine: PrintEngineId;
  selectedPrinter?: string;
  defaultPaperSize?: string;
  defaultColor?: 'bw' | 'color';
  defaultDuplex?: DuplexSetting;
}

export function getNativePrefs(): NativePrinterPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { engine: 'native' };
    return { engine: 'native', ...JSON.parse(raw) };
  } catch { return { engine: 'native' }; }
}

export function saveNativePrefs(prefs: NativePrinterPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

export function getNativePairingCommand(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://printshop-saas-three.vercel.app';
  return `node "${process.env.LOCALAPPDATA ?? '%LOCALAPPDATA%'}\\PrintShop\\native-printer\\index.js" pair --origin ${origin}`;
}

export async function confirmNativePairing(code: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${SERVICE_BASE_URL}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data?.token) { setToken(data.token); return { success: true }; }
    return { success: false, error: 'No token returned' };
  } catch (e: any) {
    if (e.name === 'TypeError') return { success: false, error: 'Service not running. Start the native printer service first.' };
    return { success: false, error: e.message };
  }
}

export function disconnectNative() { clearToken(); }

export class NativePrintEngine implements PrintEngine {
  readonly id: PrintEngineId = 'native';
  readonly displayName = 'Native Windows Printing';

  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
    const token = getToken();
    if (!token) return { available: false, error: 'Not paired. Run the pairing command on your Windows computer.' };
    try {
      const res = await fetch(`${SERVICE_BASE_URL}/v1/printers`, {
        method: 'GET',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401 || res.status === 403) {
        return { available: false, error: 'Token expired. Re-pair the service.' };
      }
      if (!res.ok) return { available: false, error: `Service error (HTTP ${res.status})` };
      return { available: true };
    } catch (e: any) {
      if (e.name === 'TypeError') return { available: false, error: 'Service not running on this computer.' };
      if (e.name === 'TimeoutError') return { available: false, error: 'Service timeout.' };
      return { available: false, error: e.message };
    }
  }

  async getPrinters(): Promise<DiscoveredPrinter[]> {
    const res = await fetch(`${SERVICE_BASE_URL}/v1/printers`, {
      method: 'GET',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Failed to get printers (HTTP ${res.status})`);
    const data = await res.json();
    return (data.printers ?? []) as DiscoveredPrinter[];
  }

  async submitJob(pdf: Uint8Array, filename: string, settings: PrintJobSettings): Promise<PrintJobResult> {
    const formData = new FormData();
    const blob = new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' });
    formData.append('file', blob, filename);
    formData.append('copies', String(settings.copies ?? 1));
    if (settings.duplex) formData.append('duplex', settings.duplex);
    if (settings.color) formData.append('color', settings.color);
    if (settings.paperSize) formData.append('paperSize', settings.paperSize);
    if (settings.orientation) formData.append('orientation', settings.orientation);
    if (settings.printerName) formData.append('printerName', settings.printerName);

    const res = await fetch(`${SERVICE_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Print failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return { jobId: data.id, status: data.status ?? 'accepted', engine: 'native', error: data?.error?.message };
  }

  async getJobStatus(jobId: string): Promise<PrintJobState> {
    const res = await fetch(`${SERVICE_BASE_URL}/v1/jobs/${jobId}`, {
      method: 'GET',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 404) return { id: jobId, status: 'unknown', engine: 'native', error: 'Job not found' };
      throw new Error(`Status check failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return { id: data.id, status: data.status, engine: 'native', error: data?.error?.message, printerName: data.printerName };
  }

  async retryJob(jobId: string): Promise<PrintJobState> {
    const res = await fetch(`${SERVICE_BASE_URL}/v1/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Retry failed (HTTP ${res.status})`);
    const data = await res.json();
    return { id: data.id, status: data.status, engine: 'native' };
  }

  async cancelJob(jobId: string): Promise<PrintJobState> {
    const res = await fetch(`${SERVICE_BASE_URL}/v1/jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Cancel failed (HTTP ${res.status})`);
    const data = await res.json();
    return { id: data.id, status: data.status, engine: 'native' };
  }
}

export const NATIVE_SERVICE_URL = SERVICE_BASE_URL;
export const NATIVE_SERVICE_DASHBOARD = `${SERVICE_BASE_URL}/health`;
