'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { usePoll } from '@/lib/hooks/use-poll';
import {
  Group,
  InsetList,
  InsetRow,
  ChevronRow,
  ValueRow,
  SwitchRow,
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
  SegmentedControl,
  Sheet,
  Input as ClearInput,
  SkeletonBox,
  SkeletonCard,
  IconButton,
} from '@/components/clear';
import { formatINRFromPaise } from '@platform/utils';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import {
  checkPrintLatchStatus,
  submitPrintLatchJob,
  getPrintLatchJobStatus,
  fetchPdfBytes,
  getPrefs,
  getNextAutoPrinter,
} from '@/lib/printlatch/client';
import {
  RefreshCw,
  Loader2,
  Search,
  Inbox,
  ChevronLeft,
  ChevronRight,
  FileText,
  Check,
  XCircle,
  Printer as PrinterIcon,
  PackageCheck,
  Layers,
  X,
  AlertCircle,
  CheckCircle2,
  Ban,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';

interface OrderRow {
  id: string;
  customerToken: string;
  tokenNumber?: string | null;
  status: OrderStatus;
  totalAmountPaise: number;
  createdAt: string;
  paidAt: string | null;
  customerPhone?: string | null;
}

// Only orders in these statuses are eligible for batch printing — they have
// been paid for and not yet collected/cancelled (files still exist).
function isEligibleForBatch(status: OrderStatus): boolean {
  return status === 'paid' || status === 'printing';
}

interface BatchFileResult {
  orderId: string;
  orderToken: string;
  filename: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

interface BatchState {
  running: boolean;
  totalOrders: number;
  currentOrderIdx: number; // 1-based for display
  totalFilesInCurrentOrder: number;
  currentFileIdx: number; // 1-based for display
  totalFiles: number;
  completedFiles: number;
  currentFilename: string;
  results: BatchFileResult[];
  done: boolean;
  canceled: boolean;
  error?: string;
}

const INITIAL_BATCH_STATE: BatchState = {
  running: false,
  totalOrders: 0,
  currentOrderIdx: 0,
  totalFilesInCurrentOrder: 0,
  currentFileIdx: 0,
  totalFiles: 0,
  completedFiles: 0,
  currentFilename: '',
  results: [],
  done: false,
  canceled: false,
};

const PAGE_SIZE = 20;

type StatusFilter = 'all' | OrderStatus;
type PaymentFilter = 'all' | 'pending' | 'paid' | 'rejected' | 'refunded';
type DateFilter = 'all' | 'today' | '7d' | '30d';

function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  } catch { return false; }
}
function withinDays(iso: string, days: number): boolean {
  try {
    const d = new Date(iso);
    return Date.now() - d.getTime() <= days * 24 * 60 * 60 * 1000;
  } catch { return false; }
}

function paymentStatus(o: OrderRow): PaymentFilter {
  if (o.status === 'awaiting_payment') return 'pending';
  if (o.paidAt) return 'paid';
  if (o.status === 'cancelled') return 'rejected';
  if (o.status === 'refunded') return 'refunded';
  return 'paid';
}

export default function ShopOrdersPage() {
  const api = useApiClient();
  useEffect(() => { document.title = 'Orders · PrintShop SaaS'; }, []);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Quick-action state
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Batch print state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchState, setBatchState] = useState<BatchState>(INITIAL_BATCH_STATE);
  const cancelRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const r = await api.request<{
        data?: OrderRow[];
        meta?: { pagination?: { total?: number } };
      }>('GET', '/api/v1/shops/me/orders?limit=200');
      if (r.status === 200 && r.data?.data) {
        setOrders(r.data.data);
        const totalFromMeta = r.data.meta?.pagination?.total;
        setTotal(typeof totalFromMeta === 'number' ? totalFromMeta : r.data.data.length);
      } else if (r.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Could not load orders.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [api]);

  // P2-5: was a bare setInterval that kept polling while the tab was hidden.
  useEffect(() => {
    void load();
  }, [load]);
  usePoll(() => load(true), 20_000, { deps: [load], immediate: false });

  // Client-side filter + search + date filter.
  const filtered = useMemo(() => {
    let out = orders;
    if (statusFilter !== 'all') {
      out = out.filter((o) => o.status === statusFilter);
    }
    if (paymentFilter !== 'all') {
      out = out.filter((o) => paymentStatus(o) === paymentFilter);
    }
    if (dateFilter === 'today') out = out.filter((o) => isToday(o.createdAt));
    else if (dateFilter === '7d') out = out.filter((o) => withinDays(o.createdAt, 7));
    else if (dateFilter === '30d') out = out.filter((o) => withinDays(o.createdAt, 30));

    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.customerToken.toLowerCase().includes(q) ||
          (o.tokenNumber ?? '').toLowerCase().includes(q) ||
          (o.customerPhone ?? '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [orders, statusFilter, paymentFilter, dateFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [statusFilter, paymentFilter, dateFilter, search]);

  // Prune the selection when the orders list refreshes — drop any selected
  // ID whose order has disappeared or whose status is no longer eligible
  // (e.g., cancelled or collected after selection).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const orderMap = new Map(orders.map((o) => [o.id, o]));
      const next = new Set<string>();
      for (const id of prev) {
        const o = orderMap.get(id);
        if (o && isEligibleForBatch(o.status)) next.add(id);
      }
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [orders]);

  // ── Batch selection helpers ──
  const pagedEligible = useMemo(
    () => paged.filter((o) => isEligibleForBatch(o.status)),
    [paged],
  );
  const allEligibleOnPageSelected =
    pagedEligible.length > 0 &&
    pagedEligible.every((o) => selectedIds.has(o.id));
  const someEligibleOnPageSelected =
    !allEligibleOnPageSelected && pagedEligible.some((o) => selectedIds.has(o.id));

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const o of pagedEligible) {
        if (checked) next.add(o.id);
        else next.delete(o.id);
      }
      return next;
    });
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Batch print flow ──
  // For each selected order (sequentially):
  //   1. Fetch order detail to get the file list
  //   2. For each file (sequentially):
  //      - GET print-url endpoint → short-lived presigned URL
  //      - fetchPdfBytes → submitPrintLatchJob (mode='print')
  //      - poll getPrintLatchJobStatus until completed/failed/unknown
  //      - record per-file result
  // Cancellation: cancelRef is checked between every step; once set, the
  // loop exits gracefully after the current file finishes (or skips).
  const runBatchPrint = async () => {
    if (batchState.running) return;
    cancelRef.current = false;

    // Preflight: verify the PrintLatch agent is connected before we start
    // fetching PDFs — otherwise we waste 60-second presigned URLs.
    const status = await checkPrintLatchStatus();
    if (status.state !== 'connected') {
      setBatchState({
        ...INITIAL_BATCH_STATE,
        done: true,
        error: status.error ?? 'PrintLatch agent is not connected. Open the Printer Setup page to connect.',
      });
      return;
    }

    const orderIds = Array.from(selectedIds);
    setBatchState({
      ...INITIAL_BATCH_STATE,
      running: true,
      totalOrders: orderIds.length,
    });

    const results: BatchFileResult[] = [];
    let totalFiles = 0;
    let completedFiles = 0;

    try {
      for (let i = 0; i < orderIds.length; i++) {
        if (cancelRef.current) break;
        const orderId = orderIds[i];

        // Fetch the order detail to get the file list (and the token for display).
        const orderR = await api.request<{
          data?: {
            id: string;
            customerToken: string;
            tokenNumber?: string | null;
            files: { id: string; originalFilename: string; copies: number; status: string }[];
          };
          error?: { message?: string };
        }>('GET', `/api/v1/shops/me/orders/${orderId}`);

        if (orderR.status !== 200 || !orderR.data?.data) {
          results.push({
            orderId,
            orderToken: orderId.slice(0, 8),
            filename: '(order)',
            status: 'failed',
            error: orderR.data?.error?.message ?? `Could not load order (HTTP ${orderR.status})`,
          });
          setBatchState((prev) => ({
            ...prev,
            currentOrderIdx: i + 1,
            results: [...results],
          }));
          continue;
        }

        const order = orderR.data.data;
        const orderToken = order.tokenNumber ?? order.customerToken;
        const files = order.files ?? [];
        totalFiles += files.length;

        for (let j = 0; j < files.length; j++) {
          if (cancelRef.current) break;
          const file = files[j];

          setBatchState((prev) => ({
            ...prev,
            currentOrderIdx: i + 1,
            totalFilesInCurrentOrder: files.length,
            currentFileIdx: j + 1,
            totalFiles,
            completedFiles,
            currentFilename: file.originalFilename,
            results: [...results],
          }));

          try {
            // 1. Get the short-lived presigned URL + file settings.
            const urlR = await api.request<{
              data?: { downloadUrl: string; filename: string; copies: number };
              error?: { message?: string };
            }>('GET', `/api/v1/shops/me/orders/${orderId}/files/${file.id}/print-url`);
            if (urlR.status !== 200 || !urlR.data?.data) {
              throw new Error(urlR.data?.error?.message ?? `Could not get print URL (HTTP ${urlR.status})`);
            }
            const { downloadUrl, filename, copies } = urlR.data.data;

            // 2. Fetch the actual PDF bytes from the presigned URL.
            const pdfBytes = await fetchPdfBytes(downloadUrl);

            // 3. Submit the job to the PrintLatch agent. If auto mode is on,
            // use the round-robin printer; otherwise let the agent use the default.
            const prefs = getPrefs();
            const autoPrinter = prefs.mode === 'auto' ? getNextAutoPrinter() : undefined;
            const job = await submitPrintLatchJob({
              pdf: pdfBytes,
              filename,
              mode: 'print',
              copies: Math.min(Math.max(1, copies), 10),
              printerId: autoPrinter,
            });

            // 4. Poll for completion (up to 10 attempts × 2s = 20s).
            let finalStatus: 'completed' | 'failed' | 'unknown' = 'unknown';
            let finalError: string | undefined;
            for (let k = 0; k < 10; k++) {
              if (cancelRef.current) break;
              await new Promise((r) => setTimeout(r, 2000));
              const status = await getPrintLatchJobStatus(job.id);
              if (status.status === 'completed') { finalStatus = 'completed'; break; }
              if (status.status === 'failed') { finalStatus = 'failed'; finalError = status.error?.message ?? 'Print job failed'; break; }
              if (status.status === 'unknown') { finalStatus = 'unknown'; finalError = status.error?.message ?? 'Unknown — check printer queue'; break; }
            }

            if (cancelRef.current) {
              results.push({
                orderId,
                orderToken,
                filename,
                status: 'skipped',
                error: 'Canceled by user',
              });
              setBatchState((prev) => ({ ...prev, results: [...results] }));
              break;
            }

            if (finalStatus === 'completed') {
              results.push({ orderId, orderToken, filename, status: 'success' });
              completedFiles++;
              // Increment the global print counter that the printer page's
              // supply-tracking card reads to estimate paper consumption.
              try {
                const cur = parseInt(localStorage.getItem('printshop_print_count') ?? '0', 10) || 0;
                localStorage.setItem('printshop_print_count', String(cur + 1));
              } catch { /* localStorage unavailable — ignore */ }
            } else if (finalStatus === 'failed') {
              results.push({ orderId, orderToken, filename, status: 'failed', error: finalError });
            } else {
              results.push({
                orderId,
                orderToken,
                filename,
                status: 'failed',
                error: finalError ?? 'Timed out — check printer queue',
              });
            }
            setBatchState((prev) => ({ ...prev, results: [...results], completedFiles }));
          } catch (err) {
            results.push({
              orderId,
              orderToken,
              filename: file.originalFilename,
              status: 'failed',
              error: err instanceof Error ? err.message : 'Print failed',
            });
            setBatchState((prev) => ({ ...prev, results: [...results] }));
          }
        }
        if (cancelRef.current) break;
      }
    } finally {
      setBatchState((prev) => ({
        ...prev,
        running: false,
        done: true,
        canceled: cancelRef.current,
        results: [...results],
        completedFiles,
        totalFiles,
      }));
    }
  };

  const cancelBatch = () => {
    cancelRef.current = true;
  };

  const resetBatch = () => {
    cancelRef.current = false;
    setBatchState(INITIAL_BATCH_STATE);
  };

  // ── Quick actions ──
  const quickVerify = async (orderId: string, action: 'verify' | 'reject') => {
    setBusy(`${orderId}:${action}`);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/verify-payment`,
        { body: { action } },
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`;
        setActionError(msg);
        toast.error(
          action === 'verify' ? 'Could not verify payment' : 'Could not reject payment',
          { description: msg },
        );
        return;
      }
      // Success — clear feedback that the payment status was updated. Without
      // this, the order just silently moves out of the "awaiting payment"
      // filter and the shopkeeper has no confirmation the click landed.
      if (action === 'verify') {
        toast.success('✓ Payment verified', {
          description: 'Order marked as paid. The customer will see the update on their tracking page.',
        });
      } else {
        toast.success('Payment rejected', {
          description: 'Order marked as cancelled. The customer will see "rejected" on their tracking page.',
        });
      }
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setActionError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setBusy(null);
    }
  };
  const quickStart = async (orderId: string) => {
    setBusy(`${orderId}:start`);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/start`,
      );
      if (r.status >= 400) {
        setActionError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
        return;
      }
      await load(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };
  const quickReady = async (orderId: string) => {
    setBusy(`${orderId}:ready`);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/ready`,
      );
      if (r.status >= 400) {
        setActionError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
        return;
      }
      await load(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };


  // ── Mobile segmented control state ──
  // Maps the four spec segments to underlying status filters.
  // "To confirm" → awaiting_payment (payment pending)
  // "Printing" → paid | printing (queued + actively printing)
  // "Ready" → ready
  // "Done" → collected | cancelled | refunded
  type Segment = 'confirm' | 'printing' | 'ready' | 'done';
  const [segment, setSegment] = useState<Segment>('confirm');
  const segmentOptions = [
    { value: 'confirm', label: 'To confirm' },
    { value: 'printing', label: 'Printing' },
    { value: 'ready', label: 'Ready' },
    { value: 'done', label: 'Done' },
  ];

  const segmentStatuses: Record<Segment, OrderStatus[]> = {
    confirm: ['awaiting_payment'],
    printing: ['paid', 'printing'],
    ready: ['ready'],
    done: ['collected', 'cancelled', 'refunded'],
  };

  // When the user picks a mobile segment, snap the status filter to match
  // (so the existing `filtered` memo, which respects statusFilter, returns
  // the right slice). The desktop sidebar filters remain independent — the
  // shopkeeper can still pick "All statuses" on desktop.
  const onSegmentChange = (next: string) => {
    const s = next as Segment;
    setSegment(s);
    setStatusFilter('all');
    setPaymentFilter('all');
    setDateFilter('all');
    // Apply the segment's status set as a custom filter via a derived list
    // (we don't extend StatusFilter; we filter inline in the mobile view).
  };

  // Mobile-only filtered list — uses the active segment's status set.
  const mobileFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = orders.filter((o) => segmentStatuses[segment].includes(o.status));
    if (q) {
      out = out.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.customerToken.toLowerCase().includes(q) ||
          (o.tokenNumber ?? '').toLowerCase().includes(q) ||
          (o.customerPhone ?? '').toLowerCase().includes(q),
      );
    }
    // Most recent first
    return [...out].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [orders, segment, search]);

  // ── Desktop kanban columns ──
  // Four columns per R13: Awaiting payment, Queued (paid), Printing, Ready.
  // Built from the same `orders` source, filtered by the sidebar's search +
  // date filters when set (status + payment filters are NOT applied on
  // desktop — the columns ARE the status filter).
  const desktopBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = orders;
    if (dateFilter === 'today') out = out.filter((o) => isToday(o.createdAt));
    else if (dateFilter === '7d') out = out.filter((o) => withinDays(o.createdAt, 7));
    else if (dateFilter === '30d') out = out.filter((o) => withinDays(o.createdAt, 30));
    if (q) {
      out = out.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.customerToken.toLowerCase().includes(q) ||
          (o.tokenNumber ?? '').toLowerCase().includes(q) ||
          (o.customerPhone ?? '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [orders, search, dateFilter]);

  const kanbanColumns: Array<{
    key: string;
    title: string;
    statuses: OrderStatus[];
    pill: 'pending' | 'printing' | 'ready' | 'collected';
  }> = [
    { key: 'awaiting', title: 'Awaiting payment', statuses: ['awaiting_payment'], pill: 'pending' },
    { key: 'queued', title: 'Queued', statuses: ['paid'], pill: 'pending' },
    { key: 'printing', title: 'Printing', statuses: ['printing'], pill: 'printing' },
    { key: 'ready', title: 'Ready', statuses: ['ready'], pill: 'ready' },
  ];

  const columnOrders = (statuses: OrderStatus[]) =>
    desktopBase
      .filter((o) => statuses.includes(o.status))
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

  // ── Order drawer (Sheet in drawer mode on desktop, bottom sheet on mobile) ──
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);
  const drawerOrder = useMemo(
    () => orders.find((o) => o.id === drawerOrderId) ?? null,
    [orders, drawerOrderId],
  );

  // ── Render ──
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 sm:px-6 lg:max-w-[1280px] lg:py-8">
        <SkeletonBox className="h-9 w-32" />
        <SkeletonBox className="h-12 w-full" />
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <ClearErrorState
          message={error}
          fix="Check your connection and try again. If the problem persists, your session may have expired."
          referenceCode="ORDERS_LOAD"
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const displayToken = (o: OrderRow) => o.tokenNumber ?? o.customerToken;

  return (
    <>
      {/* ── Mobile layout (< 1200px): segmented + OrderCard list ── */}
      <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 pb-24 pt-6 sm:px-6 lg:hidden">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)]">
              Orders
            </h1>
            <p className="mt-0.5 text-sm text-[var(--label-2)]">
              {orders.length} of {total} total
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-label="Refresh orders"
            className="inline-flex size-12 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-5" aria-hidden="true" />
            )}
          </button>
        </header>

        {/* Search */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--label-3)]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by token, ID, or phone"
            aria-label="Search orders"
            className="min-h-[48px] w-full rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] pl-10 pr-3 py-3 text-base text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none"
          />
        </div>

        <SegmentedControl
          options={segmentOptions}
          value={segment}
          onChange={onSegmentChange}
          ariaLabel="Order status segment"
        />

        {actionError && (
          <p className="text-xs text-[var(--danger-text)]" role="alert">
            {actionError}
          </p>
        )}

        {/* Order card list */}
        {mobileFiltered.length === 0 ? (
          <ClearEmptyState
            icon={<Inbox className="size-6" aria-hidden="true" />}
            title="No orders in this view"
            description={
              orders.length === 0
                ? 'No orders have been placed at your shop yet.'
                : 'Try a different segment or clear the search.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {mobileFiltered.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                busy={busy?.startsWith(`${o.id}:`) ?? false}
                onOpen={() => setDrawerOrderId(o.id)}
                onVerify={() => void quickVerify(o.id, 'verify')}
                onReject={() => void quickVerify(o.id, 'reject')}
                onStart={() => void quickStart(o.id)}
                onReady={() => void quickReady(o.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Desktop layout (≥ 1200px): 240px sidebar + four kanban columns ── */}
      <div className="hidden lg:mx-auto lg:flex lg:w-full lg:max-w-[1280px] lg:gap-6 lg:px-6 lg:py-8">
        {/* Sidebar — filters + search + refresh */}
        <aside className="flex w-60 shrink-0 flex-col gap-4">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)]">
              Orders
            </h1>
            <p className="mt-0.5 text-sm text-[var(--label-2)]">
              {orders.length} of {total} total
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[15px] font-semibold text-[var(--label)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            Refresh
          </button>

          <Group padding="content" title="Search">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--label-3)]"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="token, ID, phone"
                aria-label="Search orders"
                className="min-h-[44px] w-full rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] pl-9 pr-3 py-2.5 text-sm text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none"
              />
            </div>
          </Group>

          <Group padding="rows" title="Date range">
            <InsetList>
              {(['all', 'today', '7d', '30d'] as DateFilter[]).map((d) => (
                <FilterRow
                  key={d}
                  label={
                    d === 'all' ? 'All time' :
                    d === 'today' ? 'Today' :
                    d === '7d' ? 'Last 7 days' :
                    'Last 30 days'
                  }
                  selected={dateFilter === d}
                  onClick={() => setDateFilter(d)}
                />
              ))}
            </InsetList>
          </Group>

          {actionError && (
            <p className="text-xs text-[var(--danger-text)]" role="alert">
              {actionError}
            </p>
          )}
        </aside>

        {/* Kanban board — on #E8E9EF background per R13 */}
        <div
          className="flex flex-1 gap-4 overflow-x-auto rounded-[var(--radius-card)] p-4"
          style={{ backgroundColor: 'var(--kanban-fill, #E8E9EF)' }}
        >
          {kanbanColumns.map((col) => {
            const colOrders = columnOrders(col.statuses);
            return (
              <section
                key={col.key}
                className="flex w-72 shrink-0 flex-col gap-2"
                aria-label={col.title}
              >
                <div className="flex items-center justify-between px-2 py-1">
                  <h2 className="text-sm font-semibold text-[var(--label)]">
                    {col.title}
                  </h2>
                  <ClearBadge count={colOrders.length} />
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                  {colOrders.length === 0 ? (
                    <div className="rounded-[var(--radius-card)] bg-[var(--surface)]/40 px-3 py-6 text-center text-xs text-[var(--label-2)]">
                      No orders
                    </div>
                  ) : (
                    colOrders.map((o) => (
                      <KanbanCard
                        key={o.id}
                        order={o}
                        onOpen={() => setDrawerOrderId(o.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* ── Floating batch-action bar (kept from the original) ──
          Visible whenever orders are selected OR a batch is in progress. */}
      {(selectedIds.size > 0 || batchState.running || (batchState.done && !batchState.error)) && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--hairline)] bg-[rgba(255,255,255,0.86)] backdrop-blur-lg safe-bottom">
          <div className="mx-auto flex max-w-[640px] flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4 lg:max-w-[1280px]">
            <div className="min-w-0 flex-1 space-y-1">
              {batchState.running ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span className="tabular-nums">
                      Printing order {batchState.currentOrderIdx} of {batchState.totalOrders}
                      {batchState.totalFilesInCurrentOrder > 0
                        ? `, file ${batchState.currentFileIdx} of ${batchState.totalFilesInCurrentOrder}`
                        : ''}
                      …
                    </span>
                  </div>
                  {batchState.currentFilename && (
                    <p className="truncate text-xs text-[var(--label-2)]" title={batchState.currentFilename}>
                      {batchState.currentFilename}
                    </p>
                  )}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width] duration-200"
                      style={{
                        width: `${
                          batchState.totalFiles > 0
                            ? (batchState.completedFiles / batchState.totalFiles) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </>
              ) : batchState.done && batchState.results.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-medium text-[var(--label)]">
                    {batchState.canceled ? 'Batch canceled.' : 'Batch complete.'}
                  </span>
                  <span className="text-[var(--success-text)] tabular-nums">
                    <Check className="mr-0.5 inline size-3" aria-hidden="true" />
                    {batchState.results.filter((r) => r.status === 'success').length} succeeded
                  </span>
                  <span className="text-[var(--danger-text)] tabular-nums">
                    <XCircle className="mr-0.5 inline size-3" aria-hidden="true" />
                    {batchState.results.filter((r) => r.status === 'failed').length} failed
                  </span>
                  {batchState.results.some((r) => r.status === 'skipped') && (
                    <span className="text-[var(--label-2)] tabular-nums">
                      <Ban className="mr-0.5 inline size-3" aria-hidden="true" />
                      {batchState.results.filter((r) => r.status === 'skipped').length} skipped
                    </span>
                  )}
                  <details className="text-[var(--label-2)]">
                    <summary className="cursor-pointer">Details</summary>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto text-xs">
                      {batchState.results.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          {r.status === 'success' ? (
                            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[var(--success-text)]" aria-hidden="true" />
                          ) : r.status === 'skipped' ? (
                            <Ban className="mt-0.5 size-3 shrink-0 text-[var(--label-2)]" aria-hidden="true" />
                          ) : (
                            <XCircle className="mt-0.5 size-3 shrink-0 text-[var(--danger-text)]" aria-hidden="true" />
                          )}
                          <span className="truncate" title={`${r.orderToken} — ${r.filename}${r.error ? ` — ${r.error}` : ''}`}>
                            <span className="font-mono">{r.orderToken}</span> · {r.filename}
                            {r.error && <span className="text-[var(--danger-text)]"> — {r.error}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : batchState.done && batchState.error ? (
                <div className="flex items-center gap-2 text-sm text-[var(--danger-text)]">
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">{batchState.error}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--label)]">
                  <Layers className="size-4 text-[var(--accent)]" aria-hidden="true" />
                  <span className="tabular-nums">{selectedIds.size} order{selectedIds.size === 1 ? '' : 's'} selected</span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {batchState.running ? (
                <DestructiveButton size="compact" onClick={cancelBatch}>
                  <X className="size-4" aria-hidden="true" /> Cancel
                </DestructiveButton>
              ) : batchState.done ? (
                <>
                  <TextButton size="compact" onClick={clearSelection}>Clear selection</TextButton>
                  <TintedButton size="compact" onClick={resetBatch}>
                    <Check className="size-4" aria-hidden="true" /> Done
                  </TintedButton>
                </>
              ) : (
                <>
                  <TextButton size="compact" onClick={clearSelection} disabled={selectedIds.size === 0}>
                    <Ban className="size-4" aria-hidden="true" /> Clear
                  </TextButton>
                  <PrimaryButton
                    size="compact"
                    onClick={() => void runBatchPrint()}
                    disabled={selectedIds.size === 0}
                  >
                    <PrinterIcon className="size-4" aria-hidden="true" />
                    Batch Print{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </PrimaryButton>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Order drawer (Sheet) — opens when a card is selected ── */}
      <Sheet
        open={drawerOrderId !== null}
        onClose={() => setDrawerOrderId(null)}
        title={drawerOrder ? `Order ${displayToken(drawerOrder)}` : 'Order'}
        footer={
          drawerOrder && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/shop/orders/${drawerOrder.id}`}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[15px] font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)]"
              >
                <FileText className="size-4" aria-hidden="true" />
                Open order
              </Link>
            </div>
          )
        }
      >
        {drawerOrder && (
          <DrawerOrderSummary
            order={drawerOrder}
            busy={busy?.startsWith(`${drawerOrder.id}:`) ?? false}
            onVerify={() => void quickVerify(drawerOrder.id, 'verify')}
            onReject={() => void quickVerify(drawerOrder.id, 'reject')}
            onStart={() => void quickStart(drawerOrder.id)}
            onReady={() => void quickReady(drawerOrder.id)}
          />
        )}
      </Sheet>
    </>
  );
}

// ── Local helper components ──────────────────────────────────────────────

/** Maps an OrderStatus to a Clear StatusPill lifecycle state. */
function statusPillFor(status: OrderStatus): { s: 'pending' | 'printing' | 'ready' | 'collected' | 'error'; label: string } {
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

/** Mobile OrderCard — white tile with token, amount, customer, status chip, quick actions. */
function OrderCard({
  order,
  busy,
  onOpen,
  onVerify,
  onReject,
  onStart,
  onReady,
}: {
  order: OrderRow;
  busy: boolean;
  onOpen: () => void;
  onVerify: () => void;
  onReject: () => void;
  onStart: () => void;
  onReady: () => void;
}) {
  const token = order.tokenNumber ?? order.customerToken;
  const sp = statusPillFor(order.status);
  const canVerify = order.status === 'awaiting_payment';
  const canStart = order.status === 'paid';
  const canReady = order.status === 'printing';
  return (
    <li>
      <article
        className="rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]"
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-start justify-between gap-3 text-left"
          aria-label={`Open order ${token}`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-mono text-base font-semibold tabular-nums text-[var(--label)]">
              {token}
            </p>
            <p className="mt-0.5 truncate text-sm text-[var(--label-2)]">
              {order.customerPhone ?? 'Walk-in'}
            </p>
          </div>
          <span className="text-base font-semibold tabular-nums text-[var(--label)]">
            {formatINRFromPaise(order.totalAmountPaise)}
          </span>
        </button>

        <div className="my-3 h-px w-full bg-[var(--hairline)]" aria-hidden="true" />

        <div className="flex items-center justify-between gap-2">
          <StatusPill status={sp.s} label={sp.label} />
          <div className="flex items-center gap-1.5">
            {canVerify && (
              <button
                type="button"
                onClick={onVerify}
                disabled={busy}
                aria-label={`Verify payment for order ${token}`}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                Verify
              </button>
            )}
            {canVerify && (
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                aria-label={`Reject payment for order ${token}`}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
              >
                <XCircle className="size-3.5" aria-hidden="true" />
                Reject
              </button>
            )}
            {canStart && (
              <button
                type="button"
                onClick={onStart}
                disabled={busy}
                aria-label={`Start printing order ${token}`}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-tint)] px-3 text-xs font-semibold text-[var(--accent-tint-text)] transition-colors hover:brightness-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PrinterIcon className="size-3.5" aria-hidden="true" />}
                Start
              </button>
            )}
            {canReady && (
              <button
                type="button"
                onClick={onReady}
                disabled={busy}
                aria-label={`Mark order ${token} ready for pickup`}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--success-tint)] px-3 text-xs font-semibold text-[var(--success-text)] transition-colors hover:brightness-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}
                Ready
              </button>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

/** Desktop KanbanCard — white tile with name + total + split line + status chip. */
function KanbanCard({ order, onOpen }: { order: OrderRow; onOpen: () => void }) {
  const token = order.tokenNumber ?? order.customerToken;
  const sp = statusPillFor(order.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[var(--radius-card)] bg-[var(--surface)] p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--fill)]"
      aria-label={`Open order ${token}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold tabular-nums text-[var(--label)]">
          {token}
        </p>
        <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
          {formatINRFromPaise(order.totalAmountPaise)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-[var(--label-2)]">
        {order.customerPhone ?? 'Walk-in'}
      </p>
      <div className="my-2 h-px w-full bg-[var(--hairline)]" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <StatusPill status={sp.s} label={sp.label} />
        <span className="text-xs text-[var(--label-3)]">
          {new Date(order.createdAt).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

/** Filter row for the desktop sidebar (selectable, min-h-44). */
function FilterRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={[
          'flex w-full items-center justify-between min-h-[44px] px-4 py-2 text-left text-sm transition-colors',
          selected ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)] font-semibold' : 'text-[var(--label)] hover:bg-[var(--fill)]',
        ].join(' ')}
      >
        <span>{label}</span>
        {selected && <Check className="size-4" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** Drawer contents — order summary + quick actions. */
function DrawerOrderSummary({
  order,
  busy,
  onVerify,
  onReject,
  onStart,
  onReady,
}: {
  order: OrderRow;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
  onStart: () => void;
  onReady: () => void;
}) {
  const token = order.tokenNumber ?? order.customerToken;
  const sp = statusPillFor(order.status);
  const canVerify = order.status === 'awaiting_payment';
  const canStart = order.status === 'paid';
  const canReady = order.status === 'printing';
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <StatusPill status={sp.s} label={sp.label} />
        <span className="text-2xl font-bold tabular-nums text-[var(--label)]">
          {formatINRFromPaise(order.totalAmountPaise)}
        </span>
      </div>

      <Group padding="rows">
        <InsetList>
          <ValueRow label="Token" value={token} />
          <ValueRow label="Customer" value={order.customerPhone ?? 'Walk-in'} />
          <ValueRow label="Placed" value={new Date(order.createdAt).toLocaleString()} />
          <ValueRow label="Status" value={order.status.replace(/_/g, ' ')} />
        </InsetList>
      </Group>

      {(canVerify || canStart || canReady) && (
        <div className="flex flex-col gap-2">
          {canVerify && (
            <>
              <PrimaryButton onClick={onVerify} disabled={busy} loading={busy}>
                <Check className="size-4" aria-hidden="true" />
                Verify payment
              </PrimaryButton>
              <DestructiveButton onClick={onReject} disabled={busy}>
                <XCircle className="size-4" aria-hidden="true" />
                Reject payment
              </DestructiveButton>
            </>
          )}
          {canStart && (
            <PrimaryButton onClick={onStart} disabled={busy} loading={busy}>
              <PrinterIcon className="size-4" aria-hidden="true" />
              Start printing
            </PrimaryButton>
          )}
          {canReady && (
            <PrimaryButton onClick={onReady} disabled={busy} loading={busy}>
              <PackageCheck className="size-4" aria-hidden="true" />
              Mark ready for pickup
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  );
}
