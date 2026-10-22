'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart3,
  RefreshCw,
  AlertCircle,
  IndianRupee,
  Wallet,
  ShoppingBag,
  AlertTriangle,
  TrendingUp,
  Info,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminShopBreakdown,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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

  // Reset on range change (useEffect via load dep already handles it).
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Analytics</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform-wide sales + earnings over the selected range.
          </p>
        </div>
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Metric definitions — pinned for clarity */}
      <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="text-emerald-900 dark:text-emerald-200">
              <strong>Metric definitions</strong> (this product has no commission model):
              <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-emerald-800 dark:text-emerald-300">
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
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p className="font-semibold">Failed to load analytics</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-7 w-20" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard label="Total orders" value={String(totals.orders)} icon={ShoppingBag} accent="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" />
            <KpiCard label="Paid orders" value={String(totals.paidOrders)} icon={ShoppingBag} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" />
            <KpiCard label="Gross paid value" value={inr(totals.grossPaidValuePaise)} icon={IndianRupee} accent="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" hint="Customer amount charged" />
            <KpiCard label="Shop earnings" value={inr(totals.grossPaidValuePaise)} icon={Wallet} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" hint="= gross paid value (0% commission)" />
            <KpiCard label="Platform revenue" value="₹0.00" icon={TrendingUp} accent="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" hint="No commission model" />
          </>
        )}
      </div>

      {/* Secondary KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-7 w-20" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard label="Pending payment" value={String(totals.pending)} icon={AlertTriangle} accent="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" hint="Awaiting payment" />
            <KpiCard label="Failed / disputed" value={String(totals.failed)} icon={AlertTriangle} accent="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" hint="Cancelled" />
          </>
        )}
      </div>

      {/* Orders per day chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orders per day</CardTitle>
          <CardDescription>
            Daily order volume over the selected range ({buckets.length} day{buckets.length === 1 ? '' : 's'})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64" />
          ) : buckets.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No data.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#71717a" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#71717a" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e4e4e7',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ fontWeight: 600 }}
                    formatter={(value: number, name: string) => {
                      if (name === 'Paid orders') return [value, 'Paid orders'];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="paidOrders" name="Paid orders" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pending" name="Awaiting payment" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Cancelled" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shop-wise breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shop-wise breakdown</CardTitle>
          <CardDescription>Sorted by paid revenue (desc)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : shopBreakdown.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No shop activity in the selected range.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Total orders</TableHead>
                    <TableHead className="text-right">Paid orders</TableHead>
                    <TableHead className="text-right">Paid revenue</TableHead>
                    <TableHead className="text-right">Avg order value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shopBreakdown.map((s) => (
                    <TableRow key={s.shopId}>
                      <TableCell className="font-medium">{s.shopName}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.paidOrders}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{inr(s.revenuePaise)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.paidOrders > 0 ? inr(Math.round(s.revenuePaise / s.paidOrders)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily breakdown</CardTitle>
          <CardDescription>Per-day totals over the selected range</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Gross paid value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...buckets].reverse().map((b) => (
                    <TableRow key={b.date}>
                      <TableCell className="font-mono text-xs">{b.date}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.paidOrders}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.pending}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.failed}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{inr(b.grossPaidValuePaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, accent, hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-lg font-bold tabular-nums">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
