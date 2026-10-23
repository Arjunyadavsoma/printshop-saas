'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  ClipboardList,
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
} from 'lucide-react';

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

function PaymentBadge({ status }: { status: PaymentFilter }) {
  const cls =
    status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
    status === 'pending' ? 'border-zinc-200 bg-zinc-50 text-zinc-700' :
    status === 'rejected' ? 'border-rose-200 bg-rose-50 text-rose-700' :
    status === 'refunded' ? 'border-violet-200 bg-violet-50 text-violet-800' :
    'border-border bg-card text-muted-foreground';
  const label =
    status === 'paid' ? 'Paid' :
    status === 'pending' ? 'Pending' :
    status === 'rejected' ? 'Rejected' :
    status === 'refunded' ? 'Refunded' :
    'Unknown';
  return (
    <Badge variant="outline" className={`text-[11px] ${cls}`}>
      <span className="mr-1 inline-block size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}

export default function ShopOrdersPage() {
  const api = useApiClient();
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

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 20_000);
    return () => clearInterval(id);
  }, [load]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Orders</h1>
            <p className="text-xs text-muted-foreground">
              {orders.length} of {total} total · filtered to {filtered.length}
            </p>
          </div>
        </div>
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

      {/* Filters */}
      <Card className="border-border">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="search" className="text-xs">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="token, order ID, or phone"
                className="h-11 pl-9 sm:h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status" className="text-xs">Order status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger id="status" className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment" className="text-xs">Payment</Label>
            <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}>
              <SelectTrigger id="payment" className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All payments</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date" className="text-xs">Date range</Label>
            <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
              <SelectTrigger id="date" className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {actionError && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-3 text-sm text-rose-700">⚠ {actionError}</CardContent>
        </Card>
      )}

      {/* List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Order queue</CardTitle>
          <CardDescription className="text-xs">
            Click any order to view files, payment verification, status actions, and the activity timeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              {error}
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
              </div>
            </div>
          ) : paged.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Inbox className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No orders match your filters</p>
              <p className="max-w-md text-xs text-muted-foreground">
                {orders.length === 0
                  ? 'No orders have been placed at your shop yet. New orders will appear here automatically.'
                  : 'Try clearing the search or switching the status filter.'}
              </p>
            </div>
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4 text-center">
                    <Checkbox
                      aria-label="Select all eligible orders on this page"
                      checked={
                        pagedEligible.length === 0
                          ? false
                          : allEligibleOnPageSelected
                            ? true
                            : someEligibleOnPageSelected
                              ? 'indeterminate'
                              : false
                      }
                      onCheckedChange={(v) => toggleSelectAllOnPage(v === true)}
                      disabled={batchState.running || pagedEligible.length === 0}
                    />
                  </TableHead>
                  <TableHead className="pl-1">Token</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((o) => {
                  const pstatus = paymentStatus(o);
                  const canVerify = o.status === 'awaiting_payment';
                  const canStart = o.status === 'paid';
                  const canReady = o.status === 'printing';
                  const idBusy = busy?.startsWith(`${o.id}:`) ?? false;
                  const eligible = isEligibleForBatch(o.status);
                  const isChecked = selectedIds.has(o.id);
                  return (
                    <TableRow key={o.id} className="cursor-pointer">
                      <TableCell className="w-10 pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select order ${o.tokenNumber ?? o.customerToken} for batch print`}
                          checked={isChecked}
                          disabled={!eligible || batchState.running}
                          onCheckedChange={(v) => toggleRow(o.id, v === true)}
                          title={!eligible ? `Orders in status '${o.status}' cannot be batch-printed (files may not be ready or have been removed).` : undefined}
                        />
                      </TableCell>
                      <TableCell className="pl-1">
                        <Link
                          href={`/shop/orders/${o.id}`}
                          className="font-mono font-semibold text-amber-700 hover:underline"
                        >
                          {o.tokenNumber ?? o.customerToken}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.customerPhone ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell><PaymentBadge status={pstatus} /></TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatINRFromPaise(o.totalAmountPaise)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {canVerify && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void quickVerify(o.id, 'verify')}
                                disabled={idBusy}
                                className="min-h-[44px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                title="Verify payment"
                              >
                                {busy === `${o.id}:verify` ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                <span className="hidden sm:inline">Verify</span>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={idBusy}
                                    className="min-h-[44px] min-w-[44px] gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                                    title="Reject payment"
                                  >
                                    {busy === `${o.id}:reject` ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Reject this payment?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Order {o.tokenNumber ?? o.customerToken} will be marked cancelled.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-rose-600 text-white hover:bg-rose-600/90"
                                      onClick={(e) => { e.preventDefault(); void quickVerify(o.id, 'reject'); }}
                                    >
                                      Yes, reject
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                          {canStart && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void quickStart(o.id)}
                              disabled={idBusy}
                              className="min-h-[44px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                              title="Start printing"
                            >
                              {busy === `${o.id}:start` ? <Loader2 className="size-3.5 animate-spin" /> : <PrinterIcon className="size-3.5" />}
                              <span className="hidden sm:inline">Start</span>
                            </Button>
                          )}
                          {canReady && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void quickReady(o.id)}
                              disabled={idBusy}
                              className="min-h-[44px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              title="Mark ready for pickup"
                            >
                              {busy === `${o.id}:ready` ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
                              <span className="hidden sm:inline">Ready</span>
                            </Button>
                          )}
                          <Button asChild size="sm" variant="ghost" className="gap-1">
                            <Link href={`/shop/orders/${o.id}`}><FileText className="size-3.5" /> Open</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Page {safePage + 1} of {totalPages} · {filtered.length} orders
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="min-h-[44px] gap-1"
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="min-h-[44px] gap-1"
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating batch action bar */}
      {/* Visible whenever orders are selected OR a batch is in progress / just finished */}
      {(selectedIds.size > 0 || batchState.running || (batchState.done && !batchState.error)) && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
            {/* Left: status / progress */}
            <div className="min-w-0 flex-1 space-y-1">
              {batchState.running ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      Printing order {batchState.currentOrderIdx} of {batchState.totalOrders}
                      {batchState.totalFilesInCurrentOrder > 0
                        ? `, file ${batchState.currentFileIdx} of ${batchState.totalFilesInCurrentOrder}`
                        : ''}
                      …
                    </span>
                  </div>
                  {batchState.currentFilename && (
                    <p className="truncate text-xs text-muted-foreground" title={batchState.currentFilename}>
                      {batchState.currentFilename}
                    </p>
                  )}
                  <Progress
                    value={
                      batchState.totalFiles > 0
                        ? (batchState.completedFiles / batchState.totalFiles) * 100
                        : 0
                    }
                    className="h-1.5"
                  />
                </>
              ) : batchState.done && batchState.results.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-medium text-foreground">
                    {batchState.canceled ? 'Batch canceled.' : 'Batch complete.'}
                  </span>
                  <span className="text-emerald-700">
                    <Check className="mr-0.5 inline size-3" />
                    {batchState.results.filter((r) => r.status === 'success').length} succeeded
                  </span>
                  <span className="text-rose-700">
                    <XCircle className="mr-0.5 inline size-3" />
                    {batchState.results.filter((r) => r.status === 'failed').length} failed
                  </span>
                  {batchState.results.some((r) => r.status === 'skipped') && (
                    <span className="text-muted-foreground">
                      <Ban className="mr-0.5 inline size-3" />
                      {batchState.results.filter((r) => r.status === 'skipped').length} skipped
                    </span>
                  )}
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer">Details</summary>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto text-[11px]">
                      {batchState.results.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          {r.status === 'success' ? (
                            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                          ) : r.status === 'skipped' ? (
                            <Ban className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <XCircle className="mt-0.5 size-3 shrink-0 text-rose-600" />
                          )}
                          <span className="truncate" title={`${r.orderToken} — ${r.filename}${r.error ? ` — ${r.error}` : ''}`}>
                            <span className="font-mono">{r.orderToken}</span> · {r.filename}
                            {r.error && <span className="text-rose-600"> — {r.error}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : batchState.done && batchState.error ? (
                <div className="flex items-center gap-2 text-sm text-rose-700">
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="break-words">{batchState.error}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Layers className="size-4 text-amber-600" />
                  <span>{selectedIds.size} order{selectedIds.size === 1 ? '' : 's'} selected</span>
                  <span className="text-xs text-muted-foreground">
                    ({pagedEligible.length} eligible on this page)
                  </span>
                </div>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex shrink-0 items-center gap-2">
              {batchState.running ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelBatch}
                  className="min-h-[44px] gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
                >
                  <X className="size-4" /> Cancel
                </Button>
              ) : batchState.done ? (
                <>
                  {batchState.error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetBatch}
                      className="min-h-[44px] gap-1.5"
                    >
                      Dismiss
                    </Button>
                  )}
                  {!batchState.error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetBatch}
                      className="min-h-[44px] gap-1.5"
                    >
                      <Check className="size-4" /> Done
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    className="min-h-[44px] gap-1.5"
                  >
                    Clear selection
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                    className="min-h-[44px] gap-1.5"
                  >
                    <Ban className="size-4" /> Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void runBatchPrint()}
                    disabled={selectedIds.size === 0}
                    className="min-h-[44px] gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                  >
                    <PrinterIcon className="size-4" />
                    Batch Print{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
