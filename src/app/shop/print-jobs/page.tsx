'use client';

/**
 * /shop/print-jobs — print jobs needing review + recent jobs.
 *
 * Previously this route was an 11-line redirect to /shop/orders (with a
 * broken `params instanceof Promise` check). It is now a real page again:
 *
 *   - GET /api/v1/shops/me/jobs — jobs, most recent first (capped at 100
 *     server-side); ?status=needs_review filters to parked jobs.
 *   - POST /api/v1/shops/me/jobs/{jobId}/resolve { outcome: 'completed' |
 *     'failed', note? } — the shopkeeper checks the printer, records
 *     whether the paper actually printed. Only needs_review jobs can be
 *     resolved; the endpoint never re-queues.
 *
 * The shopkeeper reaches this page from the dashboard "did not print"
 * alert. The print queue itself lives at /shop/orders.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  SegmentedControl,
  TintedButton,
  PrimaryButton,
  EmptyState,
} from '@/components/clear';
import { Printer, Check, X } from 'lucide-react';

interface PrintJob {
  jobId: string;
  fileId: string;
  fileName: string | null;
  status: 'queued' | 'printing' | 'completed' | 'failed' | 'needs_review' | 'cancelled';
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

type Filter = 'needs_review' | 'all';

function timeAgoShort(iso: string | null): string {
  if (!iso) return '—';
  try {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

const STATUS_LABEL: Record<PrintJob['status'], string> = {
  queued: 'Queued',
  printing: 'Printing',
  completed: 'Completed',
  failed: 'Failed',
  needs_review: 'Needs review',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<PrintJob['status'], string> = {
  queued: 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
  printing: 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
  completed: 'bg-[var(--success-tint)] text-[var(--success-text)]',
  failed: 'bg-[var(--danger-tint)] text-[var(--danger-text)]',
  needs_review: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  cancelled: 'bg-[var(--fill)] text-[var(--label-2)]',
};

export default function ShopPrintJobsPage() {
  const api = useApiClient();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('needs_review');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Print jobs · Printelyx';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: PrintJob[] }>('GET', '/api/v1/shops/me/jobs');
      if (r.status === 200 && r.data?.data) setJobs(r.data.data);
      else if (r.status === 401) setError('Session expired. Please log in again.');
      else setError('Could not load print jobs.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.token) return;
    void load();
  }, [api.token, load]);

  const visible = useMemo(
    () => (filter === 'needs_review' ? jobs.filter((j) => j.status === 'needs_review') : jobs),
    [jobs, filter],
  );
  const needsReviewCount = useMemo(
    () => jobs.filter((j) => j.status === 'needs_review').length,
    [jobs],
  );

  const resolve = useCallback(
    async (job: PrintJob, outcome: 'completed' | 'failed') => {
      setResolvingId(job.jobId);
      setActionError(null);
      setActionOk(null);
      try {
        const r = await api.request<{ error?: { message?: string } }>(
          'POST',
          `/api/v1/shops/me/jobs/${job.jobId}/resolve`,
          { body: { outcome } },
        );
        if (r.status >= 400) {
          setActionError(
            r.data?.error?.message ??
              `Could not resolve (HTTP ${r.status}). The job may already have been resolved elsewhere.`,
          );
          return;
        }
        setActionOk(
          outcome === 'completed'
            ? `"${job.fileName ?? 'Job'}" recorded as printed.`
            : `"${job.fileName ?? 'Job'}" recorded as not printed.`,
        );
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setResolvingId(null);
      }
    },
    [api, load],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Print jobs</h1>
        <p className="text-sm text-[var(--label-2)]">
          Jobs the printer couldn&apos;t confirm — check the paper, then record what actually
          happened. The order queue lives at{' '}
          <a href="/shop/orders" className="font-medium text-[var(--accent)]">
            Orders
          </a>
          .
        </p>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}
      {actionError ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            {actionError}
          </p>
        </Group>
      ) : null}
      {actionOk ? (
        <Group>
          <p className="text-sm text-[var(--success-text)]" role="status">
            {actionOk}
          </p>
        </Group>
      ) : null}

      <SegmentedControl
        ariaLabel="Job filter"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: 'needs_review', label: `Needs review ${needsReviewCount}` },
          { value: 'all', label: `All jobs ${jobs.length}` },
        ]}
      />

      <Group padding="rows">
        {loading ? (
          <p className="px-1 py-4 text-sm text-[var(--label-2)]">Loading jobs…</p>
        ) : visible.length === 0 ? (
          <div className="px-1 py-4">
            <EmptyState
              icon={<Printer className="size-7" />}
              title={filter === 'needs_review' ? 'Nothing needs review' : 'No print jobs yet'}
              description={
                filter === 'needs_review'
                  ? 'Every print outcome is accounted for.'
                  : 'Jobs appear here once a device starts printing.'
              }
            />
          </div>
        ) : (
          visible.map((j) => (
            <div
              key={j.jobId}
              className="flex flex-col gap-2 border-b border-[var(--hairline)] py-3 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-[var(--label)]">
                    {j.fileName ?? 'Unnamed file'}
                  </span>
                  <span className="block text-sm text-[var(--label-2)]">
                    {j.devicePrinterName ?? j.deviceName ?? 'Unknown device'}
                    {j.attempts > 1 ? ` · ${j.attempts} attempts` : ''} ·{' '}
                    {timeAgoShort(j.createdAt)}
                  </span>
                  {j.lastError ? (
                    <span className="mt-1 block text-sm text-[var(--danger-text)]">
                      {j.lastError}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONE[j.status]}`}
                >
                  {STATUS_LABEL[j.status]}
                </span>
              </div>
              {j.status === 'needs_review' ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <PrimaryButton
                    size="compact"
                    disabled={resolvingId === j.jobId}
                    onClick={() => void resolve(j, 'completed')}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {resolvingId === j.jobId ? 'Saving…' : 'It printed'}
                  </PrimaryButton>
                  <TintedButton
                    disabled={resolvingId === j.jobId}
                    onClick={() => void resolve(j, 'failed')}
                  >
                    <X className="size-4" aria-hidden="true" />
                    It did not print
                  </TintedButton>
                </div>
              ) : null}
            </div>
          ))
        )}
      </Group>
      <p className="text-xs text-[var(--label-2)]">
        Resolving a job is final — it never re-queues. If the paper did not
        print, create a fresh print from the order.
      </p>
    </div>
  );
}
