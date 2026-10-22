'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { StatusBadge } from '@/components/portal/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { formatINRFromPaise } from '@platform/utils';
import { ALLOWED_ORDER_TRANSITIONS, type OrderStatus } from '@platform/core/domain';
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Download,
  Printer as PrinterIcon,
  CheckCircle2,
  FileText,
  AlertTriangle,
  Clock,
  IndianRupee,
  CalendarClock,
  Settings2,
  ShoppingBag,
  Hash,
} from 'lucide-react';

interface PrintFile {
  id: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  copies: number;
  colorMode: 'bw' | 'color';
  pageRange: string | null;
  paperSize: 'a4' | 'a3' | 'letter' | 'legal';
  duplex: boolean;
  pricePaise: number;
  status: string;
  printedAt: string | null;
  createdAt: string;
}

interface OrderDetail {
  id: string;
  shopId: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  currency: string;
  paymentProvider: string | null;
  paymentTxnId: string | null;
  paymentUtr: string | null;
  paidAt: string | null;
  customerPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  files: PrintFile[];
}

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMime(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  return mime;
}

export default function ShopOrderDetailPage() {
  const params = useParams();
  const orderId = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const router = useRouter();
  const api = useApiClient();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [action, setAction] = useState<'print' | 'complete' | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true); else setLoading(true);
      setError(null);
      try {
        // We need both the order detail (incl. files) and the shop name for
        // the header — fire them in parallel.
        const [orderR, shopR] = await Promise.all([
          api.request<{ data?: OrderDetail; error?: { message?: string } }>(
            'GET',
            `/api/v1/shops/me/orders/${orderId}`,
          ),
          api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        ]);

        if (orderR.status === 404) {
          setNotFound(true);
          setOrder(null);
          return;
        }
        if (orderR.status === 403) {
          setNotFound(true);
          setOrder(null);
          return;
        }
        if (orderR.status === 401) {
          setError('Your session has expired. Please log in again.');
          return;
        }
        if (orderR.status !== 200 || !orderR.data?.data) {
          setError(
            orderR.data?.error?.message ?? `Could not load order (HTTP ${orderR.status}).`,
          );
          return;
        }
        setOrder(orderR.data.data);

        if (shopR.status === 200 && shopR.data?.data) {
          setShop(shopR.data.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        if (silent) setRefreshing(false); else setLoading(false);
      }
    },
    [api, orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll every 5s for status updates — print + payment transitions push the
  // order through the lifecycle while the shopkeeper is on this page.
  useEffect(() => {
    const id = setInterval(() => {
      void load(true);
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const allowedNext = useMemo<OrderStatus[]>(() => {
    if (!order) return [];
    return ALLOWED_ORDER_TRANSITIONS[order.status] ?? [];
  }, [order]);

  const canPrint = allowedNext.includes('printing');
  const canComplete = allowedNext.includes('collected');

  const triggerAction = async (kind: 'print' | 'complete') => {
    setAction(kind);
    setDownloadError(null);
    try {
      const path =
        kind === 'print'
          ? `/api/v1/shops/me/orders/${orderId}/print`
          : `/api/v1/shops/me/orders/${orderId}/complete`;
      const r = await api.request<{ error?: { message?: string } }>('POST', path);
      if (r.status >= 400) {
        setDownloadError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
      }
      await load(true);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setAction(null);
    }
  };

  const downloadFile = async (file: PrintFile) => {
    setDownloading(file.id);
    setDownloadError(null);
    try {
      const res = await fetch(
        `/api/v1/shops/me/orders/${orderId}/files/${file.id}/download`,
        { headers: { Authorization: `Bearer ${api.token ?? ''}` } },
      );
      if (res.status === 404) {
        setDownloadError(
          order?.status === 'collected' || order?.status === 'cancelled'
            ? `File deleted — orders in status '${order?.status}' no longer retain files.`
            : 'File not found in storage (it may have been auto-cleaned).',
        );
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setDownloadError(`Download failed (HTTP ${res.status}). ${text.slice(0, 100)}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.originalFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Give the browser a moment to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Network error during download');
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (notFound) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-amber-800">
            <AlertTriangle className="size-5" />
            Order not found
          </CardTitle>
          <CardDescription className="text-amber-700">
            This order may belong to another shop, or it has been deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/shop/orders">
              <ArrowLeft className="size-4" /> Back to orders
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error && !order) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn’t load this order</CardTitle>
          <CardDescription className="text-rose-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!order) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Back + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/shop/orders">
            <ArrowLeft className="size-4" /> Orders
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="gap-1.5"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Order header */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShoppingBag className="size-5 text-amber-600" />
                Order {order.customerToken}
              </CardTitle>
              <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
                <Hash className="size-3" />
                <span className="font-mono">{order.id}</span>
                {shop && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span>{shop.name}</span>
                  </>
                )}
              </CardDescription>
            </div>
            <StatusBadge status={order.status} />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Total"
            value={formatINRFromPaise(order.totalAmountPaise)}
            icon={<IndianRupee className="size-3.5" />}
          />
          <Metric
            label="Currency"
            value={order.currency}
            icon={<IndianRupee className="size-3.5" />}
          />
          <Metric
            label="Created"
            value={new Date(order.createdAt).toLocaleString()}
            icon={<CalendarClock className="size-3.5" />}
          />
          <Metric
            label="Paid"
            value={order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
            icon={<Clock className="size-3.5" />}
          />
          <Metric
            label="Provider"
            value={order.paymentProvider ?? '—'}
            icon={<IndianRupee className="size-3.5" />}
          />
        </CardContent>
      </Card>

      {/* Status actions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Status actions</CardTitle>
          <CardDescription className="text-xs">
            Move this order through its lifecycle. {allowedNext.length > 0
              ? `From “${order.status}” the order may move to: ${allowedNext.join(', ')}.`
              : `“${order.status}” is a terminal state — no further transitions are allowed.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canPrint && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90">
                  {action === 'print' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PrinterIcon className="size-4" />
                  )}
                  Send to print
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Send this order to print?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark the order as “printing” and dispatch each pending file to the
                    print agent. Files already marked completed will not be re-sent.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-amber-600 text-white hover:bg-amber-600/90"
                    onClick={(e) => {
                      e.preventDefault();
                      void triggerAction('print');
                    }}
                  >
                    Yes, send to print
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canComplete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-1.5">
                  {action === 'complete' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4 text-emerald-700" />
                  )}
                  Mark collected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark this order as collected?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Once collected, the customer’s documents will be permanently deleted from
                    storage for privacy. The metadata is retained in the audit log.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void triggerAction('complete');
                    }}
                  >
                    Yes, mark collected
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!canPrint && !canComplete && (
            <p className="text-sm text-muted-foreground">
              No manual status actions available — this order is in a terminal state.
            </p>
          )}
          {downloadError && (
            <p className="self-center text-xs text-rose-700">⚠ {downloadError}</p>
          )}
        </CardContent>
      </Card>

      {/* Files table */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription className="text-xs">
            {order.files.length} file(s) in this order. Download each print-ready file or send the
            whole order to the agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {order.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No files attached</p>
              <p className="text-xs text-muted-foreground">
                The customer hasn’t uploaded any documents yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Filename</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Copies</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>Paper</TableHead>
                  <TableHead>Duplex</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.files.map((f) => {
                  const isCollected = order.status === 'collected' || order.status === 'cancelled';
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="pl-4">
                        <div className="flex flex-col">
                          <span className="font-medium">{f.originalFilename}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatMime(f.mimeType)} · {formatBytes(f.sizeBytes)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {f.pageCount ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{f.copies}</TableCell>
                      <TableCell className="text-sm">
                        <Badge
                          variant="outline"
                          className={
                            f.colorMode === 'color'
                              ? 'border-sky-200 bg-sky-50 text-sky-700'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                          }
                        >
                          {f.colorMode === 'color' ? 'Colour' : 'B&W'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm uppercase">{f.paperSize}</TableCell>
                      <TableCell className="text-sm">
                        {f.duplex ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            duplex
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">simplex</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatINRFromPaise(f.pricePaise)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void downloadFile(f)}
                          disabled={downloading === f.id || isCollected}
                          className="gap-1.5"
                        >
                          {downloading === f.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Print instructions panel */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4 text-amber-600" />
            Print instructions
          </CardTitle>
          <CardDescription className="text-xs">
            A summary of every print setting on this order, ready to feed to the printer or hand to
            the operator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {order.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files in this order.</p>
          ) : (
            order.files.map((f) => (
              <div
                key={f.id}
                className="rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{f.originalFilename}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.pageCount ?? 'Unknown'} pages · {f.copies} cop
                    {f.copies === 1 ? 'y' : 'ies'}
                  </span>
                </div>
                <Separator className="my-2" />
                <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <Instruction label="Colour mode" value={f.colorMode === 'color' ? 'Colour' : 'B&W'} />
                  <Instruction label="Paper" value={f.paperSize.toUpperCase()} />
                  <Instruction label="Duplex" value={f.duplex ? 'Yes (both sides)' : 'No (single side)'} />
                  <Instruction label="Page range" value={f.pageRange ?? 'All'} />
                  <Instruction label="MIME" value={formatMime(f.mimeType)} />
                  <Instruction label="Status" value={f.status.replace(/_/g, ' ')} />
                </div>
              </div>
            ))
          )}
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="text-emerald-800">Total order value</span>
            <span className="font-mono font-semibold text-emerald-900">
              {formatINRFromPaise(order.totalAmountPaise)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Audit + payment metadata */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Payment &amp; audit metadata</CardTitle>
          <CardDescription className="text-xs">
            For reconciliation against UTR/txn IDs — visible to the shopkeeper only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Instruction label="Payment provider" value={order.paymentProvider ?? '—'} />
          <Instruction label="Transaction ID" value={order.paymentTxnId ?? '—'} mono />
          <Instruction label="UTR" value={order.paymentUtr ?? '—'} mono />
          <Instruction label="Customer phone" value={order.customerPhone ?? '—'} mono />
          <Instruction label="Notes" value={order.notes ?? '—'} />
          <Instruction label="Last updated" value={new Date(order.updatedAt).toLocaleString()} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/shop/orders">
            <ArrowLeft className="size-4" /> Back to orders
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/shop/dashboard')}
        >
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card p-2.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

function Instruction({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`break-words text-sm ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
