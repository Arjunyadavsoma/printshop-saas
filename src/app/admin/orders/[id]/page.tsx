'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  Store,
  User,
  CreditCard,
  FileText,
  Printer,
  History,
  IndianRupee,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminOrderDetailResponse,
  type FileStatus,
  type PrintJobStatus,
} from '@/components/portal/admin-types';
import {
  OrderStatusBadge,
  StatusIndicator,
  type StatusVariant,
} from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  try { return formatINRFromPaise(paise); } catch { return '—'; }
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return s;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const FILE_STATUS_VARIANT: Record<FileStatus, StatusVariant> = {
  pending: 'neutral',
  queued: 'brand',
  printing: 'neutral',
  completed: 'success',
  failed: 'danger',
  needs_review: 'warning',
};

const JOB_STATUS_VARIANT: Record<PrintJobStatus, StatusVariant> = {
  queued: 'brand',
  assigned: 'info',
  printing: 'neutral',
  completed: 'success',
  failed: 'danger',
  needs_review: 'warning',
};

function FileStatusBadge({ status }: { status: FileStatus }) {
  return (
    <StatusIndicator variant={FILE_STATUS_VARIANT[status]} label={status.replace('_', ' ')} />
  );
}

function JobStatusBadge({ status }: { status: PrintJobStatus }) {
  return (
    <StatusIndicator variant={JOB_STATUS_VARIANT[status]} label={status.replace('_', ' ')} />
  );
}

interface InfoRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ icon: Icon, label, value, mono }: InfoRowProps) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-0.5 text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * /admin/orders/[id] — admin order detail.
 *
 * Renders shop info, customer info, payment info (txnId + UTR — but NO
 * credentials), file metadata, print jobs, and a status history timeline.
 *
 * The admin can see paymentTxnId + paymentUtr (reconciliation needs them) but
 * NOT payment credentials (which only the shop owner controls).
 */
export default function AdminOrderDetailPage() {
  const api = useApiClient();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [data, setData] = useState<AdminOrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<unknown>('GET', `/api/v1/admin/orders/${orderId}`);
      setData(unwrap<AdminOrderDetailResponse>(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  // Build a status-history timeline from the order/file/print-job timestamps.
  const timeline: { at: string | null; label: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [];
  if (data) {
    if (data.order.createdAt) timeline.push({ at: data.order.createdAt, label: 'Order created', icon: ShoppingBag, tone: 'text-muted-foreground' });
    if (data.order.paidAt) timeline.push({ at: data.order.paidAt, label: 'Payment confirmed', icon: CreditCard, tone: 'text-success' });
    for (const f of data.files) {
      if (f.printedAt) timeline.push({ at: f.printedAt, label: `File printed: ${f.originalFilename}`, icon: FileText, tone: 'text-muted-foreground' });
    }
    for (const j of data.printJobs) {
      if (j.startedAt) timeline.push({ at: j.startedAt, label: `Print job started (#${j.id.slice(0, 8)})`, icon: Printer, tone: 'text-muted-foreground' });
      if (j.completedAt) timeline.push({ at: j.completedAt, label: `Print job completed (#${j.id.slice(0, 8)})`, icon: Printer, tone: 'text-success' });
    }
    if (data.order.status === 'collected') timeline.push({ at: data.order.updatedAt, label: 'Order collected', icon: ShieldCheck, tone: 'text-success' });
    if (data.order.status === 'cancelled') timeline.push({ at: data.order.updatedAt, label: 'Order cancelled', icon: AlertCircle, tone: 'text-danger' });
    timeline.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return ta - tb;
    });
  }

  const orderToken = data ? data.order.id.slice(0, 8) : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={loading || !data ? 'Order detail' : `Order #${orderToken}`}
        description="Admin order detail"
        breadcrumbs={
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link href="/admin/orders" className="hover:text-foreground">
              Orders
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-foreground">#{orderToken || '…'}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/orders')}
              className="gap-1"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="min-h-[44px] gap-2"
            >
              <RefreshCw
                className={`size-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load order</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading || !data ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {/* Top status bar */}
          <Card className="bg-surface">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <OrderStatusBadge status={data.order.status} />
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {inr(data.order.totalAmountPaise)}
                </span>
                <span className="text-sm text-muted-foreground">{data.order.currency}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
                <span>Created {formatDateTime(data.order.createdAt)}</span>
                <span aria-hidden="true">·</span>
                <span>Updated {formatDateTime(data.order.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Shop + customer info */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Shop &amp; customer</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Order parties
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3">
                  <div className="text-xs font-medium text-muted-foreground">Shop</div>
                  <Link
                    href={`/admin/shops/${data.order.shopId}`}
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                  >
                    <Store className="size-3.5" aria-hidden="true" />
                    {data.order.shopName}{' '}
                    <span className="font-mono text-xs">/{data.order.shopSlug}</span>
                  </Link>
                </div>
                <Separator className="my-3" />
                <InfoRow icon={User} label="Customer token" value={data.order.customerToken} mono />
                <InfoRow icon={User} label="Customer phone" value={data.order.customerPhone ?? '—'} mono />
                <InfoRow icon={ShoppingBag} label="Notes" value={data.order.notes ?? '—'} />
              </CardContent>
            </Card>

            {/* Payment info */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Payment</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Transaction details for reconciliation.{' '}
                  <strong>Credentials are never shown.</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InfoRow icon={CreditCard} label="Payment provider" value={data.order.paymentProvider} mono />
                <InfoRow icon={CreditCard} label="Transaction ID (txnId)" value={data.order.paymentTxnId ?? '—'} mono />
                <InfoRow icon={CreditCard} label="UTR (bank reference)" value={data.order.paymentUtr ?? '—'} mono />
                <InfoRow icon={IndianRupee} label="Total amount" value={inr(data.order.totalAmountPaise)} />
                <InfoRow icon={CreditCard} label="Paid at" value={formatDateTime(data.order.paidAt)} />
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-brand-border bg-brand-soft p-2.5 text-xs text-brand">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    The txnId + UTR are shown for reconciliation. The shop&rsquo;s{' '}
                    <strong>saltKey / merchantKey</strong> credentials are NOT exposed — only the
                    shop owner controls them.
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Status history timeline */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Status history</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Order lifecycle events
                </CardDescription>
              </CardHeader>
              <CardContent>
                {timeline.length === 0 ? (
                  <EmptyState
                    icon={<History className="size-6" aria-hidden="true" />}
                    title="No events yet"
                    description="Lifecycle events will appear here as the order progresses."
                  />
                ) : (
                  <ol className="relative space-y-3 border-l border-border pl-4">
                    {timeline.map((ev, i) => {
                      const Icon = ev.icon;
                      return (
                        <li key={i} className="relative">
                          <span
                            className={`absolute -left-[1.40rem] flex size-3 items-center justify-center rounded-full bg-surface ring-2 ring-border`}
                          >
                            <Icon
                              className={`size-3 ${ev.tone}`}
                              aria-hidden="true"
                            />
                          </span>
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {formatDateTime(ev.at)}
                          </div>
                          <div className="mt-0.5 text-sm">{ev.label}</div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          {/* File metadata */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <CardTitle className="text-base font-semibold">
                    Files ({data.files.length})
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    Per-file metadata + pricing
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.files.length === 0 ? (
                <EmptyState
                  icon={<FileText className="size-6" aria-hidden="true" />}
                  title="No files uploaded"
                  description="Files will appear here once the customer uploads them."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Filename</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Pages</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Copies</TableHead>
                        <TableHead className="hidden md:table-cell">Color</TableHead>
                        <TableHead className="hidden md:table-cell">Paper</TableHead>
                        <TableHead className="hidden lg:table-cell">Duplex</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Size</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.files.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {f.originalFilename}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {f.mimeType}
                            </div>
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">
                            {f.pageCount}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">
                            {f.copies}
                          </TableCell>
                          <TableCell className="hidden text-xs md:table-cell">
                            {f.colorMode === 'color' ? 'Colour' : 'B&W'}
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs uppercase md:table-cell">
                            {f.paperSize}
                          </TableCell>
                          <TableCell className="hidden text-xs lg:table-cell">
                            {f.duplex ? 'Yes' : 'No'}
                          </TableCell>
                          <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">
                            {formatBytes(f.sizeBytes)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {inr(f.pricePaise)}
                          </TableCell>
                          <TableCell>
                            <FileStatusBadge status={f.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Print jobs */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Printer className="size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <CardTitle className="text-base font-semibold">
                    Print jobs ({data.printJobs.length})
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    Per-file dispatch + agent execution
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.printJobs.length === 0 ? (
                <EmptyState
                  icon={<Printer className="size-6" aria-hidden="true" />}
                  title="No print jobs dispatched"
                  description="Print jobs will appear here once files are queued for printing."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job ID</TableHead>
                        <TableHead className="hidden md:table-cell">File ID</TableHead>
                        <TableHead className="hidden lg:table-cell">Agent</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Attempts</TableHead>
                        <TableHead className="hidden lg:table-cell">Last error</TableHead>
                        <TableHead className="hidden md:table-cell">Queued</TableHead>
                        <TableHead className="hidden lg:table-cell">Started</TableHead>
                        <TableHead className="hidden lg:table-cell">Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.printJobs.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">
                            {j.fileId.slice(0, 8)}
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs lg:table-cell">
                            {j.agentId ? j.agentId.slice(0, 8) : '—'}
                          </TableCell>
                          <TableCell>
                            <JobStatusBadge status={j.status} />
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">
                            {j.attempts}
                          </TableCell>
                          <TableCell
                            className="hidden max-w-[200px] truncate text-xs text-danger lg:table-cell"
                            title={j.lastError ?? ''}
                          >
                            {j.lastError ?? '—'}
                          </TableCell>
                          <TableCell className="hidden text-xs tabular-nums md:table-cell">
                            {formatDateTime(j.queuedAt)}
                          </TableCell>
                          <TableCell className="hidden text-xs tabular-nums lg:table-cell">
                            {formatDateTime(j.startedAt)}
                          </TableCell>
                          <TableCell className="hidden text-xs tabular-nums lg:table-cell">
                            {formatDateTime(j.completedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Raw order metadata (debug aid) */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-base font-semibold">Raw order metadata</CardTitle>
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                For support / debugging — no sensitive fields
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
{JSON.stringify({
  id: data.order.id,
  shopId: data.order.shopId,
  customerToken: data.order.customerToken,
  status: data.order.status,
  totalAmountPaise: data.order.totalAmountPaise,
  currency: data.order.currency,
  paymentProvider: data.order.paymentProvider,
  paymentTxnId: data.order.paymentTxnId,
  paymentUtr: data.order.paymentUtr,
  paidAt: data.order.paidAt,
  customerPhone: data.order.customerPhone,
  notes: data.order.notes,
  createdAt: data.order.createdAt,
  updatedAt: data.order.updatedAt,
}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
