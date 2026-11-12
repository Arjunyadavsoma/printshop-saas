'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  AlertCircle,
  IndianRupee,
  Wallet,
  ShoppingBag,
  AlertTriangle,
  TrendingUp,
  Info,
  Store,
  Receipt,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminShopBreakdown,
  type OrderStatus,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { CardSkeleton, TableSkeleton } from '@/components/shared/loading-skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';

function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  try { return formatINRFromPaise(paise); } catch { return '—'; }
}

type RangeKey = 'today' | '7d' | '30d';

const RANGE_OPTIONS: { value: RangeKey; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
];

/** Format YYYY-MM-DD for a Date offset N days from today. */
function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Mon DD" short label for chart x-axis. */
function chartLabel(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  } catch {
    return iso;
  }
}

interface DayBucket {
  date: string;
  label: string;
  orders: number;
  paidOrders: number;
  grossPaidValuePaise: number;
  pending: number;
  failed: number;
}

const STATUS_ORDER: OrderStatus[] = [
  'awaiting_payment',
  'paid',
  'printing',
  'ready',
  'collected',
  'cancelled',
  'refunded',
];

const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  printing: 'Printing',
  ready: 'Ready for pickup',
  collected: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

/**
 * /admin/analytics — sales + earnings analytics.
 *
 * Date-range filter: today / last 7 days / last 30 days.
 *
 * Fetches one /api/v1/admin/analytics?date=YYYY-MM-DD per day in the range,
 * then aggregates into KPI totals, a per-day bar chart, and a shop-wise
 * paid-sales table.
 *
 * Metric definitions (clear, inline):
 *   - Customer amount charged = grossPaidValuePaise
 *   - Shop gross sales = same (0% commission model)
 *   - Platform fees/revenue = 0 (no commission model — documented)
 *   - Net shop earnings = same as gross sales
 */
export default function AdminAnalyticsPage() {
  const api = useApiClient();
  const [range, setRange] = useState<RangeKey>('7d');
  const [buckets, setBuckets] = useState<DayBucket[]>([]);
  const [shopBreakdown, setShopBreakdown] = useState<AdminShopBreakdown[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<Record<OrderStatus, number>>(
    () => ({
      awaiting_payment: 0,
      paid: 0,
      printing: 0,
      ready: 0,
      collected: 0,
      cancelled: 0,
      refunded: 0,
    }),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => RANGE_OPTIONS.find((o) => o.value === range)?.days ?? 7, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build the list of ISO date strings, oldest first.
      const dates = Array.from({ length: days }, (_, i) => isoNDaysAgo(days - 1 - i));
      const responses = await Promise.all(
        dates.map((d) => api.request<unknown>('GET', `/api/v1/admin/analytics?date=${d}`)),
      );
      const analytics = responses.map((r) => unwrap<AdminAnalyticsResponse>(r));

      const newBuckets: DayBucket[] = analytics.map((a, i) => ({
        date: dates[i],
        label: chartLabel(dates[i]),
        orders: a.platform.totalOrders,
        paidOrders: a.platform.paidOrders,
        grossPaidValuePaise: a.platform.grossPaidValuePaise,
        pending: a.platform.pendingPaymentVerification,
        failed: a.platform.failedOrDisputed,
      }));
      setBuckets(newBuckets);

      // Aggregate shop-wise breakdown across the date range.
      const shopMap = new Map<string, AdminShopBreakdown>();
      for (const a of analytics) {
        for (const s of a.shops) {
          const slot = shopMap.get(s.shopId) ?? {
            shopId: s.shopId,
            shopName: s.shopName,
            orders: 0,
            paidOrders: 0,
            revenuePaise: 0,
          };
          slot.orders += s.orders;
          slot.paidOrders += s.paidOrders;
          slot.revenuePaise += s.revenuePaise;
          shopMap.set(s.shopId, slot);
        }
      }
      setShopBreakdown(
        Array.from(shopMap.values()).sort((a, b) => b.revenuePaise - a.revenuePaise),
      );

      // Aggregate orders-by-status across the range (derived UI state).
      const statusAcc: Record<OrderStatus, number> = {
        awaiting_payment: 0,
        paid: 0,
        printing: 0,
        ready: 0,
        collected: 0,
        cancelled: 0,
        refunded: 0,
      };
      for (const a of analytics) {
        for (const k of STATUS_ORDER) {
          statusAcc[k] += a.platform.ordersByStatus[k] ?? 0;
        }
      }
      setStatusBreakdown(statusAcc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [api, days]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => ({
        orders: acc.orders + b.orders,
        paidOrders: acc.paidOrders + b.paidOrders,
        grossPaidValuePaise: acc.grossPaidValuePaise + b.grossPaidValuePaise,
        pending: acc.pending + b.pending,
        failed: acc.failed + b.failed,
      }),
      { orders: 0, paidOrders: 0, grossPaidValuePaise: 0, pending: 0, failed: 0 },
    );
  }, [buckets]);

  const activeShops = shopBreakdown.length;
  const avgPerShopPaise = activeShops > 0
    ? Math.round(totals.grossPaidValuePaise / activeShops)
    : 0;

  const statusTotal = useMemo(
    () => STATUS_ORDER.reduce((s, k) => s + (statusBreakdown[k] ?? 0), 0),
    [statusBreakdown],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Analytics"
        description="Platform-wide sales + earnings over the selected range."
        actions={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="gap-1.5"
              aria-label="Refresh analytics"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Metric definitions — pinned for clarity */}
      <Card className="bg-info-soft border-info-border">
        <CardContent className="p-4">
          <div className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
            <div className="text-info">
              <strong className="font-semibold">Metric definitions</strong> (this product has no commission model):
              <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-info">
                <li><strong>Customer amount charged</strong> = grossPaidValuePaise (sum of paid order totals)</li>
                <li><strong>Shop gross sales</strong> = same as customer amount charged (0% commission)</li>
                <li><strong>Platform fees / revenue</strong> = ₹0 (no commission model — documented)</li>
                <li><strong>Net shop earnings</strong> = same as shop gross sales</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="bg-danger-soft border-danger-border">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load analytics</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              label="Total revenue"
              value={inr(totals.grossPaidValuePaise)}
              hint="Customer amount charged"
              icon={IndianRupee}
              accent="bg-brand-soft text-brand"
            />
            <KpiCard
              label="Total orders"
              value={String(totals.orders)}
              hint={`${totals.paidOrders} paid`}
              icon={ShoppingBag}
              accent="bg-info-soft text-info"
            />
            <KpiCard
              label="Active shops"
              value={String(activeShops)}
              hint="With activity in range"
              icon={Store}
              accent="bg-success-soft text-success"
            />
            <KpiCard
              label="Avg per shop"
              value={inr(avgPerShopPaise)}
              hint="Revenue / active shop"
              icon={Wallet}
              accent="bg-muted text-muted-foreground"
            />
          </>
        )}
      </div>

      {/* Secondary KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              label="Pending payment"
              value={String(totals.pending)}
              hint="Awaiting verification"
              icon={AlertTriangle}
              accent="bg-warning-soft text-warning-foreground"
            />
            <KpiCard
              label="Failed / disputed"
              value={String(totals.failed)}
              hint="Cancelled"
              icon={AlertTriangle}
              accent="bg-danger-soft text-danger"
            />
            <KpiCard
              label="Platform revenue"
              value="₹0.00"
              hint="No commission model"
              icon={TrendingUp}
              accent="bg-muted text-muted-foreground"
            />
          </>
        )}
      </div>

      {/* Revenue over time chart */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Revenue over time</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Daily gross paid value across the selected range ({buckets.length} day{buckets.length === 1 ? '' : 's'})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[250px] sm:h-[300px] w-full rounded-md bg-muted/40" aria-hidden="true" />
          ) : buckets.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="size-6" />}
              title="No revenue data"
              description="No paid orders in the selected range."
            />
          ) : (
            <ChartContainer
              config={{ revenue: { label: 'Revenue', color: 'var(--brand)' } }}
              className="h-[250px] sm:h-[300px] w-full"
            >
              <AreaChart
                data={buckets}
                margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `₹${Math.round(v / 100)}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => inr(Number(value))}
                    />
                  }
                />
                <Area
                  dataKey="grossPaidValuePaise"
                  name="Revenue"
                  stroke="var(--color-revenue)"
                  fill="url(#fillRevenue)"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Orders per day chart */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Orders over time</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Daily order volume split by payment status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[250px] sm:h-[300px] w-full rounded-md bg-muted/40" aria-hidden="true" />
          ) : buckets.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="size-6" />}
              title="No order data"
              description="No orders in the selected range."
            />
          ) : (
            <ChartContainer
              config={{
                paidOrders: { label: 'Paid orders', color: 'var(--success)' },
                pending: { label: 'Awaiting payment', color: 'var(--warning)' },
                failed: { label: 'Cancelled', color: 'var(--danger)' },
              }}
              className="h-[250px] sm:h-[300px] w-full"
            >
              <BarChart
                data={buckets}
                margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="paidOrders" name="Paid orders" fill="var(--color-paidOrders)" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="pending" name="Awaiting payment" fill="var(--color-pending)" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="failed" name="Cancelled" fill="var(--color-failed)" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Top shops table */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Top shops</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Sorted by paid revenue (desc)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} cols={4} />
            </div>
          ) : shopBreakdown.length === 0 ? (
            <EmptyState
              icon={<Store className="size-6" />}
              title="No shop activity"
              description="No shops recorded sales in the selected range."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">Rank</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Total orders</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Paid orders</TableHead>
                  <TableHead className="text-right">Paid revenue</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Avg order value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shopBreakdown.map((s, idx) => (
                  <TableRow key={s.shopId}>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{s.shopName}</TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">
                      {s.orders}
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">
                      {s.paidOrders}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {inr(s.revenuePaise)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground hidden md:table-cell">
                      {s.paidOrders > 0 ? inr(Math.round(s.revenuePaise / s.paidOrders)) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Orders by status breakdown */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Orders by status</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Aggregate order status distribution across the selected range
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={5} cols={3} />
            </div>
          ) : statusTotal === 0 ? (
            <EmptyState
              icon={<Receipt className="size-6" />}
              title="No status data"
              description="No orders to summarize in the selected range."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {STATUS_ORDER.filter((k) => (statusBreakdown[k] ?? 0) > 0).map((k) => {
                  const count = statusBreakdown[k] ?? 0;
                  const pct = statusTotal > 0 ? (count / statusTotal) * 100 : 0;
                  return (
                    <TableRow key={k}>
                      <TableCell className="text-sm">{STATUS_LABELS[k]}</TableCell>
                      <TableCell className="text-right tabular-nums">{count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  hint?: string;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="flex items-start gap-3 p-5">
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
