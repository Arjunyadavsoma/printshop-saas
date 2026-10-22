'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Store,
  ShoppingBag,
  IndianRupee,
  Wallet,
  AlertCircle,
  Clock,
  Wifi,
  WifiOff,
  Database,
  HardDrive,
  Cpu,
  Radio,
  TrendingUp,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminOrderListResponse,
  type OrderStatus,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Safe INR formatter — never throws (renders "—" on bad input). */
function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  try {
    return formatINRFromPaise(paise);
  } catch {
    return '—';
  }
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function truncate(s: string, n = 8): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status]} border-transparent font-medium`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}

function KpiCard({ label, value, hint, icon: Icon, accent = 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' }: KpiProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start gap-3 p-4 sm:p-5">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
            {value}
          </div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthDot({ state }: { state: 'healthy' | 'unhealthy' | 'unknown' }) {
  const color =
    state === 'healthy' ? 'bg-emerald-500' :
    state === 'unhealthy' ? 'bg-red-500' : 'bg-zinc-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}

/**
 * /admin — platform overview dashboard.
 *
 * Loads GET /api/v1/admin/analytics?date=today + GET /api/v1/admin/orders?limit=10
 * and renders KPI cards + recent orders + top shops by revenue.
 *
 * Platform revenue is always ₹0 — this product has NO commission model.
 */
export default function AdminDashboardPage() {
  const api = useApiClient();
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [recentOrders, setRecentOrders] = useState<AdminOrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, oRes] = await Promise.all([
        api.request<unknown>('GET', `/api/v1/admin/analytics?date=${todayISO()}`),
        api.request<unknown>('GET', '/api/v1/admin/orders?limit=10'),
      ]);
      setAnalytics(unwrap<AdminAnalyticsResponse>(aRes));
      setRecentOrders(unwrap<AdminOrderListResponse>(oRes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  const p = analytics?.platform;
  const h = analytics?.health;
  const topShops = analytics?.shops?.slice(0, 5) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Platform overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Today ({todayISO()}) · platform-wide metrics across all shops.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* No-commission notice — pinned to the top of the dashboard */}
      <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
        <CardContent className="flex items-start gap-3 p-4">
          <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <span className="font-semibold text-emerald-900 dark:text-emerald-200">
              Platform revenue = ₹0
            </span>
            <span className="ml-2 text-emerald-800 dark:text-emerald-300">
              This product charges <strong>no commission</strong> — customers pay the shopkeeper's
              UPI directly. Shops receive 100% of every paid order.
            </span>
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

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {loading || !p ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 sm:p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-7 w-20" />
                <Skeleton className="mt-1 h-3 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard
              label="Total shops"
              value={String(p.totalShops)}
              hint={`${p.activeShops} active · ${p.inactiveShops} inactive`}
              icon={Store}
              accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            />
            <KpiCard
              label="Orders today"
              value={String(p.totalOrders)}
              hint={`${p.paidOrders} paid · ${p.pendingPaymentVerification} awaiting payment`}
              icon={ShoppingBag}
              accent="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            />
            <KpiCard
              label="Gross paid value"
              value={inr(p.grossPaidValuePaise)}
              hint="Sum of paid order totals today"
              icon={IndianRupee}
              accent="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
            />
            <KpiCard
              label="Shop earnings"
              value={inr(p.shopEarningsPaise)}
              hint="= gross paid value (0% commission)"
              icon={Wallet}
              accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            />
            <KpiCard
              label="Platform revenue"
              value="₹0.00"
              hint="No commission model"
              icon={TrendingUp}
              accent="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            />
            <KpiCard
              label="Pending payment verification"
              value={String(p.pendingPaymentVerification)}
              hint="Orders in awaiting_payment"
              icon={Clock}
              accent="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            />
            <KpiCard
              label="Print-agents online"
              value={`${h?.agentsOnline ?? 0} / ${h ? h.agentsOnline + h.agentsOffline : 0}`}
              hint={`${h?.agentsOffline ?? 0} offline`}
              icon={Wifi}
              accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            />
            <KpiCard
              label="Failed / disputed"
              value={String(p.failedOrDisputed)}
              hint="Cancelled orders today"
              icon={AlertCircle}
              accent="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
            />
          </>
        )}
      </div>

      {/* Health strip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service health</CardTitle>
          <CardDescription>Live readiness of platform dependencies</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !h ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HealthTile icon={Database} label="Database" state={h.database === 'healthy' ? 'healthy' : 'unhealthy'} detail={h.database} />
              <HealthTile icon={HardDrive} label="Storage" state="unknown" detail={h.storage} />
              <HealthTile icon={Cpu} label="Cache" state="unknown" detail={h.cache} />
              <HealthTile icon={Radio} label="Realtime" state="unknown" detail={h.realtime} />
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Storage/cache/realtime show provider name only — see <Link href="/admin/monitoring" className="text-emerald-700 hover:underline dark:text-emerald-400">Monitoring</Link> for full probe results.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Recent orders</CardTitle>
                <CardDescription>Latest 10 orders across all shops</CardDescription>
              </div>
              <Link href="/admin/orders">
                <Button variant="ghost" size="sm" className="gap-1 text-emerald-700 dark:text-emerald-400">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading || !recentOrders ? (
              <Skeleton className="h-40" />
            ) : recentOrders.orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs hover:underline">
                          {truncate(o.id, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{o.shopName}</TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{inr(o.totalAmountPaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top shops */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Top shops by revenue</CardTitle>
                <CardDescription>Paid sales today</CardDescription>
              </div>
              <Link href="/admin/shops">
                <Button variant="ghost" size="sm" className="gap-1 text-emerald-700 dark:text-emerald-400">
                  All shops <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading || !analytics ? (
              <Skeleton className="h-40" />
            ) : topShops.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No paid orders today.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topShops.map((s) => (
                    <TableRow key={s.shopId}>
                      <TableCell>
                        <Link href={`/admin/shops/${s.shopId}`} className="text-sm font-medium hover:underline">
                          {s.shopName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.paidOrders}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{inr(s.revenuePaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order-status breakdown */}
      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders by status (today)</CardTitle>
            <CardDescription>Counts of orders in each lifecycle state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(analytics.platform.ordersByStatus).map(([status, count]) => (
                <TooltipProvider key={status}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={`rounded-md px-3 py-1.5 text-xs font-medium ${STATUS_COLORS[status as OrderStatus]}`}>
                        {status.replace('_', ' ')} · {count}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{status}: {count} orders today</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HealthTile({
  icon: Icon,
  label,
  state,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  state: 'healthy' | 'unhealthy' | 'unknown';
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-medium">
          <HealthDot state={state} />
          {label}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={detail}>
          {detail}
        </div>
      </div>
    </div>
  );
}
