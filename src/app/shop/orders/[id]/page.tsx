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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { formatINRFromPaise } from '@platform/utils';
import { ALLOWED_ORDER_TRANSITIONS, type OrderStatus } from '@platform/core/domain';
import {
  checkPrintLatchStatus,
  submitPrintLatchJob,
  getPrintLatchJobStatus,
  getPrintLatchPrinters,
  fetchPdfBytes,
  getPrefs,
  getNextAutoPrinter,
  type PrintLatchPrinter,
} from '@/lib/printlatch/client';
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Download,
  Printer as PrinterIcon,
  CheckCircle2,
  AlertCircle,
  FileText,
  AlertTriangle,
  Clock,
  IndianRupee,
  CalendarClock,
  Settings2,
  ShoppingBag,
  Hash,
  XCircle,
  PlayCircle,
  PackageCheck,
  Save,
  ShieldCheck,
  History,
  StickyNote,
  CreditCard,
  Phone,
} from 'lucide-react';
import { toast } from 'sonner';

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
  tokenNumber?: string | null;
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

interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
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
function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  } catch { return false; }
}

const ACTION_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  'order.create':               { label: 'Order created',        icon: ShoppingBag,   tone: 'text-zinc-700' },
  'order.payment.verify':       { label: 'Payment verified',     icon: ShieldCheck,   tone: 'text-emerald-700' },
  'order.payment.reject':       { label: 'Payment rejected',     icon: XCircle,       tone: 'text-rose-700' },
  'order.print':                { label: 'Sent to print',        icon: PrinterIcon,   tone: 'text-amber-700' },
  'order.start_print':          { label: 'Printing started',     icon: PlayCircle,    tone: 'text-amber-700' },
  'order.ready':                { label: 'Marked ready',         icon: PackageCheck,  tone: 'text-emerald-700' },
  'order.complete':             { label: 'Marked collected',     icon: CheckCircle2,  tone: 'text-emerald-700' },
  'order.cancel':               { label: 'Order cancelled',     icon: XCircle,       tone: 'text-rose-700' },
  'order.update_notes':         { label: 'Notes updated',        icon: StickyNote,    tone: 'text-zinc-700' },
};

function PaymentBadge({ status, paidAt }: { status: OrderStatus; paidAt: string | null }) {
  // Map order status → payment status:
  //   awaiting_payment = pending (gray)
  //   paid/printing/ready/collected = paid (green)
  //   cancelled = rejected (red)  — only if it was cancelled from awaiting_payment
  //   refunded = refunded (violet)
  let cls = 'bg-zinc-200 text-zinc-700 border-zinc-300';
  let label = 'Pending';
  if (status === 'awaiting_payment') {
    // If we have a transaction reference but no verification yet, amber.
    label = 'Pending payment';
  } else if (paidAt) {
    cls = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    label = 'Paid';
  }
  if (status === 'cancelled') {
    cls = 'bg-rose-100 text-rose-700 border-rose-200';
    label = 'Rejected';
  }
  if (status === 'refunded') {
    cls = 'bg-violet-100 text-violet-800 border-violet-200';
    label = 'Refunded';
  }
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${cls}`}>
      <span className="inline-block size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}

export default function ShopOrderDetailPage() {
  const params = useParams();
  const orderId = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const router = useRouter();
  const api = useApiClient();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Internal notes (server-tracked value + local draft).
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Payment verification panel.
  const [txnRef, setTxnRef] = useState('');
  const [verifyAction, setVerifyAction] = useState<'verify' | 'reject' | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Status action confirm dialog state.
  const [statusAction, setStatusAction] = useState<'start' | 'ready' | 'complete' | 'cancel' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  // File download state.
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // A11Y-001: keep the tab title in sync with the loaded order so screen-reader
  // users + browser-history/tab-switcher users see "Order <token> · PrintShop SaaS"
  // instead of the generic layout default. Re-runs when `order` changes (e.g. on
  // initial fetch + after any status-action refresh). Falls back to orderId if
  // the order has no tokenNumber yet (e.g. awaiting_payment before token mint).
  useEffect(() => {
    const label = order?.tokenNumber ?? orderId ?? 'Order';
    document.title = `Order ${label} · PrintShop SaaS`;
  }, [order, orderId]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [orderR, shopR, activityR] = await Promise.all([
        api.request<{ data?: OrderDetail; error?: { message?: string } }>(
          'GET',
          `/api/v1/shops/me/orders/${orderId}`,
        ),
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        api.request<{ data?: { entries?: ActivityEntry[] } }>(
          'GET',
          `/api/v1/shops/me/orders/${orderId}/activity`,
        ),
      ]);

      if (orderR.status === 404 || orderR.status === 403) {
        setNotFound(true);
        setOrder(null);
        return;
      }
      if (orderR.status === 401) {
        setError('Your session has expired. Please log in again.');
        return;
      }
      if (orderR.status !== 200 || !orderR.data?.data) {
        setError(orderR.data?.error?.message ?? `Could not load order (HTTP ${orderR.status}).`);
        return;
      }
      setOrder(orderR.data.data);
      setNotesDraft(orderR.data.data.notes ?? '');

      if (shopR.status === 200 && shopR.data?.data) setShop(shopR.data.data);
      if (activityR.status === 200 && activityR.data?.data?.entries) {
        // Server returns oldest-first; reverse for display newest-first.
        setActivity([...activityR.data.data.entries].reverse());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => { void load(); }, [load]);

  // Poll every 5s for status updates.
  useEffect(() => {
    const id = setInterval(() => { void load(true); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const allowedNext = useMemo<OrderStatus[]>(() => {
    if (!order) return [];
    return ALLOWED_ORDER_TRANSITIONS[order.status] ?? [];
  }, [order]);

  const canStart = allowedNext.includes('printing');
  const canReady = allowedNext.includes('ready');
  const canComplete = allowedNext.includes('collected');
  const canCancel = allowedNext.includes('cancelled');

  // ── Action handlers ──
  const runVerify = async (action: 'verify' | 'reject') => {
    setVerifyAction(action);
    setVerifyError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/verify-payment`,
        { body: { action, txnReference: txnRef.trim() || undefined } },
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Verification failed (HTTP ${r.status}).`;
        setVerifyError(msg);
        toast.error(
          action === 'verify' ? 'Could not verify payment' : 'Could not reject payment',
          { description: msg },
        );
        return;
      }
      // Clear feedback — the order detail page previously had no confirmation
      // that the verify click landed (the panel just disappears because the
      // status is no longer awaiting_payment). The toast confirms it.
      if (action === 'verify') {
        toast.success('✓ Payment verified', {
          description: 'Order marked as paid. The customer will see the update on their tracking page.',
        });
      } else {
        toast.success('Payment rejected', {
          description: 'Order marked as cancelled. The customer will see "rejected" on their tracking page.',
        });
      }
      setTxnRef('');
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setVerifyError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setVerifyAction(null);
    }
  };

  const runStatusAction = async (kind: 'start' | 'ready' | 'complete' | 'cancel') => {
    setStatusAction(kind);
    setStatusError(null);
    try {
      const path =
        kind === 'start'    ? `/api/v1/shops/me/orders/${orderId}/start` :
        kind === 'ready'     ? `/api/v1/shops/me/orders/${orderId}/ready` :
        kind === 'complete'  ? `/api/v1/shops/me/orders/${orderId}/complete` :
                              `/api/v1/shops/me/orders/${orderId}/cancel`;
      const body = kind === 'cancel' && cancelReason.trim()
        ? { reason: cancelReason.trim() }
        : undefined;
      const r = await api.request<{ error?: { message?: string } }>('POST', path, body ? { body } : undefined);
      if (r.status >= 400) {
        setStatusError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
        return;
      }
      setCancelReason('');
      await load(true);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setStatusAction(null);
    }
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    setNotesError(null);
    setNotesSaved(false);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'PATCH',
        `/api/v1/shops/me/orders/${orderId}`,
        { body: { notes: notesDraft } },
      );
      if (r.status >= 400) {
        setNotesError(r.data?.error?.message ?? `Save failed (HTTP ${r.status}).`);
        return;
      }
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
      await load(true);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setNotesSaving(false);
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
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Network error during download');
    } finally {
      setDownloading(null);
    }
  };

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48 sm:w-64" />
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
            <AlertTriangle className="size-5" /> Order not found
          </CardTitle>
          <CardDescription className="text-amber-700">
            This order may belong to another shop, or it has been deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild variant="outline" size="sm" className="min-h-[44px]">
            <Link href="/shop/orders"><ArrowLeft className="size-4" /> Back to orders</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error && !order) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn't load this order</CardTitle>
          <CardDescription className="text-rose-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()} variant="outline" size="sm" className="min-h-[44px] gap-1.5">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!order) return null;

  const displayToken = order.tokenNumber ?? order.customerToken;

  return (
    <div className="space-y-6">
      {/* Back + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-[44px] gap-1.5">
          <Link href="/shop/orders"><ArrowLeft className="size-4" /> Orders</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="min-h-[44px] gap-1.5"
        >
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {/* ── Token + status banner ── */}
      <Card className="border-border">
        <CardContent className="flex flex-col items-center justify-between gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
          <div className="flex flex-col items-center gap-1 text-center sm:items-start sm:text-left">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Token number</span>
            <span className="break-words font-mono text-3xl font-bold tracking-tight text-amber-700 sm:text-4xl lg:text-5xl">
              {displayToken}
            </span>
            <span className="break-all font-mono text-[10px] text-muted-foreground">id: {order.id}</span>
          </div>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            <StatusBadge status={order.status} />
            <PaymentBadge status={order.status} paidAt={order.paidAt} />
          </div>
        </CardContent>
      </Card>

      {/* ── Payment verification panel ── */}
      {order.status === 'awaiting_payment' && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <ShieldCheck className="size-5" /> Payment verification
            </CardTitle>
            <CardDescription className="text-amber-800">
              Check your UPI app for the customer's payment of <strong className="font-mono">{formatINRFromPaise(order.totalAmountPaise)}</strong>
              {order.customerPhone && <> from <span className="font-mono">{order.customerPhone}</span></>}.
              Verify once the money has landed in your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="txnRef">Transaction reference (UTR / UPI txn ID)</Label>
              <Input
                id="txnRef"
                value={txnRef}
                onChange={(e) => setTxnRef(e.target.value)}
                placeholder="e.g. 4012XXXXXXXX or UPI/123456789"
                disabled={verifyAction !== null}
                className="h-11 sm:h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Optional but recommended — recorded against the order for reconciliation.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                onClick={() => void runVerify('verify')}
                disabled={verifyAction !== null}
                className="w-full min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
              >
                {verifyAction === 'verify' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Verify payment
              </Button>
              <Button
                onClick={() => void runVerify('reject')}
                disabled={verifyAction !== null}
                variant="outline"
                className="w-full min-h-[44px] gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 sm:w-auto"
              >
                {verifyAction === 'reject' ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                Reject
              </Button>
            </div>
            {verifyError && <p className="text-sm text-rose-700">⚠ {verifyError}</p>}
          </CardContent>
        </Card>
      )}

      {/* ── Status action buttons ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status actions</CardTitle>
          <CardDescription className="text-xs">
            {allowedNext.length > 0
              ? `From "${order.status}" the order can move to: ${allowedNext.join(', ')}.`
              : `"${order.status}" is a terminal state — no further transitions.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {canStart && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="w-full min-h-[44px] gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90 sm:w-auto" disabled={statusAction !== null}>
                  {statusAction === 'start' ? <Loader2 className="size-4 animate-spin" /> : <PrinterIcon className="size-4" />}
                  Start printing
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start printing this order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Marks the order as "printing". Any pending files will be queued for the print agent. Already-printed files won't be re-sent.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="min-h-[44px] bg-amber-600 text-white hover:bg-amber-600/90"
                    onClick={(e) => { e.preventDefault(); void runStatusAction('start'); }}
                  >
                    Yes, start printing
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canReady && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full min-h-[44px] gap-1.5 sm:w-auto" disabled={statusAction !== null}>
                  {statusAction === 'ready' ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4 text-emerald-700" />}
                  Mark ready for pickup
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark this order as ready?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The customer will see "ready for pickup" on their tracking page. Don't mark ready until prints are actually finished.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="min-h-[44px]" onClick={(e) => { e.preventDefault(); void runStatusAction('ready'); }}>
                    Yes, mark ready
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canComplete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full min-h-[44px] gap-1.5 sm:w-auto" disabled={statusAction !== null}>
                  {statusAction === 'complete' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4 text-emerald-700" />}
                  Mark collected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark this order as collected?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Once collected, the customer's documents will be permanently deleted from storage for privacy. The metadata is retained in the audit log.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="min-h-[44px]" onClick={(e) => { e.preventDefault(); void runStatusAction('complete'); }}>
                    Yes, mark collected
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full min-h-[44px] gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 sm:w-auto" disabled={statusAction !== null}>
                  {statusAction === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                  Cancel order
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The order will be marked cancelled. This cannot be undone. If the customer has paid, please refund them via your UPI app first.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5 py-2">
                  <Label htmlFor="cancelReason">Reason (optional)</Label>
                  <Textarea
                    id="cancelReason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Customer changed their mind"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-[44px]" onClick={() => setCancelReason('')}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="min-h-[44px] bg-rose-600 text-white hover:bg-rose-600/90"
                    onClick={(e) => { e.preventDefault(); void runStatusAction('cancel'); }}
                  >
                    Yes, cancel order
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!canStart && !canReady && !canComplete && !canCancel && (
            <p className="text-sm text-muted-foreground">No manual status actions available — this order is in a terminal state.</p>
          )}
          {statusError && <p className="self-center text-xs text-rose-700">⚠ {statusError}</p>}
          {downloadError && <p className="self-center text-xs text-rose-700">⚠ {downloadError}</p>}
        </CardContent>
      </Card>

      {/* ── Quick metrics ── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Total" value={formatINRFromPaise(order.totalAmountPaise)} icon={<IndianRupee className="size-3.5" />} />
          <Metric label="Currency" value={order.currency} icon={<IndianRupee className="size-3.5" />} />
          <Metric label="Created" value={new Date(order.createdAt).toLocaleString()} icon={<CalendarClock className="size-3.5" />} />
          <Metric label="Paid" value={order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'} icon={<Clock className="size-3.5" />} />
          <Metric label="Provider" value={order.paymentProvider ?? '—'} icon={<CreditCard className="size-3.5" />} />
        </CardContent>
      </Card>

      {/* ── Print instructions + files table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4 text-amber-600" /> Documents &amp; print instructions
          </CardTitle>
          <CardDescription className="text-xs">
            {order.files.length} file(s) · download each print-ready file or send the whole order to the printer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {order.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No files attached</p>
              <p className="text-xs text-muted-foreground">The customer hasn't uploaded any documents yet.</p>
            </div>
          ) : (
            <>
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Filename</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Copies</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead>Paper</TableHead>
                    <TableHead>Duplex</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="pr-4 text-right">Download</TableHead>
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
                            <span className="text-[10px] text-muted-foreground">{formatMime(f.mimeType)} · {formatBytes(f.sizeBytes)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{f.pageCount ?? 'Unknown'}</TableCell>
                        <TableCell className="font-mono text-sm">{f.copies}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={f.colorMode === 'color'
                              ? 'border-sky-200 bg-sky-50 text-sky-700'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-700'}
                          >
                            {f.colorMode === 'color' ? 'Colour' : 'B&W'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm uppercase">{f.paperSize}</TableCell>
                        <TableCell className="text-sm">
                          {f.duplex
                            ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">duplex</Badge>
                            : <span className="text-muted-foreground">simplex</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatINRFromPaise(f.pricePaise)}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void downloadFile(f)}
                              disabled={downloading === f.id || isCollected}
                              className="gap-1.5"
                            >
                              {downloading === f.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                              Download
                            </Button>
                            <PrintLatchButton
                              file={f}
                              orderId={orderId}
                              api={api}
                              disabled={isCollected}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Detailed print instructions panel */}
              <div className="space-y-2">
                <Separator />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Print instructions</p>
                <div className="space-y-2">
                  {order.files.map((f) => (
                    <div key={f.id} className="rounded-md border border-border bg-card p-3 text-sm">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span className="font-medium">{f.originalFilename}</span>
                        <span className="text-xs text-muted-foreground">
                          {f.pageCount ?? 'Unknown'} pages · {f.copies} cop{f.copies === 1 ? 'y' : 'ies'}
                        </span>
                      </div>
                      <Separator className="my-2" />
                      <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        <Instruction label="Colour mode" value={f.colorMode === 'color' ? 'Colour' : 'B&W'} />
                        <Instruction label="Paper" value={f.paperSize.toUpperCase()} />
                        <Instruction label="Duplex" value={f.duplex ? 'Yes (both sides)' : 'No (single side)'} />
                        <Instruction label="Page range" value={f.pageRange ?? 'All'} />
                        <Instruction label="MIME" value={formatMime(f.mimeType)} />
                        <Instruction label="Status" value={f.status.replace(/_/g, ' ')} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="text-emerald-800">Total order value</span>
                  <span className="font-mono font-semibold text-emerald-900">{formatINRFromPaise(order.totalAmountPaise)}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Internal notes ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <StickyNote className="size-4 text-amber-600" /> Internal notes
          </CardTitle>
          <CardDescription className="text-xs">
            Private to you and your staff — never shown to the customer. Useful for "VIP customer, expedite" or "ask about binding".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="Type a note…"
            disabled={notesSaving}
            maxLength={1000}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveNotes()}
              disabled={notesSaving}
              size="sm"
              className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
            >
              {notesSaving ? <Loader2 className="size-4 animate-spin" /> : notesSaved ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}
              {notesSaving ? 'Saving…' : notesSaved ? 'Saved' : 'Save note'}
            </Button>
            {notesError && <span className="text-xs text-rose-700">⚠ {notesError}</span>}
          </div>
        </CardContent>
      </Card>

      {/* ── Activity timeline ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-amber-600" /> Activity timeline
          </CardTitle>
          <CardDescription className="text-xs">
            Every action on this order, oldest first. Derived from the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-4">
              {activity.map((e) => {
                const meta = ACTION_LABELS[e.action] ?? { label: e.action, icon: Hash, tone: 'text-zinc-700' };
                const Icon = meta.icon;
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.3rem] flex size-5 items-center justify-center rounded-full bg-card ring-2 ring-border">
                      <Icon className={`size-3 ${meta.tone}`} />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{meta.label}</span>
                        <span className="text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                      </div>
                      {Object.keys(e.metadata ?? {}).length > 0 && (
                        <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
                          {JSON.stringify(e.metadata)}
                        </code>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* ── Payment & audit metadata ── */}
      <Card>
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
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer phone</span>
            {order.customerPhone ? (
              <a href={`tel:${order.customerPhone}`} className="inline-flex items-center gap-1 text-sm font-mono text-amber-700 hover:underline">
                <Phone className="size-3" /> {order.customerPhone}
              </a>
            ) : <span className="text-sm">—</span>}
          </div>
          <Instruction label="Last updated" value={new Date(order.updatedAt).toLocaleString()} />
          <Instruction label="Shop" value={shop?.name ?? '—'} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild variant="outline" size="sm" className="min-h-[44px] gap-1.5">
          <Link href="/shop/orders"><ArrowLeft className="size-4" /> Back to orders</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => router.push('/shop/dashboard')} className="min-h-[44px]">
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
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

function Instruction({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`break-words text-sm ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PrintLatchButton — confirmation dialog with settings + printer selection.
// If the agent is not connected, shows a link to the Printer Setup page.

interface PrintLatchJobState {
  status: 'idle' | 'fetching-url' | 'fetching-pdf' | 'submitting' | 'polling' | 'completed' | 'failed' | 'unknown';
  agentJobId?: string;
  error?: string;
}

function PrintLatchButton({
  file,
  orderId,
  api,
  disabled,
}: {
  file: PrintFile;
  orderId: string;
  api: ReturnType<typeof useApiClient>;
  disabled: boolean;
}) {
  const [jobState, setJobState] = useState<PrintLatchJobState>({ status: 'idle' });
  const [agentConnected, setAgentConnected] = useState<boolean | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [printers, setPrinters] = useState<PrintLatchPrinter[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [printersLoading, setPrintersLoading] = useState(false);

  // P3: Auto-refresh with bounded backoff (2s→4s→8s→16s→30s) when agent is down.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const { state } = await checkPrintLatchStatus();
      if (cancelled) return;
      setAgentConnected(state === 'connected');
      if (state !== 'connected') {
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempt), 30000);
        setReconnectAttempt(prev => Math.min(prev + 1, 4));
        timer = setTimeout(check, delay);
      } else {
        setReconnectAttempt(0);
      }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [reconnectAttempt]);

  // Fetch available printers when the dialog opens.
  useEffect(() => {
    if (!dialogOpen || !agentConnected) return;
    setPrintersLoading(true);
    getPrintLatchPrinters()
      .then((ps) => {
        setPrinters(ps);
        // Auto-select the first real printer (not the capture device) if available.
        const firstReal = ps.find((p) => p.kind !== 'capture') ?? ps[0];
        if (firstReal) setSelectedPrinter(firstReal.id);
      })
      .catch(() => { /* non-fatal — can still try to print without a specific printer */ })
      .finally(() => setPrintersLoading(false));
  }, [dialogOpen, agentConnected]);

  const handlePrint = async () => {
    if (['fetching-url', 'fetching-pdf', 'submitting'].includes(jobState.status)) return;
    setJobState({ status: 'fetching-url' });
    try {
      const urlR = await api.request<{
        data?: { downloadUrl: string; filename: string; copies: number };
        error?: { message?: string };
      }>('GET', `/api/v1/shops/me/orders/${orderId}/files/${file.id}/print-url`);
      if (urlR.status !== 200 || !urlR.data?.data) throw new Error(urlR.data?.error?.message ?? 'Could not get print URL');
      const { downloadUrl, filename, copies } = urlR.data.data;

      setJobState({ status: 'fetching-pdf' });
      const pdfBytes = await fetchPdfBytes(downloadUrl);

      setJobState({ status: 'submitting' });
      // Check if auto-mode is enabled — if so, use the round-robin printer.
      // If manual mode, use the selected printer from the dialog dropdown.
      const prefs = getPrefs();
      const autoPrinter = prefs.mode === 'auto' ? getNextAutoPrinter() : undefined;
      const printerId = autoPrinter ?? (selectedPrinter || undefined);
      const job = await submitPrintLatchJob({
        pdf: pdfBytes, filename, mode: 'print',
        copies: Math.min(Math.max(1, copies), 10),
        printerId,
      });

      setJobState({ status: 'polling', agentJobId: job.id });
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await getPrintLatchJobStatus(job.id);
        if (status.status === 'completed') { setJobState({ status: 'completed', agentJobId: job.id }); return; }
        if (status.status === 'failed') { setJobState({ status: 'failed', agentJobId: job.id, error: status.error?.message ?? 'Print job failed' }); return; }
        if (status.status === 'unknown') { setJobState({ status: 'unknown', agentJobId: job.id, error: status.error?.message ?? 'Unknown — check printer queue' }); return; }
      }
      setJobState({ status: 'unknown', agentJobId: job.id, error: 'Timed out — check your printer queue' });
    } catch (err) {
      setJobState({ status: 'failed', error: err instanceof Error ? err.message : 'Print failed' });
    }
  };

  const isBusy = ['fetching-url', 'fetching-pdf', 'submitting', 'polling'].includes(jobState.status);
  const isTerminal = ['completed', 'failed', 'unknown'].includes(jobState.status);

  // If agent is not connected, show a link to the setup page.
  if (agentConnected === false) {
    return (
      <a href="/shop/printer" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:underline">
        <PrinterIcon className="size-3" />
        Set up printer
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <AlertDialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open && isTerminal) setJobState({ status: 'idle' });
      }}>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || isBusy || agentConnected !== true}
            className="gap-1.5"
          >
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <PrinterIcon className="size-3.5" />}
            {isBusy ? 'Printing…' : 'Print'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PrinterIcon className="size-5 text-amber-600" />
              Confirm Print
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">Review the document and print settings before sending to the printer.</AlertDialogDescription>
          </AlertDialogHeader>

          {isBusy || isTerminal ? (
            // ── Printing in progress / terminal state ──
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                {jobState.status === 'fetching-url' && <><Loader2 className="size-4 animate-spin text-amber-600" /> Preparing document…</>}
                {jobState.status === 'fetching-pdf' && <><Loader2 className="size-4 animate-spin text-amber-600" /> Fetching PDF…</>}
                {jobState.status === 'submitting' && <><Loader2 className="size-4 animate-spin text-amber-600" /> Sending to printer…</>}
                {jobState.status === 'polling' && <><Loader2 className="size-4 animate-spin text-amber-600" /> Waiting for print queue…</>}
                {jobState.status === 'completed' && <><CheckCircle2 className="size-4 text-emerald-600" /> <span className="text-emerald-700 font-medium">Printed successfully</span></>}
                {jobState.status === 'failed' && <><AlertCircle className="size-4 text-destructive" /> <span className="text-destructive">{jobState.error}</span></>}
                {jobState.status === 'unknown' && <><AlertCircle className="size-4 text-amber-600" /> <span className="text-amber-700">{jobState.error ?? 'Unknown status — check printer queue'}</span></>}
              </div>
              {jobState.agentJobId && (
                <p className="text-[10px] text-muted-foreground">Job ID: <code className="font-mono">{jobState.agentJobId.slice(0, 12)}</code></p>
              )}
            </div>
          ) : (
            // ── Pre-print confirmation with preflight warnings ──
            <div className="space-y-3 py-2">
              {/* Preflight warnings */}
              {file.sizeBytes > 10 * 1024 * 1024 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Large file ({(file.sizeBytes / 1024 / 1024).toFixed(1)} MB) — printing may take longer.</span>
                </div>
              )}
              {!file.pageCount && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Page count unknown — PrintLatch will print all pages. Verify before confirming.</span>
                </div>
              )}
              {file.mimeType !== 'application/pdf' && (
                <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-700">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Not a PDF ({file.mimeType}) — PrintLatch only accepts PDF files. Convert it first.</span>
                </div>
              )}

              {/* Document info */}
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Document</p>
                <p className="mt-0.5 text-sm font-medium text-foreground break-words">{file.originalFilename}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{file.pageCount ? `${file.pageCount} pages` : 'Pages: unknown'}</span>
                  <span>{(file.sizeBytes / 1024).toFixed(0)} KB</span>
                  <span>{file.copies} cop{file.copies > 1 ? 'ies' : 'y'}</span>
                </div>
              </div>

              {/* Print settings */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] text-muted-foreground">Color</p>
                  <p className="font-medium">{file.colorMode === 'bw' ? 'Black & White' : 'Color'}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] text-muted-foreground">Paper</p>
                  <p className="font-medium uppercase">{file.paperSize}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] text-muted-foreground">Sides</p>
                  <p className="font-medium">{file.duplex ? 'Double-sided' : 'Single-sided'}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-[10px] text-muted-foreground">Price</p>
                  <p className="font-medium">{formatINRFromPaise(file.pricePaise)}</p>
                </div>
              </div>
              {file.pageRange && (
                <p className="text-[11px] text-muted-foreground">Page range: <code className="font-mono">{file.pageRange}</code></p>
              )}

              {/* Printer selection */}
              <div>
                <Label className="text-xs">Printer</Label>
                {printersLoading ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Detecting printers…
                  </div>
                ) : printers.length > 0 ? (
                  <select
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                  >
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.kind === 'capture' ? ' (preview only)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-700">No printers detected — will use the default printer.</p>
                )}
              </div>

              {/* Settings note */}
              <p className="text-[10px] text-muted-foreground">
                Note: color, paper size, and duplex are handled by your Windows printer driver — PrintLatch sends the PDF as-is. The copies count is passed to PrintLatch.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            {!isBusy && !isTerminal && (
              <div className="flex justify-end gap-2">
                <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void handlePrint()}
                  className="min-h-[44px] gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                >
                  <PrinterIcon className="size-4" />
                  Confirm Print
                </AlertDialogAction>
              </div>
            )}
            {isBusy && (
              <p className="text-center text-xs text-muted-foreground">Please wait… do not close this dialog.</p>
            )}
            {isTerminal && (
              <div className="flex justify-end">
                <AlertDialogAction className="min-h-[44px]">Close</AlertDialogAction>
              </div>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compact status (shown after dialog closes) */}
      {jobState.status === 'completed' && <span className="text-[10px] text-emerald-600">✓ Printed</span>}
      {jobState.status === 'failed' && (
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-destructive">✗ {jobState.error}</span>
          <button onClick={() => setJobState({ status: 'idle' })} className="text-[10px] text-amber-700 hover:underline min-h-[44px] inline-flex items-center">Retry</button>
        </div>
      )}
      {jobState.status === 'unknown' && (
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-amber-700">⚠ {jobState.error}</span>
          <button onClick={() => setJobState({ status: 'idle' })} className="text-[10px] text-amber-700 hover:underline min-h-[44px] inline-flex items-center">Retry after checking queue</button>
        </div>
      )}
    </div>
  );
}
