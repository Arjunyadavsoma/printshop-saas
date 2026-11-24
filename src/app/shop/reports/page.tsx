'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { CardSkeleton, TableSkeleton } from '@/components/shared/loading-skeleton';
import { OrderStatusBadge, ORDER_STATUS_CONFIG } from '@/components/shared/status-indicator';
import { formatINRFromPaise } from '@platform/utils';
import { formatDate } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  Download,
  IndianRupee,
  Clock,
  RotateCcw,
  Receipt,
  Users,
  FileBarChart,
  TrendingUp,
} from 'lucide-react';

/**
 * Reports & analytics page.
 *
 * All metrics here are derived CLIENT-SIDE from the orders list
 * (`GET /api/v1/shops/me/orders?limit=200`). The dedicated analytics
 * endpoint may be gated (HTTP 403) on the free tier, so we deliberately
 * avoid depending on it — the shopkeeper gets a useful report regardless
 * of their subscription.
 *
 * The shopkeeper picks a date range preset (today / 7d / 30d / all time)
 * and we filter orders by `createdAt`, then aggregate:
 *   - revenue summary (paid / pending / refunded)
 *   - orders by status breakdown
 *   - top customers by order value
 */

type DateRange = 'today' | '7d' | '30d' | 'all';

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

interface CustomerAgg {
  phone: string;
  totalOrders: number;
  totalValuePaise: number;
  lastOrderAt: string;
}

const RANGE_LABEL: Record<DateRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

/** True if the ISO timestamp falls inside the selected range. */
function withinRange(iso: string, range: DateRange): boolean {
  if (range === 'all') return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  if (range === 'today') {
    const d = new Date(iso);
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }
  const days = range === '7d' ? 7 : 30;
  return t >= now - days * 24 * 60 * 60 * 1000;
}

/** Statuses that represent successfully collected revenue. */
const PAID_STATUSES = new Set(['paid', 'printing', 'ready', 'collected']);

export default function ReportsPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>('30d');
  // Spec screen 29: table / chart toggle for the per-day breakdown.
  const [dailyView, setDailyView] = useState<'table' | 'chart'>('table');

  useEffect(() => {
    document.title = 'Reports · Printelyx';
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
          setError(r.data?.error?.message ?? 'Could not load orders for the report.');
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
  }, [load]);

  // ── Filter orders by the selected date range ──
  const rangedOrders = useMemo(
    () => orders.filter((o) => withinRange(o.createdAt, range)),
    [orders, range],
  );

  // Per-day aggregation of the ranged orders (orders + collected).
  const daily = useMemo(() => {
    const map = new Map<string, { date: string; orders: number; collectedPaise: number }>();
    for (const o of rangedOrders) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      const row = map.get(key) ?? { date: key, orders: 0, collectedPaise: 0 };
      row.orders += 1;
      if (PAID_STATUSES.has(o.status)) row.collectedPaise += o.totalAmountPaise;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [rangedOrders]);
  const maxDailyCollected = useMemo(
    () => daily.reduce((m, d) => Math.max(m, d.collectedPaise), 0),
    [daily],
  );

  // ── Revenue summary ──
  const summary = useMemo(() => {
    let paidPaise = 0;
    let pendingPaise = 0;
    let refundedPaise = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let refundedCount = 0;
    for (const o of rangedOrders) {
      if (o.status === 'awaiting_payment') {
        pendingPaise += o.totalAmountPaise;
        pendingCount += 1;
      } else if (o.status === 'refunded') {
        refundedPaise += o.totalAmountPaise;
        refundedCount += 1;
      } else if (PAID_STATUSES.has(o.status)) {
        paidPaise += o.totalAmountPaise;
        paidCount += 1;
      }
    }
    return {
      paidPaise,
      pendingPaise,
      refundedPaise,
      paidCount,
      pendingCount,
      refundedCount,
    };
  }, [rangedOrders]);

  // ── Orders by status breakdown ──
  // Walk the canonical status order (from ORDER_STATUS_CONFIG) so the
  // table reads left-to-right along the order lifecycle, then append any
  // unknown statuses at the end.
  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of rangedOrders) {
      counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    }
    const known = Object.keys(ORDER_STATUS_CONFIG).filter((s) => counts.has(s));
    const unknown = Array.from(counts.keys()).filter(
      (s) => !ORDER_STATUS_CONFIG[s],
    );
    return [...known, ...unknown]
      .map((status) => ({ status, count: counts.get(status) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [rangedOrders]);

  // ── Top customers by order value ──
  const topCustomers = useMemo<CustomerAgg[]>(() => {
    const map = new Map<string, CustomerAgg>();
    for (const o of rangedOrders) {
      const phone = (o.customerPhone ?? '').trim();
      if (!phone) continue; // walk-ins have no phone — skip
      const existing = map.get(phone);
      if (existing) {
        existing.totalOrders += 1;
        existing.totalValuePaise += o.totalAmountPaise;
        if (new Date(o.createdAt).getTime() > new Date(existing.lastOrderAt).getTime()) {
          existing.lastOrderAt = o.createdAt;
        }
      } else {
        map.set(phone, {
          phone,
          totalOrders: 1,
          totalValuePaise: o.totalAmountPaise,
          lastOrderAt: o.createdAt,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.totalValuePaise - a.totalValuePaise)
      .slice(0, 10);
  }, [rangedOrders]);

  // ── CSV export of the ranged orders ──
  const exportCSV = () => {
    if (rangedOrders.length === 0) return;
    const rows = [
      ['Token', 'Customer Phone', 'Status', 'Amount (INR)', 'Paid At', 'Created At'],
      ...rangedOrders.map((o) => [
        o.tokenNumber ?? o.customerToken,
        o.customerPhone ?? '',
        o.status,
        (o.totalAmountPaise / 100).toFixed(2),
        o.paidAt ?? '',
        o.createdAt,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Revenue, order status, and top customers for the selected period."
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="space-y-4">
          <TableSkeleton rows={6} cols={4} />
        </div>
      </div>
    );
  }

  // ── Render: hard error (no data loaded) ──
  if (error && orders.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Revenue, order status, and top customers for the selected period."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              Couldn&apos;t load the report
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
        title="Reports"
        description="Revenue, order status, and top customers for the selected period."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
              <SelectTrigger
                size="sm"
                className="min-h-[44px] w-[150px] gap-1.5"
                aria-label="Filter by date range"
              >
                <CalendarIcon />
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="min-h-[44px] gap-1.5"
              aria-label="Refresh report"
            >
              {refreshing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={rangedOrders.length === 0}
              className="min-h-[44px] gap-1.5"
              aria-label="Download CSV"
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="p-4 text-sm text-warning-foreground">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Range context banner */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <FileBarChart className="size-4" aria-hidden="true" />
        <span>
          Showing <span className="font-medium text-foreground tabular-nums">{rangedOrders.length}</span>{' '}
          order{rangedOrders.length === 1 ? '' : 's'} for{' '}
          <span className="font-medium text-foreground">{RANGE_LABEL[range]}</span>.
        </span>
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <RevenueCard
          label="Total revenue"
          value={formatINRFromPaise(summary.paidPaise)}
          subtitle={`${summary.paidCount} paid order${summary.paidCount === 1 ? '' : 's'}`}
          icon={<IndianRupee className="size-4" aria-hidden="true" />}
          tone="text-success"
          bg="bg-success-soft"
        />
        <RevenueCard
          label="Pending revenue"
          value={formatINRFromPaise(summary.pendingPaise)}
          subtitle={`${summary.pendingCount} awaiting payment`}
          icon={<Clock className="size-4" aria-hidden="true" />}
          tone="text-warning-foreground"
          bg="bg-warning-soft"
        />
        <RevenueCard
          label="Refunded"
          value={formatINRFromPaise(summary.refundedPaise)}
          subtitle={`${summary.refundedCount} refunded order${summary.refundedCount === 1 ? '' : 's'}`}
          icon={<RotateCcw className="size-4" aria-hidden="true" />}
          tone="text-muted-foreground"
          bg="bg-muted"
        />
      </div>

      {/* Orders by status breakdown */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Receipt className="size-4 text-brand" aria-hidden="true" />
            Orders by status
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            How orders in this period are distributed across the order lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rangedOrders.length === 0 ? (
            <EmptyState
              className="px-4 py-12"
              icon={<Receipt className="size-6" />}
              title="No orders in this period"
              description="Try a wider date range, or wait for customers to place orders."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Status</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="pr-4 text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusBreakdown.map(({ status, count }) => {
                    const pct =
                      rangedOrders.length > 0
                        ? Math.round((count / rangedOrders.length) * 100)
                        : 0;
                    return (
                      <TableRow key={status}>
                        <TableCell className="pl-4">
                          <OrderStatusBadge status={status} />
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {count}
                        </TableCell>
                        <TableCell className="pr-4 text-right text-sm text-muted-foreground tabular-nums">
                          {pct}%
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

      {/* Per-day breakdown — table / chart toggle (spec screen 29) */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <FileBarChart className="size-4 text-brand" aria-hidden="true" />
                Per day
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Orders and collected amount for each day in the selected period.
              </CardDescription>
            </div>
            <div className="flex gap-1 rounded-md border p-1" role="tablist" aria-label="Per-day view">
              <Button
                variant={dailyView === 'table' ? 'default' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={dailyView === 'table'}
                onClick={() => setDailyView('table')}
                className="min-h-[36px]"
              >
                Table
              </Button>
              <Button
                variant={dailyView === 'chart' ? 'default' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={dailyView === 'chart'}
                onClick={() => setDailyView('chart')}
                className="min-h-[36px]"
              >
                Chart
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {daily.length === 0 ? (
            <EmptyState
              className="px-4 py-12"
              icon={<FileBarChart className="size-6" />}
              title="No orders in this period"
              description="Try a wider date range, or wait for customers to place orders."
            />
          ) : dailyView === 'table' ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Day</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="pr-4 text-right">Collected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="pl-4 text-sm">{formatDate(d.date)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {d.orders}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono font-medium tabular-nums">
                        {formatINRFromPaise(d.collectedPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-4 pb-4">
              <div
                className="flex h-48 items-end gap-2"
                role="img"
                aria-label={`Bar chart of collected amount per day, ${daily.length} days`}
              >
                {daily.map((d) => (
                  <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {d.orders}
                    </span>
                    <div
                      className="w-full max-w-[48px] rounded-t bg-brand"
                      style={{
                        height: `${maxDailyCollected > 0 ? Math.max(4, Math.round((d.collectedPaise / maxDailyCollected) * 140)) : 4}px`,
                      }}
                      title={`${formatDate(d.date)}: ${d.orders} orders, ${formatINRFromPaise(d.collectedPaise)} collected`}
                    />
                    <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                      {new Date(d.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="pt-3 text-xs text-muted-foreground">
                Bar height = collected amount that day; number above each bar = orders.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top customers by order value */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="size-4 text-brand" aria-hidden="true" />
            Top customers by order value
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            The 10 customers who spent the most in this period.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {topCustomers.length === 0 ? (
            <EmptyState
              className="px-4 py-12"
              icon={<Users className="size-6" />}
              title="No customer data yet"
              description="Customers with a phone number appear here once they place an order in this period."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 w-12 text-right">#</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Total value</TableHead>
                    <TableHead className="hidden sm:table-cell pr-4 text-right">Last order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCustomers.map((c, idx) => (
                    <TableRow key={c.phone}>
                      <TableCell className="pl-4 text-right text-sm text-muted-foreground tabular-nums">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">
                        {c.phone}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {c.totalOrders}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatINRFromPaise(c.totalValuePaise)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell pr-4 text-right text-sm text-muted-foreground">
                        {formatDate(c.lastOrderAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Period totals footer */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="size-4 text-brand" aria-hidden="true" />
            Period totals
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            A quick snapshot of {RANGE_LABEL[range].toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TotalCell
              label="Total orders"
              value={String(rangedOrders.length)}
            />
            {/* M-6 fix: AOV was previously computed as totalRevenue /
                totalOrders (using ALL orders as the denominator, including
                awaiting_payment + cancelled + refunded). This understated
                the average ticket size because unpaid/cancelled orders
                inflated the denominator. Per the audit, AOV should be
                totalRevenue / paidOrderCount — i.e., the average value of
                orders that actually got paid. Labelled "Avg paid order
                value" so it's explicit which denominator is used. */}
            <TotalCell
              label="Avg paid order value"
              value={formatINRFromPaise(
                summary.paidCount > 0
                  ? Math.round(summary.paidPaise / summary.paidCount)
                  : 0,
              )}
            />
            <TotalCell
              label="Unique customers"
              value={String(topCustomers.length)}
            />
            <TotalCell
              label="Refund rate"
              value={
                rangedOrders.length > 0
                  ? `${Math.round((summary.refundedCount / rangedOrders.length) * 100)}%`
                  : '0%'
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Local UI helpers ────────────────────────────────────────────────── */

function CalendarIcon() {
  return <FileBarChart className="size-4 opacity-70" aria-hidden="true" />;
}

function RevenueCard({
  label,
  value,
  subtitle,
  icon,
  tone,
  bg,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: string;
  bg: string;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="flex flex-col gap-2 p-5">
        <div className={`flex size-8 items-center justify-center rounded-md ${bg}`}>
          <span className={tone}>{icon}</span>
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </CardContent>
    </Card>
  );
}

function TotalCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
