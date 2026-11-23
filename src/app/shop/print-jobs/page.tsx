'use client';

/**
 * Shop portal — Print jobs / operator resolution (Phase 3, P2-3).
 *
 * Surface for UNCERTAIN print jobs (`needs_review`): a device reported an
 * outcome it cannot vouch for (spooler result unknown, crash mid-print, …).
 * The shopkeeper inspects the printer/delivery evidence, then resolves the
 * job as completed or failed. Resolution is a deliberate operator action —
 * nothing is automatically retried or reprinted.
 *
 * JOB-level uncertainty is intentionally kept distinct from FILE-level
 * page-count review (see orders page): this page lists PrintJob rows, the
 * orders page reviews PrintFile pricing inputs.
 *
 * Data sources (real contracts, see docs/API_CONTRACT.md):
 *   GET  /api/v1/shops/me/jobs?status=<status>   — jobs listing (max 100)
 *   POST /api/v1/shops/me/jobs/{jobId}/resolve   — {outcome, note?} → 200
 *                                                  | 401 | 404 | 409
 */
import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Group, StatusPill } from '@/components/clear';

interface JobRow {
  jobId: string;
  fileId: string;
  fileName: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  queuedAt: string | null;
  deviceId: string | null;
  deviceName: string | null;
  devicePrinterName: string | null;
}

const STATUS_FILTERS = ['needs_review', 'printing', 'queued', 'completed', 'failed'] as const;

/** Maps a job status to a Clear StatusPill lifecycle state. */
function JobStatusPill({ status }: { status: string }) {
  const map: Record<string, { s: 'pending' | 'printing' | 'ready' | 'collected' | 'error'; label: string }> = {
    queued: { s: 'pending', label: 'Queued' },
    downloaded: { s: 'pending', label: 'Downloaded' },
    printing: { s: 'printing', label: 'Printing' },
    completed: { s: 'collected', label: 'Completed' },
    failed: { s: 'error', label: 'Failed' },
    needs_review: { s: 'pending', label: 'Needs review' },
    cancelled: { s: 'error', label: 'Cancelled' },
  };
  const v = map[status] ?? { s: 'pending' as const, label: status };
  return <StatusPill status={v.s} label={v.label} />;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function PrintJobsPage() {
  const api = useApiClient();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number] | 'all'>('needs_review');
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      // api.request returns the full response envelope in `data`.
      const r = await api.request<{ data?: { jobs?: JobRow[] }; error?: { code?: string; message?: string } }>(
        'GET',
        `/api/v1/shops/me/jobs${qs}`,
      );
      const body = r.data;
      if (r.error || !body?.data) {
        setLoadError(r.error ?? body?.error?.message ?? 'Could not load print jobs.');
        setJobs(null);
      } else {
        setJobs(body.data.jobs ?? []);
      }
    } catch {
      setLoadError('Could not load print jobs.');
      setJobs(null);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => { void load(); }, [load]);

  async function resolveJob(job: JobRow, outcome: 'completed' | 'failed') {
    const what = outcome === 'completed'
      ? `Record job as physically PRINTED?`
      : `Record job as FAILED (no output produced)?`;
    if (!window.confirm(`${what}\n\nDocument: ${job.fileName ?? job.fileId}\nThis is a deliberate operator decision and is audit-logged.`)) return;
    setBusyJobId(job.jobId);
    setNotice(null);
    try {
      const r = await api.request<{
        data?: { resolvedBy?: string; resolvedAt?: string; message?: string };
        error?: { code?: string; message?: string };
      }>('POST', `/api/v1/shops/me/jobs/${job.jobId}/resolve`, {
        body: { outcome, note: `Resolved from print-jobs view (${outcome})` },
      });
      const body = r.data;
      if (r.error || body?.error) {
        // The UI must NOT report success when the backend rejects the request.
        const code = body?.error?.code;
        setNotice({ kind: 'err', text: code === 'JOB_NOT_IN_NEEDS_REVIEW'
          ? 'Job state just changed — the list has been refreshed. Reload and retry if still uncertain.'
          : (body?.error?.message ?? r.error ?? 'Resolution rejected.') });
        await load();
      } else {
        setNotice({
          kind: 'ok',
          text: `Recorded as ${outcome} by ${body?.data?.resolvedBy ?? 'operator'} at ${fmtTime(body?.data?.resolvedAt ?? null)}.`,
        });
        await load(); // refresh from the server — the backend stays authoritative
      }
    } catch {
      setNotice({ kind: 'err', text: 'Resolution failed — the job remains needs_review.' });
    } finally {
      setBusyJobId(null);
    }
  }

  const needsReviewCount = (jobs ?? []).filter((j) => j.status === 'needs_review').length;

  /**
   * Remote per-job control (plan M2): issue retry_job / cancel_job to the
   * OWNING device as an agent command. The command is idempotent-keyed by the
   * backend; execution results appear on Devices → Recent commands. The agent
   * is the safety boundary — it refuses unsafe cancels (already spooled /
   * uncertain outcome) with a message that surfaces as a failed command.
   */
  async function issueJobCommand(job: JobRow, commandType: 'retry_job' | 'cancel_job') {
    if (!job.deviceId) {
      setNotice({ kind: 'err', text: 'This job has no device assigned (the device may have been removed), so it cannot be controlled remotely.' });
      return;
    }
    const what = commandType === 'retry_job'
      ? `REPRINT this job on device "${job.deviceName ?? job.deviceId}"?`
      : `CANCEL this job on device "${job.deviceName ?? job.deviceId}"?`;
    if (!window.confirm(`${what}\n\nDocument: ${job.fileName ?? job.fileId}\n\nThe command is queued in the cloud and executed when the shop PC is online. Check Devices → Recent commands for the execution result.`)) return;
    setBusyJobId(job.jobId);
    setNotice(null);
    try {
      const r = await api.request<{
        data?: { commandId?: string; status?: string; idempotentReplay?: boolean };
        error?: { code?: string; message?: string };
      }>('POST', `/api/v1/shops/me/devices/${job.deviceId}/commands`, {
        body: {
          commandType,
          payload: { jobId: job.jobId },
          idempotencyKey: `${commandType}:${job.jobId}`,
        },
      });
      const body = r.data;
      if (r.error || body?.error) {
        setNotice({ kind: 'err', text: body?.error?.message ?? r.error ?? 'Command rejected.' });
      } else {
        setNotice({
          kind: 'ok',
          text: `${commandType === 'retry_job' ? 'Reprint' : 'Cancel'} command sent to ${job.deviceName ?? 'the device'}${body?.data?.idempotentReplay ? ' (already queued — no duplicate created)' : ''}. Open Devices → Recent commands to watch it execute.`,
        });
      }
    } catch {
      setNotice({ kind: 'err', text: 'Could not send the command — check your connection.' });
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 sm:px-6 lg:max-w-[920px] lg:space-y-6 lg:py-8">
      <header className="space-y-1">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)]">Print jobs</h1>
        <p className="text-sm text-[var(--label-2)]">
          Cloud-side state for every print job. Jobs that a device could not
          confidently complete are parked as <strong>Needs review</strong> —
          they are never retried or reprinted automatically; resolve them here
          after checking the physical output.
        </p>
      </header>

      {/* Filters — Clear chip-style */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job status filter">
        {(['needs_review', 'all', 'printing', 'queued', 'completed', 'failed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={[
              'inline-flex min-h-[36px] items-center rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === f
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'bg-[var(--fill)] text-[var(--label-2)] hover:bg-[var(--track)]',
            ].join(' ')}
          >
            {f === 'all' ? 'All' : (f === 'needs_review' ? 'Needs review' : f.charAt(0).toUpperCase() + f.slice(1))}
          </button>
        ))}
      </div>

      {notice && (
        <Group padding="content" className={notice.kind === 'ok' ? 'bg-[var(--success-tint)]' : 'bg-[var(--danger-tint)]'}>
          <p className={notice.kind === 'ok' ? 'text-sm text-[var(--success-text)]' : 'text-sm text-[var(--danger-text)]'}>
            {notice.text}
          </p>
        </Group>
      )}

      {/* Loading / error / empty states */}
      {loading && <p className="text-sm text-[var(--label-2)]" aria-live="polite">Loading print jobs…</p>}
      {!loading && loadError && (
        <Group padding="content" className="bg-[var(--danger-tint)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--danger-text)]">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--fill)]"
            >
              Retry
            </button>
          </div>
        </Group>
      )}
      {!loading && !loadError && jobs && jobs.length === 0 && (
        <Group padding="content">
          <p className="py-8 text-center text-sm text-[var(--label-2)]">
            {filter === 'needs_review'
              ? 'No uncertain jobs — nothing needs your attention right now.'
              : 'No print jobs in this state.'}
          </p>
        </Group>
      )}

      {/* Job cards (responsive: 1 column on phones, 2 on large screens) */}
      {!loading && !loadError && jobs && jobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {jobs.map((j) => (
            <Group key={j.jobId} padding="content" className={j.status === 'needs_review' ? 'ring-1 ring-[var(--warning)]' : ''}>
              <div className="flex flex-row items-center justify-between gap-2 pb-2">
                <h3 className="text-sm font-medium break-all text-[var(--label)]">
                  {j.fileName ?? <span className="text-[var(--label-2)]">Document {j.fileId}</span>}
                </h3>
                <JobStatusPill status={j.status} />
              </div>
              <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-[var(--label-2)]">Job</dt>
                <dd className="font-mono text-xs break-all text-[var(--label)]">{j.jobId}</dd>
                <dt className="text-[var(--label-2)]">Device</dt>
                <dd className="text-[var(--label)]">{j.deviceName ?? '—'}{j.devicePrinterName ? <span className="text-[var(--label-2)]"> · printer: {j.devicePrinterName}</span> : null}</dd>
                <dt className="text-[var(--label-2)]">Submitted</dt>
                <dd className="text-[var(--label)]">{fmtTime(j.queuedAt ?? j.createdAt)}</dd>
                <dt className="text-[var(--label-2)]">Started</dt>
                <dd className="text-[var(--label)]">{fmtTime(j.startedAt)}</dd>
                <dt className="text-[var(--label-2)]">Finished</dt>
                <dd className="text-[var(--label)]">{fmtTime(j.completedAt)}</dd>
                <dt className="text-[var(--label-2)]">Attempts</dt>
                <dd className="text-[var(--label)]">{j.attempts}</dd>
              </dl>
              {j.status === 'needs_review' && (
                <div className="mt-2 rounded-[var(--radius-input)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] px-3 py-2 text-xs text-[var(--warning-text)]">
                  <strong>Uncertainty reason:</strong> {j.lastError ?? 'device reported an outcome it cannot verify'}
                </div>
              )}
              {j.status !== 'needs_review' && j.lastError && (
                <p className="mt-2 text-xs text-[var(--label-2)]">Last error: {j.lastError}</p>
              )}
              {j.status === 'needs_review' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyJobId === j.jobId}
                    onClick={() => void resolveJob(j, 'completed')}
                    className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
                  >
                    {busyJobId === j.jobId ? 'Recording…' : 'Mark printed'}
                  </button>
                  <button
                    type="button"
                    disabled={busyJobId === j.jobId}
                    onClick={() => void resolveJob(j, 'failed')}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
                  >
                    Mark failed
                  </button>
                </div>
              )}
              {(j.status === 'failed' || j.status === 'needs_review' || j.status === 'queued' || j.status === 'downloaded') && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--hairline)] pt-2">
                  <button
                    type="button"
                    disabled={busyJobId === j.jobId}
                    onClick={() => void issueJobCommand(j, 'retry_job')}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--label)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
                  >
                    {busyJobId === j.jobId ? 'Sending…' : 'Reprint on device'}
                  </button>
                  {(j.status === 'queued' || j.status === 'downloaded') && (
                    <button
                      type="button"
                      disabled={busyJobId === j.jobId}
                      onClick={() => void issueJobCommand(j, 'cancel_job')}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
                    >
                      Cancel job
                    </button>
                  )}
                  {!j.deviceId && (
                    <span className="text-xs text-[var(--label-2)] self-center">
                      No device assigned — remote actions unavailable.
                    </span>
                  )}
                </div>
              )}
            </Group>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--label-2)]">
        Resolutions are recorded with the operator identity and timestamp in
        the audit log. Resolved jobs are terminal — create a fresh print
        request if another physical attempt is needed.
        {needsReviewCount > 0 && filter !== 'needs_review' ? ` (${needsReviewCount} uncertain job${needsReviewCount > 1 ? 's' : ''} in this list.)` : ''}
      </p>
    </div>
  );
}
