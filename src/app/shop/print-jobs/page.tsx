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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  deviceName: string | null;
  devicePrinterName: string | null;
}

const STATUS_FILTERS = ['needs_review', 'printing', 'queued', 'completed', 'failed'] as const;

/** Distinct visual states per job status — uncertain is never conflated
 *  with completed or failed. */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: 'Queued', cls: 'bg-slate-100 text-slate-700' },
    downloaded: { label: 'Downloaded', cls: 'bg-sky-100 text-sky-800' },
    printing: { label: 'Printing', cls: 'bg-blue-100 text-blue-800' },
    completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800' },
    failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-800' },
    needs_review: { label: 'Needs review', cls: 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' },
    cancelled: { label: 'Cancelled', cls: 'bg-zinc-100 text-zinc-600' },
  };
  const v = map[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-700' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold sm:text-2xl">Print jobs</h1>
        <p className="text-sm text-muted-foreground">
          Cloud-side state for every print job. Jobs that a device could not
          confidently complete are parked as <strong>Needs review</strong> —
          they are never retried or reprinted automatically; resolve them here
          after checking the physical output.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job status filter">
        {(['needs_review', 'all', 'printing', 'queued', 'completed', 'failed'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {f === 'all' ? 'All' : (f === 'needs_review' ? 'Needs review' : f.charAt(0).toUpperCase() + f.slice(1))}
          </button>
        ))}
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Loading / error / empty states */}
      {loading && <p className="text-sm text-muted-foreground" aria-live="polite">Loading print jobs…</p>}
      {!loading && loadError && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {loadError}{' '}
          <Button variant="outline" size="sm" onClick={() => void load()} className="ml-2">Retry</Button>
        </div>
      )}
      {!loading && !loadError && jobs && jobs.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {filter === 'needs_review'
              ? 'No uncertain jobs — nothing needs your attention right now.'
              : 'No print jobs in this state.'}
          </CardContent>
        </Card>
      )}

      {/* Job cards (responsive: 1 column on phones, 2 on large screens) */}
      {!loading && !loadError && jobs && jobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {jobs.map((j) => (
            <Card key={j.jobId} className={j.status === 'needs_review' ? 'border-amber-400' : undefined}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium break-all">
                  {j.fileName ?? <span className="text-muted-foreground">Document {j.fileId}</span>}
                </CardTitle>
                <StatusBadge status={j.status} />
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1">
                  <dt className="text-muted-foreground">Job</dt>
                  <dd className="font-mono text-xs break-all">{j.jobId}</dd>
                  <dt className="text-muted-foreground">Device</dt>
                  <dd>{j.deviceName ?? '—'}{j.devicePrinterName ? <span className="text-muted-foreground"> · printer: {j.devicePrinterName}</span> : null}</dd>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd>{fmtTime(j.queuedAt ?? j.createdAt)}</dd>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{fmtTime(j.startedAt)}</dd>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>{fmtTime(j.completedAt)}</dd>
                  <dt className="text-muted-foreground">Attempts</dt>
                  <dd>{j.attempts}</dd>
                </dl>
                {j.status === 'needs_review' && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>Uncertainty reason:</strong> {j.lastError ?? 'device reported an outcome it cannot verify'}
                  </div>
                )}
                {j.status !== 'needs_review' && j.lastError && (
                  <p className="text-xs text-muted-foreground">Last error: {j.lastError}</p>
                )}
                {j.status === 'needs_review' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={busyJobId === j.jobId}
                      onClick={() => void resolveJob(j, 'completed')}
                    >
                      {busyJobId === j.jobId ? 'Recording…' : 'Mark printed'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyJobId === j.jobId}
                      onClick={() => void resolveJob(j, 'failed')}
                    >
                      Mark failed
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Resolutions are recorded with the operator identity and timestamp in
        the audit log. Resolved jobs are terminal — create a fresh print
        request if another physical attempt is needed.
        {needsReviewCount > 0 && filter !== 'needs_review' ? ` (${needsReviewCount} uncertain job${needsReviewCount > 1 ? 's' : ''} in this list.)` : ''}
      </p>
    </div>
  );
}
