import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * PrintLatch integration regression tests.
 * Based on the official PrintLatch API: https://github.com/arturict/printlatch/blob/main/docs/api.md
 *
 * API contract:
 *   GET  /health         — unauthenticated liveness
 *   POST /v1/pair        — browser-only pairing (code → browser token)
 *   GET  /v1/printers    — authenticated, returns printer list
 *   POST /v1/jobs        — authenticated, multipart (file, mode, printer_id, copies)
 *   GET  /v1/jobs/:id    — authenticated, job status
 *   POST /v1/jobs/:id/retry   — retry a failed job
 *   POST /v1/jobs/:id/cancel  — cancel a queued job
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
// Mock localStorage for token storage
const mockStorage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mockStorage.get(k) ?? null,
  setItem: (k: string, v: string) => { mockStorage.set(k, v); },
  removeItem: (k: string) => { mockStorage.delete(k); },
  clear: () => { mockStorage.clear(); },
});

const {
  checkPrintLatchStatus,
  confirmPrintLatchPairing,
  submitPrintLatchJob,
  getPrintLatchJobStatus,
  getPrintLatchPrinters,
  retryPrintLatchJob,
  cancelPrintLatchJob,
  fetchPdfBytes,
  getPairingCommand,
  disconnectPrintLatch,
  PRINTLATCH_AGENT_URL,
  PRINTLATCH_DASHBOARD_URL,
} = await import('@/lib/printlatch/client');

describe('PrintLatch client — status check (GET /v1/printers when token exists)', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "pairing-required" when no token is stored (does NOT try /health — avoids CORS error)', async () => {
    // No mockFetch mock needed — the function should NOT call fetch when there's no token.
    const { state, health, error } = await checkPrintLatchStatus();
    expect(state).toBe('pairing-required');
    expect(health).toBeNull();
    expect(error).toBeNull();
    // Verify no fetch was made (no /health request that would cause a CORS error).
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns "connected" when token is valid + printers endpoint returns 200', async () => {
    mockStorage.set('printlatch_token', 'pl_live_test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ printers: [{ id: 'capture:pdf', name: 'PDF Capture', kind: 'capture' }] }),
    });
    const { state, printers } = await checkPrintLatchStatus();
    expect(state).toBe('connected');
    expect(printers).toHaveLength(1);
    expect(printers![0].name).toBe('PDF Capture');
    // Verify the request went to /v1/printers (NOT /health).
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/printers');
  });

  it('returns "disconnected" when token is rejected (401) — preserves the token for retry', async () => {
    mockStorage.set('printlatch_token', 'expired');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const { state } = await checkPrintLatchStatus();
    // Token is NOT cleared — the agent might have been restarted.
    // User can retry or explicitly disconnect.
    expect(state).toBe('disconnected');
    expect(mockStorage.get('printlatch_token')).toBe('expired');
  });

  it('returns "disconnected" when the agent is not running (network error)', async () => {
    mockStorage.set('printlatch_token', 'pl_live_test');
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { state, error } = await checkPrintLatchStatus();
    expect(state).toBe('disconnected');
    expect(error).toContain('not reachable');
  });
});

describe('PrintLatch client — pairing (POST /v1/pair)', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.clear(); });

  it('stores the browser token on successful pairing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'pl_live_abc123' }),
    });
    const result = await confirmPrintLatchPairing('PL-XXXX-XXXX-XXXX-XXXX');
    expect(result.success).toBe(true);
    expect(mockStorage.get('printlatch_token')).toBe('pl_live_abc123');
  });

  it('returns error on failed pairing (wrong code)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'bad_request', message: 'Invalid pairing code' } }),
    });
    const result = await confirmPrintLatchPairing('PL-WRONG');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid pairing code');
  });

  it('returns error when agent is not reachable', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await confirmPrintLatchPairing('PL-TEST');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not reachable');
  });
});

describe('PrintLatch client — job submission (POST /v1/jobs)', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.set('printlatch_token', 'pl_live_test'); });

  it('submits a print job with file + mode + copies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'job-123', status: 'queued' }),
    });
    const job = await submitPrintLatchJob({
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      filename: 'test.pdf',
      mode: 'print',
      copies: 2,
    });
    expect(job.id).toBe('job-123');
    expect(job.status).toBe('queued');
    // Verify the request was sent to the correct endpoint with auth header
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/jobs');
    expect(callArgs.headers.Authorization).toBe('Bearer pl_live_test');
    // Verify the form data fields
    const formData = callArgs.body as FormData;
    expect(formData.get('mode')).toBe('print');
    expect(formData.get('copies')).toBe('2');
    expect(formData.get('file')).toBeInstanceOf(Blob);
  });

  it('submits a preview job (no printer_id needed)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'job-1', status: 'queued' }),
    });
    const job = await submitPrintLatchJob({
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      filename: 'preview.pdf',
      mode: 'preview',
    });
    expect(job.id).toBe('job-1');
    const formData = mockFetch.mock.calls[0][1].body as FormData;
    expect(formData.get('mode')).toBe('preview');
    expect(formData.get('printer_id')).toBeNull(); // not set
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'bad_request', message: 'MIME type must be application/pdf' } }),
    });
    await expect(submitPrintLatchJob({
      pdf: new Uint8Array([0]),
      filename: 'bad.pdf',
      mode: 'print',
    })).rejects.toThrow('MIME type must be application/pdf');
  });
});

describe('PrintLatch client — job status (GET /v1/jobs/:id)', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.set('printlatch_token', 'pl_live_test'); });

  it('returns the job status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'job-123', status: 'completed' }),
    });
    const job = await getPrintLatchJobStatus('job-123');
    expect(job.id).toBe('job-123');
    expect(job.status).toBe('completed');
  });

  it('returns "unknown" on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const job = await getPrintLatchJobStatus('missing');
    expect(job.status).toBe('unknown');
  });
});

describe('PrintLatch client — retry + cancel', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.set('printlatch_token', 'pl_live_test'); });

  it('retries a failed job (POST /v1/jobs/:id/retry)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1', status: 'queued' }) });
    const job = await retryPrintLatchJob('job-1');
    expect(job.status).toBe('queued');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/jobs/job-1/retry');
  });

  it('cancels a queued job (POST /v1/jobs/:id/cancel)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1', status: 'canceled' }) });
    const job = await cancelPrintLatchJob('job-1');
    expect(job.status).toBe('canceled');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/jobs/job-1/cancel');
  });
});

describe('PrintLatch client — printers (GET /v1/printers)', () => {
  beforeEach(() => { mockFetch.mockReset(); mockStorage.set('printlatch_token', 'pl_live_test'); });

  it('returns the list of printers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ printers: [{ id: 'capture:pdf', name: 'PDF Capture', kind: 'capture' }] }),
    });
    const printers = await getPrintLatchPrinters();
    expect(printers).toHaveLength(1);
    expect(printers[0].id).toBe('capture:pdf');
  });
});

describe('PrintLatch client — PDF fetching', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('fetches PDF bytes from a presigned URL', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => pdfBytes.buffer });
    const bytes = await fetchPdfBytes('https://example.com/test.pdf?token=abc');
    expect(bytes.length).toBe(4);
    expect(bytes[0]).toBe(0x25);
  });
});

describe('PrintLatch client — pairing command + constants', () => {
  it('generates the pairing command with PowerShell & syntax', () => {
    const cmd = getPairingCommand();
    expect(cmd).toContain('pair --origin');
    expect(cmd).toContain('& "$env:LOCALAPPDATA');
  });

  it('exposes the agent URL + dashboard URL', () => {
    expect(PRINTLATCH_AGENT_URL).toBe('http://127.0.0.1:32191');
    expect(PRINTLATCH_DASHBOARD_URL).toBe('http://127.0.0.1:32191/app/');
  });
});

describe('PrintLatch client — disconnect', () => {
  it('clears the stored token', () => {
    mockStorage.set('printlatch_token', 'pl_live_test');
    disconnectPrintLatch();
    expect(mockStorage.get('printlatch_token')).toBeUndefined();
  });
});

describe('CSP middleware — PrintLatch agent origin', () => {
  it('includes http://127.0.0.1:32191 in connect-src', async () => {
    delete process.env.SUPABASE_URL;
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('http://127.0.0.1:32191');
  });
});
