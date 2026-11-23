'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { usePoll } from '@/lib/hooks/use-poll';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  InsetList,
  InsetRow,
  ChevronRow,
  ValueRow,
  StatusPill,
  Badge as ClearBadge,
  Chip,
  EmptyState as ClearEmptyState,
  ErrorState as ClearErrorState,
  Banner,
  PrimaryButton,
  TintedButton,
  DestructiveButton,
  TextButton,
  Sheet,
  Input as ClearInput,
  SkeletonBox,
  SkeletonCard,
} from '@/components/clear';
// AlertDialog + Textarea kept — used by the PrintLatchButton sub-component
// (a self-contained print-confirmation flow that would be too invasive to
// rewrite into a Clear Sheet in this pass) and the cancel-reason textarea.
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
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';

interface PrintFile {
  id: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  pageCountSource?: string;
  processingError?: string | null;
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
  const OFFICE: Record<string, string> = {
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/rtf': 'RTF',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
  };
  return OFFICE[mime] ?? mime;
}
function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  } catch { return false; }
}

const ACTION_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  'order.create':               { label: 'Order created',        icon: ShoppingBag,   tone: 'text-muted-foreground' },
  'order.payment.verify':       { label: 'Payment verified',     icon: ShieldCheck,   tone: 'text-success' },
  'order.payment.reject':       { label: 'Payment rejected',     icon: XCircle,       tone: 'text-danger' },
  'order.print':                { label: 'Sent to print',        icon: PrinterIcon,   tone: 'text-brand' },
  'order.start_print':          { label: 'Printing started',     icon: PlayCircle,    tone: 'text-brand' },
  'order.ready':                { label: 'Marked ready',         icon: PackageCheck,  tone: 'text-success' },
  'order.complete':             { label: 'Marked collected',     icon: CheckCircle2,  tone: 'text-success' },
  'order.cancel':               { label: 'Order cancelled',     icon: XCircle,       tone: 'text-danger' },
  'order.update_notes':         { label: 'Notes updated',        icon: StickyNote,    tone: 'text-muted-foreground' },
};

/**
 * Map an order's status + paidAt to the canonical payment-status string
 * consumed by the shared <PaymentBadge /> (see @/components/portal/payment-badge).
 *   awaiting_payment        → 'pending'
 *   cancelled               → 'failed'   (was 'rejected' inline; closest shared key)
 *   refunded                → 'refunded'
 *   paid/printing/...+paidAt → 'paid'
 */
function paymentStatusForOrder(status: OrderStatus, paidAt: string | null): string {
  if (status === 'awaiting_payment') return 'pending';
  if (status === 'cancelled') return 'failed';
  if (status === 'refunded') return 'refunded';
  if (paidAt) return 'paid';
  return 'pending';
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

  // Page-count review state — for placeholder / needs_review files. The
  // shopkeeper can set or correct the page count inline; the server marks
  // the source as `shopkeeper_confirmed` and prices the file.
  const [pageCountDrafts, setPageCountDrafts] = useState<Record<string, string>>({});
  const [settingPageCount, setSettingPageCount] = useState<string | null>(null);
  const [pageCountError, setPageCountError] = useState<string | null>(null);

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

  // Poll every 5s for status updates (P2-5: pauses while the tab is hidden).
  usePoll(() => { void load(true); }, 5000, { deps: [load], immediate: false });

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

  // Set or correct a file's page count (shopkeeper-only). The server marks
  // the source as `shopkeeper_confirmed` (highest trust), prices the file
  // using the shop's current config, and transitions it to `pending`. Used
  // to resolve placeholder files the auto-extractor couldn't read.
  const setPageCount = async (file: PrintFile) => {
    const draft = pageCountDrafts[file.id] ?? '';
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      setPageCountError('Enter a whole number between 1 and 10,000.');
      return;
    }
    setSettingPageCount(file.id);
    setPageCountError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/files/${file.id}/page-count`,
        { body: { pageCount: n } },
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Could not set page count (HTTP ${r.status}).`;
        setPageCountError(msg);
        toast.error('Could not set page count', { description: msg });
        return;
      }
      toast.success('Page count set', {
        description: `${file.originalFilename} priced and ready for checkout.`,
      });
      setPageCountDrafts((prev) => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setPageCountError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setSettingPageCount(null);
    }
  };


  // ── R10: print tasks per printer ──
  // Derive one task per (printer-kind × color-mode) bucket from the files.
  // Each task shows: "{Colour|B&W} set, N pages, {Colour|B&W} printer, {status}".
  // The "printer" name is derived from the file's colorMode (colour files →
  // Colour printer, B&W files → B&W printer) — this matches the typical
  // two-printer shop setup. The "status" comes from the file's processing
  // status (queued / printing / printed).
  type PrintTask = {
    key: string;
    label: string;
    pages: number;
    printer: string;
    status: 'pending' | 'printing' | 'ready' | 'collected' | 'error';
    statusLabel: string;
  };
  const printTasks: PrintTask[] = useMemo(() => {
    if (!order) return [];
    const tasks: PrintTask[] = [];
    const colourFiles = order.files.filter((f) => f.colorMode === 'color');
    const bwFiles = order.files.filter((f) => f.colorMode === 'bw');
    const makeTask = (
      files: typeof order.files,
      label: string,
      printer: string,
    ): PrintTask | null => {
      if (files.length === 0) return null;
      const pages = files.reduce((acc, f) => acc + (f.pageCount ?? 0), 0);
      // Aggregate status — if any file is printing, the task is printing;
      // otherwise if any is queued (pending), the task is pending; otherwise
      // (all printed) the task is ready.
      const anyPrinting = files.some((f) => f.status === 'printing' || f.status === 'processing');
      const anyPending = files.some((f) => f.status === 'pending' || f.status === 'queued' || f.status === 'needs_review');
      const allPrinted = files.every((f) => f.status === 'printed' || f.status === 'ready' || f.status === 'delivered');
      const status: PrintTask['status'] = anyPrinting
        ? 'printing'
        : allPrinted
          ? 'ready'
          : anyPending
            ? 'pending'
            : 'pending';
      const statusLabel = anyPrinting
        ? 'Printing'
        : allPrinted
          ? 'Printed'
          : 'Queued';
      return {
        key: `${label}-${printer}`,
        label: `${label} set, ${pages} pages`,
        pages,
        printer,
        status,
        statusLabel,
      };
    };
    const colour = makeTask(colourFiles, 'Colour', 'Colour printer');
    const bw = makeTask(bwFiles, 'B&W', 'B&W printer');
    if (colour) tasks.push(colour);
    if (bw) tasks.push(bw);
    return tasks;
  }, [order]);

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <SkeletonBox className="h-9 w-40" />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <ClearEmptyState
          icon={<AlertTriangle className="size-6" aria-hidden="true" />}
          title="Order not found"
          description="This order may belong to another shop, or it has been deleted."
          action={{ label: 'Back to orders', onClick: () => router.push('/shop/orders') }}
        />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <ClearErrorState
          message={error}
          fix="Check your connection and try again. If the problem persists, your session may have expired."
          referenceCode="ORDER_DETAIL_LOAD"
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (!order) return null;

  const displayToken = order.tokenNumber ?? order.customerToken;
  const reviewFiles = order.files.filter(
    (f) => f.status === 'needs_review' || f.pageCountSource === 'placeholder',
  );

  // ── R10: customer name + phone subtitle ──
  // The order row doesn't carry a customer name (only phone) — we synthesize
  // "Walk-in customer" when no phone is present, otherwise show the phone.
  const customerSubtitle = order.customerPhone
    ? `${order.customerPhone}`
    : 'Walk-in customer';

  const sp = statusPillForOrder(order.status);

  // R10: payment "To confirm" chip — only when awaiting_payment.
  const paymentChipLabel =
    order.status === 'awaiting_payment'
      ? 'To confirm'
      : order.status === 'cancelled'
        ? 'Rejected'
        : order.status === 'refunded'
          ? 'Refunded'
          : order.paidAt
            ? 'Confirmed'
            : 'To confirm';
  const paymentChipStatus: 'pending' | 'ready' | 'error' =
    order.status === 'cancelled' || order.status === 'refunded'
      ? 'error'
      : order.status === 'awaiting_payment' || !order.paidAt
        ? 'pending'
        : 'ready';

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 pb-32 pt-6 sm:px-6 lg:max-w-[920px] lg:space-y-6 lg:pb-10 lg:pt-8">
      {/* ── Title + customer subtitle + refresh ── */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href="/shop/orders"
            className="mb-1 inline-flex items-center gap-1 text-sm text-[var(--label-2)] hover:text-[var(--label)]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Orders
          </Link>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)]">
            Order {displayToken}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--label-2)]">{customerSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh order"
          className="inline-flex size-12 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-5" aria-hidden="true" />
          )}
        </button>
      </header>

      {/* ── Files awaiting review (page count needed) ── */}
      {reviewFiles.length > 0 && (
        <Group padding="content" className="bg-[var(--warning-tint)]">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-[var(--warning-text)]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--warning-text)]">
                  {reviewFiles.length} file{reviewFiles.length === 1 ? '' : 's'} need a page count
                </h2>
                <p className="mt-1 text-sm text-[var(--warning-text)]/80">
                  These couldn&apos;t be auto-priced. Set the page count to price and check out the order.
                </p>
              </div>
              {reviewFiles.map((f) => (
                <div
                  key={f.id}
                  className="rounded-[var(--radius-card)] bg-[var(--surface)] p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--label)]">
                          {f.originalFilename}
                        </p>
                        <p className="text-xs tabular-nums text-[var(--label-2)]">
                          {formatMime(f.mimeType)} · {formatBytes(f.sizeBytes)}
                          {f.processingError ? ` · ${f.processingError}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        inputMode="numeric"
                        value={pageCountDrafts[f.id] ?? ''}
                        onChange={(e) => {
                          setPageCountDrafts((prev) => ({ ...prev, [f.id]: e.target.value }));
                          setPageCountError(null);
                        }}
                        placeholder="Pages"
                        disabled={settingPageCount === f.id}
                        aria-label={`Page count for ${f.originalFilename}`}
                        className="min-h-[44px] w-24 rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] px-3 py-2 text-sm tabular-nums text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none"
                      />
                      <PrimaryButton
                        size="compact"
                        onClick={() => void setPageCount(f)}
                        disabled={settingPageCount === f.id || !pageCountDrafts[f.id]}
                        loading={settingPageCount === f.id}
                      >
                        Set
                      </PrimaryButton>
                    </div>
                  </div>
                </div>
              ))}
              {pageCountError && (
                <p className="text-xs text-[var(--danger-text)]" role="alert">
                  {pageCountError}
                </p>
              )}
            </div>
          </div>
        </Group>
      )}

      {/* ── R10: Payment group ── */}
      <Group padding="rows" title="Payment">
        <InsetList>
          <InsetRow
            label="UTR"
            subtitle={order.paymentUtr ?? 'Not yet provided'}
            trailing={
              <StatusPill status={paymentChipStatus} label={paymentChipLabel} />
            }
          />
          <ValueRow
            label="Amount"
            value={formatINRFromPaise(order.totalAmountPaise)}
          />
          <InsetRow
            label="Screenshot"
            subtitle={
              order.paymentProvider
                ? `${order.paymentProvider}${order.paymentTxnId ? ` · ${order.paymentTxnId.slice(0, 12)}` : ''}`
                : 'No payment proof attached'
            }
            trailing={
              order.paymentProvider ? (
                <Link
                  href={`/shop/orders/${order.id}#payment-proof`}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-tint)] px-3 text-xs font-semibold text-[var(--accent-tint-text)]"
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  View
                </Link>
              ) : (
                <span className="text-xs text-[var(--label-3)]">—</span>
              )
            }
          />
        </InsetList>
      </Group>

      {/* ── R10: File row + PageMapMini ── */}
      {order.files.length > 0 && (
        <Group padding="rows" title="Documents">
          <InsetList>
            {order.files.map((f) => {
              const isReview = f.status === 'needs_review' || f.pageCountSource === 'placeholder';
              return (
                <li
                  key={f.id}
                  className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-[var(--hairline)]"
                >
                  <div className="flex flex-col gap-3 px-4 py-3">
                    {/* File row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="size-4 shrink-0 text-[var(--label-2)]" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--label)]">
                            {f.originalFilename}
                          </p>
                          <p className="text-xs tabular-nums text-[var(--label-2)]">
                            {formatMime(f.mimeType)} · {formatBytes(f.sizeBytes)} · {f.copies} cop{f.copies === 1 ? 'y' : 'ies'}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                          {isReview ? 'Pending' : formatINRFromPaise(f.pricePaise)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void downloadFile(f)}
                          disabled={downloading === f.id || order.status === 'collected' || order.status === 'cancelled'}
                          aria-label={`Download ${f.originalFilename}`}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-2.5 text-xs font-semibold text-[var(--label)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
                        >
                          {downloading === f.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="size-3.5" aria-hidden="true" />
                          )}
                        </button>
                        <PrintLatchButton
                          file={f}
                          orderId={orderId}
                          api={api}
                          disabled={order.status === 'collected' || order.status === 'cancelled' || isReview}
                        />
                      </div>
                    </div>

                    {/* PageMapMini — tiny page tiles, colour ones tinted */}
                    {!isReview && f.pageCount && f.pageCount > 0 && (
                      <PageMapMini
                        pageCount={f.pageCount}
                        colorMode={f.colorMode}
                        pageRange={f.pageRange}
                      />
                    )}

                    {/* Inline print instructions */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
                      <Instruction label="Colour" value={f.colorMode === 'color' ? 'Colour' : 'B&W'} />
                      <Instruction label="Paper" value={f.paperSize.toUpperCase()} />
                      <Instruction label="Sides" value={f.duplex ? 'Double' : 'Single'} />
                      <Instruction label="Range" value={f.pageRange ?? 'All'} />
                    </div>
                    {isReview && f.processingError && (
                      <p className="text-xs text-[var(--warning-text)]">
                        {f.processingError}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </InsetList>
        </Group>
      )}

      {/* ── R10: Print tasks per printer ── */}
      {printTasks.length > 0 && (
        <Group padding="rows" title="Print tasks">
          <InsetList>
            {printTasks.map((t) => (
              <InsetRow
                key={t.key}
                label={t.label}
                subtitle={t.printer}
                trailing={<StatusPill status={t.status} label={t.statusLabel} />}
              />
            ))}
          </InsetList>
        </Group>
      )}

      {/* ── Internal notes ── */}
      <Group padding="content" title="Internal notes">
        <div className="space-y-3">
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="Type a note… (private to you and your staff)"
            disabled={notesSaving}
            maxLength={1000}
            className="min-h-[80px] w-full rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] px-3 py-2.5 text-sm text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <PrimaryButton
              size="compact"
              onClick={() => void saveNotes()}
              disabled={notesSaving}
              loading={notesSaving}
              leadingIcon={notesSaved ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            >
              {notesSaving ? 'Saving…' : notesSaved ? 'Saved' : 'Save note'}
            </PrimaryButton>
            {notesError && (
              <span className="text-xs text-[var(--danger-text)]" role="alert">
                {notesError}
              </span>
            )}
          </div>
        </div>
      </Group>

      {/* ── Activity timeline ── */}
      {activity.length > 0 && (
        <Group padding="content" title="Activity timeline">
          <ol className="relative space-y-3 border-l border-[var(--hairline)] pl-4">
            {activity.map((e) => {
              const meta = ACTION_LABELS[e.action] ?? { label: e.action, icon: Hash, tone: 'text-muted-foreground' };
              const Icon = meta.icon;
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.3rem] flex size-5 items-center justify-center rounded-full bg-[var(--surface)] ring-2 ring-[var(--hairline)]">
                    <Icon className={`size-3 ${meta.tone}`} aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[var(--label)]">{meta.label}</span>
                      <span className="text-xs text-[var(--label-2)]">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {Object.keys(e.metadata ?? {}).length > 0 && (
                      <code className="block break-all rounded bg-[var(--fill)] px-2 py-1 font-mono text-xs text-[var(--label-2)]">
                        {JSON.stringify(e.metadata)}
                      </code>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Group>
      )}

      {/* ── Status actions (non-payment) ── */}
      {(canStart || canReady || canComplete || canCancel) && (
        <Group padding="rows" title="Status actions">
          <InsetList>
            {canStart && (
              <InsetRow
                label="Start printing"
                subtitle="Queue the order's files for the print agent"
                trailing={
                  <button
                    type="button"
                    onClick={() => void runStatusAction('start')}
                    disabled={statusAction !== null}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
                  >
                    {statusAction === 'start' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PrinterIcon className="size-3.5" aria-hidden="true" />}
                    Start
                  </button>
                }
              />
            )}
            {canReady && (
              <InsetRow
                label="Mark ready"
                subtitle="Customer will see ready-for-pickup"
                trailing={
                  <button
                    type="button"
                    onClick={() => void runStatusAction('ready')}
                    disabled={statusAction !== null}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--success-tint)] px-3 text-xs font-semibold text-[var(--success-text)] transition-colors hover:brightness-95 disabled:opacity-50"
                  >
                    {statusAction === 'ready' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}
                    Ready
                  </button>
                }
              />
            )}
            {canComplete && (
              <InsetRow
                label="Mark collected"
                subtitle="Customer has picked up the prints"
                trailing={
                  <button
                    type="button"
                    onClick={() => void runStatusAction('complete')}
                    disabled={statusAction !== null}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--success-tint)] px-3 text-xs font-semibold text-[var(--success-text)] transition-colors hover:brightness-95 disabled:opacity-50"
                  >
                    {statusAction === 'complete' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
                    Collected
                  </button>
                }
              />
            )}
            {canCancel && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={statusAction !== null}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
                  >
                    {statusAction === 'cancel' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
                    Cancel order
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The order will be marked cancelled. This cannot be undone. If the customer has paid, please refund them via your UPI app first.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-1.5 py-2">
                    <Textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={2}
                      placeholder="Reason (optional)"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="min-h-[44px]" onClick={() => setCancelReason('')}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="min-h-[44px] bg-[var(--danger)] text-[var(--on-accent)] hover:bg-[var(--danger)]/90"
                      onClick={(e) => { e.preventDefault(); void runStatusAction('cancel'); }}
                    >
                      Yes, cancel order
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </InsetList>
          {statusError && (
            <p className="px-4 pt-2 text-xs text-[var(--danger-text)]" role="alert">
              {statusError}
            </p>
          )}
          {downloadError && (
            <p className="px-4 pt-1 text-xs text-[var(--danger-text)]" role="alert">
              {downloadError}
            </p>
          )}
        </Group>
      )}

      {/* ── Payment & audit metadata ── */}
      <Group padding="rows" title="Payment & audit metadata">
        <InsetList>
          <ValueRow label="Payment provider" value={order.paymentProvider ?? '—'} />
          <ValueRow label="Transaction ID" value={order.paymentTxnId ?? '—'} />
          <ValueRow label="UTR" value={order.paymentUtr ?? '—'} />
          <InsetRow
            label="Customer phone"
            subtitle={order.customerPhone ?? '—'}
            trailing={
              order.customerPhone ? (
                <a
                  href={`tel:${order.customerPhone}`}
                  className="inline-flex items-center gap-1 text-sm font-mono text-[var(--accent)] hover:underline"
                >
                  <Phone className="size-3" aria-hidden="true" />
                  Call
                </a>
              ) : (
                <span className="text-xs text-[var(--label-3)]">—</span>
              )
            }
          />
          <ValueRow label="Last updated" value={new Date(order.updatedAt).toLocaleString()} />
          <ValueRow label="Shop" value={shop?.name ?? '—'} />
        </InsetList>
      </Group>

      {/* ── R10: Bottom bar — Reject (destructive outlined) + Confirm payment (primary) ──
          Only rendered when the order is awaiting payment verification — the
          bottom bar is the contextual primary action for THIS screen state.
          For other states, the bottom bar collapses (status actions live in
          the Status actions group above). */}
      {order.status === 'awaiting_payment' && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-[rgba(255,255,255,0.86)] backdrop-blur-lg safe-bottom lg:hidden">
          <div className="mx-auto flex max-w-[640px] gap-2 p-3">
            <DestructiveButton
              size="default"
              onClick={() => void runVerify('reject')}
              disabled={verifyAction !== null}
              loading={verifyAction === 'reject'}
              className="flex-1"
            >
              <XCircle className="size-4" aria-hidden="true" />
              Reject
            </DestructiveButton>
            <PrimaryButton
              size="default"
              onClick={() => void runVerify('verify')}
              disabled={verifyAction !== null}
              loading={verifyAction === 'verify'}
              className="flex-1"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Confirm payment
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Desktop: same two actions as inline buttons (no fixed bar) */}
      {order.status === 'awaiting_payment' && (
        <div className="hidden lg:flex lg:gap-2">
          <DestructiveButton
            onClick={() => void runVerify('reject')}
            disabled={verifyAction !== null}
            loading={verifyAction === 'reject'}
          >
            <XCircle className="size-4" aria-hidden="true" />
            Reject payment
          </DestructiveButton>
          <PrimaryButton
            onClick={() => void runVerify('verify')}
            disabled={verifyAction !== null}
            loading={verifyAction === 'verify'}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Confirm payment
          </PrimaryButton>
        </div>
      )}

      {verifyError && (
        <p className="text-xs text-[var(--danger-text)]" role="alert">
          {verifyError}
        </p>
      )}
    </div>
  );
}

// ── Local helper components ──────────────────────────────────────────────

/** Maps an OrderStatus to a Clear StatusPill lifecycle state. */
function statusPillForOrder(status: OrderStatus): { s: 'pending' | 'printing' | 'ready' | 'collected' | 'error'; label: string } {
  switch (status) {
    case 'awaiting_payment': return { s: 'pending', label: 'Awaiting payment' };
    case 'paid': return { s: 'pending', label: 'Paid' };
    case 'printing': return { s: 'printing', label: 'Printing' };
    case 'ready': return { s: 'ready', label: 'Ready' };
    case 'collected': return { s: 'collected', label: 'Collected' };
    case 'cancelled': return { s: 'error', label: 'Cancelled' };
    case 'refunded': return { s: 'error', label: 'Refunded' };
    default: return { s: 'pending', label: String(status) };
  }
}

/** PageMapMini — tiny page tiles for the order detail file row.
 *  Renders a 1-row strip of small (16x20) page tiles. Colour-mode files
 *  paint the tiles with the colour gradient; B&W files paint them with
 *  the B&W dot pattern. When a page range narrows the printed subset,
 *  out-of-range tiles are dimmed. */
function PageMapMini({
  pageCount,
  colorMode,
  pageRange,
}: {
  pageCount: number;
  colorMode: 'bw' | 'color';
  pageRange: string | null;
}) {
  // Parse the page range into a Set of selected page numbers (1-based).
  // Supports "1-3,5,7-9" syntax. When null/empty, all pages are selected.
  const selectedSet = useMemo(() => {
    if (!pageRange) return null;
    const set = new Set<number>();
    for (const part of pageRange.split(',')) {
      const trimmed = part.trim();
      const dash = trimmed.indexOf('-');
      if (dash >= 0) {
        const start = parseInt(trimmed.slice(0, dash), 10);
        const end = parseInt(trimmed.slice(dash + 1), 10);
        if (!Number.isNaN(start) && !Number.isNaN(end)) {
          for (let i = start; i <= end; i++) set.add(i);
        }
      } else {
        const n = parseInt(trimmed, 10);
        if (!Number.isNaN(n)) set.add(n);
      }
    }
    return set;
  }, [pageRange]);

  // Cap the mini map at 30 visible tiles — beyond that, the strip gets too
  // wide to glance. We show "…N more" if there are more.
  const visible = Math.min(pageCount, 30);
  const isColour = colorMode === 'color';

  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={`${pageCount} pages, ${isColour ? 'colour' : 'black and white'}`}>
      {Array.from({ length: visible }, (_, i) => {
        const pageNumber = i + 1;
        const inRange = selectedSet === null || selectedSet.has(pageNumber);
        return (
          <span
            key={pageNumber}
            className={[
              'inline-block size-4 rounded-[3px]',
              inRange ? '' : 'opacity-30',
            ].join(' ')}
            style={{
              backgroundColor: isColour ? undefined : 'var(--fill)',
              backgroundImage: isColour ? 'var(--pg-colour-bg)' : undefined,
              boxShadow: isColour ? 'none' : 'inset 0 0 0 1px var(--label-3)',
            }}
            aria-hidden="true"
          />
        );
      })}
      {pageCount > visible && (
        <span className="text-xs text-[var(--label-3)]">
          +{pageCount - visible}
        </span>
      )}
    </div>
  );
}

function Instruction({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--label-3)]">{label}</span>
      <span className={`text-sm text-[var(--label)] ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </span>
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
      <a href="/shop/devices" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
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
              <PrinterIcon className="size-5 text-brand" />
              Confirm Print
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">Review the document and print settings before sending to the printer.</AlertDialogDescription>
          </AlertDialogHeader>

          {isBusy || isTerminal ? (
            // ── Printing in progress / terminal state ──
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                {jobState.status === 'fetching-url' && <><Loader2 className="size-4 animate-spin text-brand" /> Preparing document…</>}
                {jobState.status === 'fetching-pdf' && <><Loader2 className="size-4 animate-spin text-brand" /> Fetching PDF…</>}
                {jobState.status === 'submitting' && <><Loader2 className="size-4 animate-spin text-brand" /> Sending to printer…</>}
                {jobState.status === 'polling' && <><Loader2 className="size-4 animate-spin text-brand" /> Waiting for print queue…</>}
                {jobState.status === 'completed' && <><CheckCircle2 className="size-4 text-success" /> <span className="text-success font-medium">Printed successfully</span></>}
                {jobState.status === 'failed' && <><AlertCircle className="size-4 text-danger" /> <span className="text-danger">{jobState.error}</span></>}
                {jobState.status === 'unknown' && <><AlertCircle className="size-4 text-brand" /> <span className="text-brand">{jobState.error ?? 'Unknown status — check printer queue'}</span></>}
              </div>
              {jobState.agentJobId && (
                <p className="text-xs text-muted-foreground">Job ID: <code className="font-mono">{jobState.agentJobId.slice(0, 12)}</code></p>
              )}
            </div>
          ) : (
            // ── Pre-print confirmation with preflight warnings ──
            <div className="space-y-3 py-2">
              {/* Preflight warnings */}
              {file.sizeBytes > 10 * 1024 * 1024 && (
                <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand-soft p-2 text-xs text-brand">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Large file ({(file.sizeBytes / 1024 / 1024).toFixed(1)} MB) — printing may take longer.</span>
                </div>
              )}
              {!file.pageCount && (
                <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand-soft p-2 text-xs text-brand">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Page count unknown — PrintLatch will print all pages. Verify before confirming.</span>
                </div>
              )}
              {file.mimeType !== 'application/pdf' && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Not a PDF ({file.mimeType}) — PrintLatch only accepts PDF files. Convert it first.</span>
                </div>
              )}

              {/* Document info */}
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Document</p>
                <p className="mt-0.5 text-sm font-medium text-foreground break-words">{file.originalFilename}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{file.pageCount ? `${file.pageCount} pages` : 'Pages: unknown'}</span>
                  <span>{(file.sizeBytes / 1024).toFixed(0)} KB</span>
                  <span>{file.copies} cop{file.copies > 1 ? 'ies' : 'y'}</span>
                </div>
              </div>

              {/* Print settings */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border p-2">
                  <p className="text-xs text-muted-foreground">Color</p>
                  <p className="font-medium">{file.colorMode === 'bw' ? 'Black & White' : 'Color'}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-xs text-muted-foreground">Paper</p>
                  <p className="font-medium uppercase">{file.paperSize}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-xs text-muted-foreground">Sides</p>
                  <p className="font-medium">{file.duplex ? 'Double-sided' : 'Single-sided'}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-xs text-muted-foreground">Price</p>
                  <p className="font-medium tabular-nums">{formatINRFromPaise(file.pricePaise)}</p>
                </div>
              </div>
              {file.pageRange && (
                <p className="text-xs text-muted-foreground">Page range: <code className="font-mono">{file.pageRange}</code></p>
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
                  <p className="mt-1 text-xs text-brand">No printers detected — will use the default printer.</p>
                )}
              </div>

              {/* Settings note */}
              <p className="text-xs text-muted-foreground">
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
                  className="min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
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
      {jobState.status === 'completed' && <span className="text-xs text-success">✓ Printed</span>}
      {jobState.status === 'failed' && (
        <div className="flex flex-col items-end">
          <span className="text-xs text-danger">✗ {jobState.error}</span>
          <button onClick={() => setJobState({ status: 'idle' })} className="text-xs text-brand hover:underline min-h-[44px] inline-flex items-center">Retry</button>
        </div>
      )}
      {jobState.status === 'unknown' && (
        <div className="flex flex-col items-end">
          <span className="text-xs text-brand">⚠ {jobState.error}</span>
          <button onClick={() => setJobState({ status: 'idle' })} className="text-xs text-brand hover:underline min-h-[44px] inline-flex items-center">Retry after checking queue</button>
        </div>
      )}
    </div>
  );
}
