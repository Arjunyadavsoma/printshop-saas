import { io, type Socket } from 'socket.io-client';
import { loadConfig, loadDiskQueue, saveDiskQueue, type AgentConfig } from './config.js';
import { printFile, writeToTemp, type PrintSettings } from './printer.js';

interface PendingJob {
  jobId: string;
  fileId: string;
  orderId: string;
  filename: string;
  downloadUrl: string;
  copies: number;
  colorMode: string;
  duplex: boolean;
  paperSize: string;
  pageRange: string | null;
}

const api = (c: AgentConfig, path: string) => `${c.apiUrl}${path}`;
const authed = (c: AgentConfig, init: RequestInit = {}) => ({
  ...init,
  headers: { ...(init.headers ?? {}), Authorization: `Bearer ${c.deviceToken}`, 'Content-Type': 'application/json' },
});

async function getJwt(c: AgentConfig): Promise<string | null> {
  const r = await fetch(api(c, '/api/v1/agents/token'), { method: 'POST', ...authed(c) });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { accessToken?: string } };
  return j.data?.accessToken ?? null;
}

async function heartbeat(c: AgentConfig): Promise<void> {
  await fetch(api(c, '/api/v1/agents/heartbeat'), { method: 'POST', ...authed(c), body: JSON.stringify({ version: c.version, os: process.platform, printerName: process.env.PRINTER_NAME }) }).catch(() => {});
}

async function fetchPending(c: AgentConfig): Promise<PendingJob[]> {
  const r = await fetch(api(c, '/api/v1/agents/jobs/pending'), { headers: { Authorization: `Bearer ${c.deviceToken}` } });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { jobs?: PendingJob[] } };
  return j.data?.jobs ?? [];
}

async function reportStatus(c: AgentConfig, jobId: string, status: 'printing' | 'completed' | 'failed', extra?: Record<string, unknown>): Promise<{ ok: boolean; skipped?: boolean }> {
  const r = await fetch(api(c, `/api/v1/agents/jobs/${jobId}/status`), { method: 'POST', ...authed(c), body: JSON.stringify({ status, ...extra }) });
  if (!r.ok) return { ok: false };
  const j = (await r.json().catch(() => ({}))) as { data?: { skipped?: boolean } };
  return { ok: true, skipped: j.data?.skipped === true };
}

/** Claim + download + print + report. Returns true if the job was handled. */
async function handleJob(c: AgentConfig, job: PendingJob): Promise<boolean> {
  // Claim — first-claim-wins. If skipped (another agent / in-process handler
  // already claimed it), bail to avoid double-printing.
  const claim = await reportStatus(c, job.jobId, 'printing', { printerName: process.env.PRINTER_NAME });
  if (!claim.ok || claim.skipped) return false;
  console.log(`→ job ${job.jobId.slice(0, 8)} claimed: ${job.filename} (${job.copies}× ${job.colorMode}${job.duplex ? '/duplex' : ''})`);

  try {
    const res = await fetch(job.downloadUrl);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const tmpPath = writeToTemp(job.filename, bytes);
    console.log(`  downloaded ${bytes.length} bytes → ${tmpPath}`);

    const settings: PrintSettings = { copies: job.copies, colorMode: job.colorMode, duplex: job.duplex, paperSize: job.paperSize };
    const result = await printFile(tmpPath, settings);
    if (!result.ok) throw new Error(result.error ?? 'print failed');

    await reportStatus(c, job.jobId, 'completed', { printerName: result.printerName });
    console.log(`✓ job ${job.jobId.slice(0, 8)} completed${result.printerName ? ` (${result.printerName})` : ''}`);
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`✗ job ${job.jobId.slice(0, 8)} failed: ${error}`);
    await reportStatus(c, job.jobId, 'failed', { lastError: error }).catch(() => {});
    return false;
  }
}

/** The daemon: socket.io push + polling fallback + heartbeat + disk queue. */
export async function runAgent(): Promise<void> {
  const config = loadConfig();
  if (!config) { console.error('No config. Run `print-agent setup` first.'); process.exit(1); }

  console.log(`print-agent v${config.version} starting (shop=${config.shopSlug}, api=${config.apiUrl})`);
  console.log(`demo mode: ${process.env.PRINT_AGENT_DEMO === '1' ? 'ON (no real printer)' : 'OFF'}`);

  // Replay any disk-queued jobs from a previous offline run.
  const diskJobs = loadDiskQueue();
  if (diskJobs.length > 0) {
    console.log(`replaying ${diskJobs.length} disk-queued job(s)`);
    for (const j of diskJobs) { void handleJob(config, j as PendingJob); }
    saveDiskQueue([]);
  }

  // Heartbeat loop.
  void heartbeat(config);
  setInterval(() => void heartbeat(config), 15000);

  // Polling fallback (every 2s).
  setInterval(async () => {
    const jobs = await fetchPending(config);
    for (const j of jobs) void handleJob(config, j);
  }, 2000);

  // Socket.io push (instant job.dispatch) — best-effort; polling covers gaps.
  let backoff = 1000;
  const connect = () => {
    void (async () => {
      const jwt = await getJwt(config);
      if (!jwt) { console.error('could not obtain JWT (device token invalid?)'); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); return; }
      const socket: Socket = io(`${config.realtimeUrl}/`, { path: '/', transports: ['websocket', 'polling'], auth: { token: jwt } });
      // The mini-service expects an 'auth' event with {token}, not socket.io's auth option. Emit on connect.
      socket.on('connect', () => { backoff = 1000; console.log('realtime connected'); socket.emit('auth', { token: jwt }); });
      socket.on('auth-ok', () => console.log('realtime authed'));
      socket.on('auth-error', (e: unknown) => console.error('realtime auth failed', e));
      socket.on('disconnect', () => console.log('realtime disconnected (reconnecting…)'));
      socket.on('job.dispatch', (payload: PendingJob) => { console.log('realtime push: job.dispatch'); void handleJob(config, payload); });
      socket.on('connect_error', () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); });
    })().catch(() => {});
  };
  connect();

  console.log('agent running. Ctrl-C to stop.');
  // Keep alive.
  setInterval(() => {}, 1 << 30);
}
