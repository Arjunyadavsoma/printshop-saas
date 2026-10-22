'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShoppingBag,
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
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminOrderDetailResponse,
  type OrderStatus,
  type FileStatus,
  type PrintJobStatus,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

const STATUS_COLORS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  printing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  collected: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

const FILE_STATUS_COLORS: Record<FileStatus, string> = {
  pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  queued: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  printing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  needs_review: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

const JOB_STATUS_COLORS: Record<PrintJobStatus, string> = {
  queued: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  assigned: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  printing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  needs_review: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status]} border-transparent font-medium`}>
      {status.replace('_', ' ')}
    </Badge>
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
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-0.5 text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
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
    if (data.order.createdAt) timeline.push({ at: data.order.createdAt, label: 'Order created', icon: ShoppingBag, tone: 'text-zinc-600' });
    if (data.order.paidAt) timeline.push({ at: data.order.paidAt, label: 'Payment confirmed', icon: CreditCard, tone: 'text-emerald-600' });
    for (const f of data.files) {
      if (f.printedAt) timeline.push({ at: f.printedAt, label: `File printed: ${f.originalFilename}`, icon: FileText, tone: 'text-violet-600' });
    }
    for (const j of data.printJobs) {
      if (j.startedAt) timeline.push({ at: j.startedAt, label: `Print job started (#${j.id.slice(0, 8)})`, icon: Printer, tone: 'text-violet-600' });
      if (j.completedAt) timeline.push({ at: j.completedAt, label: `Print job completed (#${j.id.slice(0, 8)})`, icon: Printer, tone: 'text-emerald-600' });
    }
    if (data.order.status === 'collected') timeline.push({ at: data.order.updatedAt, label: 'Order collected', icon: ShieldCheck, tone: 'text-emerald-600' });
    if (data.order.status === 'cancelled') timeline.push({ at: data.order.updatedAt, label: 'Order cancelled', icon: AlertCircle, tone: 'text-red-600' });
    timeline.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return ta - tb;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/orders')} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-emerald-600" />
              {loading || !data ? (
                <Skeleton className="h-6 w-48" />
              ) : (
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Order <span className="font-mono">{data.order.id.slice(0, 8)}</span>
                </h2>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Admin order detail</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200">
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
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <StatusBadge status={data.order.status} />
                <span className="text-2xl font-bold tabular-nums">{inr(data.order.totalAmountPaise)}</span>
                <span className="text-sm text-muted-foreground">{data.order.currency}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Created {formatDateTime(data.order.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>Updated {formatDateTime(data.order.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Shop + customer info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Shop &amp; customer</CardTitle>
                <CardDescription>Order parties</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3">
                  <div className="text-xs font-medium text-muted-foreground">Shop</div>
                  <Link href={`/admin/shops/${data.order.shopId}`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    <Store className="h-3.5 w-3.5" />
                    {data.order.shopName} <span className="font-mono text-xs">/{data.order.shopSlug}</span>
                  </Link>
                </div>
                <Separator className="my-3" />
                <InfoRow icon={User} label="Customer token" value={data.order.customerToken} mono />
                <InfoRow icon={User} label="Customer phone" value={data.order.customerPhone ?? '—'} mono />
                <InfoRow icon={ShoppingBag} label="Notes" value={data.order.notes ?? '—'} />
              </CardContent>
            </Card>

            {/* Payment info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment</CardTitle>
                <CardDescription>
                  Transaction details for reconciliation. <strong>Credentials are never shown.</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InfoRow icon={CreditCard} label="Payment provider" value={data.order.paymentProvider} mono />
                <InfoRow icon={CreditCard} label="Transaction ID (txnId)" value={data.order.paymentTxnId ?? '—'} mono />
                <InfoRow icon={CreditCard} label="UTR (bank reference)" value={data.order.paymentUtr ?? '—'} mono />
                <InfoRow icon={IndianRupee} label="Total amount" value={inr(data.order.totalAmountPaise)} />
                <InfoRow icon={CreditCard} label="Paid at" value={formatDateTime(data.order.paidAt)} />
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>The txnId + UTR are shown for reconciliation. The shop's <strong>saltKey / merchantKey</strong> credentials are NOT exposed — only the shop owner controls them.</span>
                </div>
              </CardContent>
            </Card>

            {/* Status history timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status history</CardTitle>
                <CardDescription>Order lifecycle events</CardDescription>
              </CardHeader>
              <CardContent>
                {timeline.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No events yet.</p>
                ) : (
                  <ol className="relative space-y-3 border-l border-border pl-4">
                    {timeline.map((ev, i) => {
                      const Icon = ev.icon;
                      return (
                        <li key={i} className="relative">
                          <span className={`absolute -left-[1.40rem] flex h-3 w-3 items-center justify-center rounded-full bg-background ring-2 ring-border`}>
                            <Icon className={`h-3 w-3 ${ev.tone}`} />
                          </span>
                          <div className="text-xs text-muted-foreground">{formatDateTime(ev.at)}</div>
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
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Files ({data.files.length})</CardTitle>
                  <CardDescription>Per-file metadata + pricing</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.files.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No files uploaded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Filename</TableHead>
                        <TableHead className="text-right">Pages</TableHead>
                        <TableHead className="text-right">Copies</TableHead>
                        <TableHead>Color</TableHead>
                        <TableHead>Paper</TableHead>
                        <TableHead>Duplex</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.files.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>
                            <div className="font-medium">{f.originalFilename}</div>
                            <div className="font-mono text-xs text-muted-foreground">{f.mimeType}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{f.pageCount}</TableCell>
                          <TableCell className="text-right tabular-nums">{f.copies}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className={f.colorMode === 'color' ? 'border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300' : 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}>
                              {f.colorMode === 'color' ? 'Colour' : 'B&W'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs uppercase">{f.paperSize}</TableCell>
                          <TableCell>
                            {f.duplex ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">Yes</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">No</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{formatBytes(f.sizeBytes)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{inr(f.pricePaise)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${FILE_STATUS_COLORS[f.status]} border-transparent font-medium`}>
                              {f.status.replace('_', ' ')}
                            </Badge>
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
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Print jobs ({data.printJobs.length})</CardTitle>
                  <CardDescription>Per-file dispatch + agent execution</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.printJobs.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No print jobs dispatched yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job ID</TableHead>
                        <TableHead>File ID</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead>Last error</TableHead>
                        <TableHead>Queued</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.printJobs.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                          <TableCell className="font-mono text-xs">{j.fileId.slice(0, 8)}</TableCell>
                          <TableCell className="font-mono text-xs">{j.agentId ? j.agentId.slice(0, 8) : '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${JOB_STATUS_COLORS[j.status]} border-transparent font-medium`}>
                              {j.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{j.attempts}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-red-700 dark:text-red-300" title={j.lastError ?? ''}>
                            {j.lastError ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs">{formatDateTime(j.queuedAt)}</TableCell>
                          <TableCell className="text-xs">{formatDateTime(j.startedAt)}</TableCell>
                          <TableCell className="text-xs">{formatDateTime(j.completedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Raw order metadata (debug aid) */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Raw order metadata</CardTitle>
              </div>
              <CardDescription>For support / debugging — no sensitive fields</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
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
