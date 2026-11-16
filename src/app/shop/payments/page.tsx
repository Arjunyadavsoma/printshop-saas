'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { PaymentBadge, type PaymentStatusLike } from '@/components/portal/payment-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { formatINRFromPaise } from '@platform/utils';
import { formatDateTime, isToday } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  IndianRupee,
  Clock,
  Wallet,
  CreditCard,
  Receipt,
} from 'lucide-react';

interface OrderRow {
  id: string;
  customerToken: string;
  tokenNumber?: string | null;
  status:
    | 'awaiting_payment'
    | 'paid'
    | 'printing'
    | 'ready'
    | 'collected'
    | 'cancelled'
    | 'refunded';
  totalAmountPaise: number;
  createdAt: string;
  paidAt: string | null;
  customerPhone?: string | null;
}

type PaymentFilter = 'all' | 'pending' | 'verified' | 'failed' | 'refunded';

/**
 * Derive a payment-status bucket from an order's status + paidAt.
 *
 *   awaiting_payment            → pending
 *   paid / printing / ready /
 *   collected (with paidAt)     → verified
 *   cancelled                   → failed
 *   refunded                    → refunded
 *
 * Anything else with a paidAt falls back to verified — paidAt is the
 * canonical "the money landed" signal.
 */
function paymentStatus(o: OrderRow): PaymentFilter {
  if (o.status === 'awaiting_payment') return 'pending';
  if (o.status === 'cancelled') return 'failed';
  if (o.status === 'refunded') return 'refunded';
  if (o.paidAt) return 'verified';
  // paid / printing / ready / collected without a paidAt are still
  // considered verified for display purposes — the shop collected the
  // money, the webhook just hasn't landed yet.
  if (o.status === 'paid' || o.status === 'printing' || o.status === 'ready' || o.status === 'collected') {
    return 'verified';
  }
  return 'pending';
}

function isPaid(o: OrderRow): boolean {
  const s = paymentStatus(o);
  return s === 'verified';
}

/** Returns true if the order was created today (Asia/Kolkata). */
function createdToday(o: OrderRow): boolean {
  return isToday(o.createdAt);
}

export default function ShopPaymentsPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentFilter>('all');

  useEffect(() => {
    document.title = 'Payments · PrintShop SaaS';
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const r = await api.request<{
          data?: OrderRow[];
          error?: { message?: string };
        }>('GET', '/api/v1/shops/me/orders?limit=200');
        if (r.status === 200 && r.data?.data) {
          setOrders(r.data.data);
        } else if (r.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          setError(r.data?.error?.message ?? 'Could not load payments.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
    // Refresh every 20s — same budget as the orders page. New payments /
    // verifications should appear without a manual refresh.
    const id = setInterval(() => void load(true), 20_000);
    return () => clearInterval(id);
  }, [load]);

  // ── Summary metrics ──
  // All derived client-side from the orders list (no analytics endpoint
  // dependency — that one is entitlement-gated and would 403 for free
  // shops). A 200-order window matches the dashboard's data slice.
  const metrics = useMemo(() => {
    const todays = orders.filter(createdToday);
    const todaysPaid = todays.filter(isPaid);
    const todaysRevenuePaise = todaysPaid.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    const pending = orders.filter((o) => paymentStatus(o) === 'pending');
    const pendingValuePaise = pending.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    const allPaid = orders.filter(isPaid);
    const totalRevenuePaise = allPaid.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    return {
      todaysRevenuePaise,
      todaysOrderCount: todaysPaid.length,
      pendingCount: pending.length,
      pendingValuePaise,
      totalRevenuePaise,
      paidOrderCount: allPaid.length,
    };
  }, [orders]);

  // ── Filtered table rows ──
  // Most recent first — the payments overview is about "what just happened".
  const filtered = useMemo(() => {
    const sorted = [...orders].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (filter === 'all') return sorted;
    return sorted.filter((o) => paymentStatus(o) === filter);
  }, [orders, filter]);

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Payments"
          description="Revenue, pending collections, and recent payment activity at your shop."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TableSkeleton rows={1} cols={1} />
          <TableSkeleton rows={1} cols={1} />
          <TableSkeleton rows={1} cols={1} />
        </div>
        <TableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  // ── Render: hard error ──
  if (error && orders.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Payments"
          description="Revenue, pending collections, and recent payment activity at your shop."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              Couldn&apos;t load payments
            </CardTitle>
            <CardDescription className="text-danger">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void load()}
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Revenue, pending collections, and recent payment activity at your shop."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="min-h-[44px] gap-1.5"
            aria-label="Refresh payments"
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {error && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="p-4 text-sm text-warning-foreground">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Today's revenue"
          value={formatINRFromPaise(metrics.todaysRevenuePaise)}
          subtitle={`${metrics.todaysOrderCount} paid order${
            metrics.todaysOrderCount === 1 ? '' : 's'
          } today`}
          icon={<IndianRupee className="size-4" aria-hidden="true" />}
          tone="text-success"
        />
        <SummaryCard
          label="Pending payments"
          value={formatINRFromPaise(metrics.pendingValuePaise)}
          subtitle={`${metrics.pendingCount} order${
            metrics.pendingCount === 1 ? '' : 's'
          } awaiting payment`}
          icon={<Clock className="size-4" aria-hidden="true" />}
          tone="text-warning-foreground"
        />
        <SummaryCard
          label="Total revenue"
          value={formatINRFromPaise(metrics.totalRevenuePaise)}
          subtitle={`${metrics.paidOrderCount} paid order${
            metrics.paidOrderCount === 1 ? '' : 's'
          } all-time`}
          icon={<Wallet className="size-4" aria-hidden="true" />}
          tone="text-foreground"
        />
      </div>

      {/* Recent orders with payment status */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CreditCard className="size-4 text-brand" aria-hidden="true" />
                Recent payments
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Filter by status to focus on what needs your attention.
              </CardDescription>
            </div>
            <div className="w-full sm:w-48">
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v as PaymentFilter)}
              >
                <SelectTrigger
                  className="h-11 w-full sm:h-9"
                  aria-label="Filter by payment status"
                >
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Receipt className="size-6" />}
              title={
                orders.length === 0 ? 'No payments yet' : 'No matching orders'
              }
              description={
                orders.length === 0
                  ? 'Payments appear here once customers place and pay for orders.'
                  : 'Try a different status filter.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Customer
                    </TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment status</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Date
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => {
                    const status = paymentStatus(o);
                    const badgeStatus: PaymentStatusLike =
                      status === 'verified'
                        ? 'verified'
                        : status === 'failed'
                          ? 'failed'
                          : status === 'refunded'
                            ? 'refunded'
                            : 'pending';
                    return (
                      <TableRow key={o.id} className="cursor-pointer">
                        <TableCell>
                          <Link
                            href={`/shop/orders/${o.id}`}
                            className="font-mono font-semibold tabular-nums text-brand hover:underline"
                          >
                            {o.tokenNumber ?? o.customerToken}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground tabular-nums">
                          {o.customerPhone ?? (
                            <span className="italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {formatINRFromPaise(o.totalAmountPaise)}
                        </TableCell>
                        <TableCell>
                          <PaymentBadge status={badgeStatus} paidAt={o.paidAt} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                          {formatDateTime(o.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Local UI helpers ────────────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  subtitle,
  icon,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <p className="text-sm">{label}</p>
        </div>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}
        >
          {value}
        </p>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
