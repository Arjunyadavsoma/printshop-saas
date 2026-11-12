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
  Database,
  HardDrive,
  Cpu,
  Radio,
  TrendingUp,
  ArrowRight,
  RefreshCw,
  Activity,
  BarChart3,
  ClipboardList,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminOrderListResponse,
} from '@/components/portal/admin-types';
import { OrderStatusBadge, StatusIndicator } from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { CardSkeleton, TableSkeleton } from '@/components/shared/loading-skeleton';
import { truncate } from '@/lib/utils';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Semantic accent class for the icon chip. Defaults to muted. */
  accent?: string;
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'bg-muted text-muted-foreground',
}: MetricCardProps) {
  return (
    <Card className="bg-surface">
      <CardContent className="flex items-start gap-3 p-5">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md ${accent}`}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

interface QuickLinkProps {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

function QuickLinkCard({ href, title, description, icon: Icon }: QuickLinkProps) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand"
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

/**
 * /admin — platform overview dashboard.
 *
 * Loads GET /api/v1/admin/analytics?date=today + GET /api/v1/admin/orders?limit=10
 * and renders KPI cards + recent orders + top shops by revenue + quick links.
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
    <div className="space-y-6">
      <PageHeader
        title="Platform Overview"
        description={`Today (${todayISO()}) · platform-wide metrics across all shops.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* No-commission notice — pinned to the top of the dashboard */}
      <Card className="border-success-border bg-success-soft">
        <CardContent className="flex items-start gap-3 p-4">
          <Wallet className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <div className="text-sm">
            <span className="font-semibold text-success">Platform revenue = ₹0</span>
            <span className="ml-2 text-success">
              This product charges <strong>no commission</strong> — customers pay the shopkeeper&rsquo;s
              UPI directly. Shops receive 100% of every paid order.
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load analytics</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary KPI grid — 4 metrics per brief + secondary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading || !p ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              label="Total shops"
              value={String(p.totalShops)}
              hint={`${p.activeShops} active · ${p.inactiveShops} inactive`}
              icon={Store}
              accent="bg-success-soft text-success"
            />
            <MetricCard
              label="Active shops"
              value={String(p.activeShops)}
              hint={`of ${p.totalShops} total`}
              icon={Store}
              accent="bg-brand-soft text-brand"
            />
            <MetricCard
              label="Total orders"
              value={String(p.totalOrders)}
              hint={`${p.paidOrders} paid · ${p.pendingPaymentVerification} awaiting payment`}
              icon={ShoppingBag}
              accent="bg-info-soft text-info"
            />
            <MetricCard
              label="Platform revenue"
              value="₹0.00"
              hint="No commission model"
              icon={IndianRupee}
              accent="bg-muted text-muted-foreground"
            />
          </>
        )}
      </div>

      {/* Secondary context metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading || !p ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              label="Gross paid value"
              value={inr(p.grossPaidValuePaise)}
              hint="Sum of paid order totals today"
              icon={TrendingUp}
              accent="bg-muted text-muted-foreground"
            />
            <MetricCard
              label="Shop earnings"
              value={inr(p.shopEarningsPaise)}
              hint="= gross paid value (0% commission)"
              icon={Wallet}
              accent="bg-success-soft text-success"
            />
            <MetricCard
              label="Pending payment verification"
              value={String(p.pendingPaymentVerification)}
              hint="Orders in awaiting_payment"
              icon={Clock}
              accent="bg-warning-soft text-warning-foreground"
            />
            <MetricCard
              label="Failed / disputed"
              value={String(p.failedOrDisputed)}
              hint="Cancelled orders today"
              icon={AlertCircle}
              accent="bg-danger-soft text-danger"
            />
          </>
        )}
      </div>

      {/* Health strip */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Service health</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Live readiness of platform dependencies
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !h ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HealthTile
                icon={Database}
                label="Database"
                state={h.database === 'healthy' ? 'healthy' : 'unhealthy'}
                detail={h.database}
              />
              <HealthTile icon={HardDrive} label="Storage" state="unknown" detail={h.storage} />
              <HealthTile icon={Cpu} label="Cache" state="unknown" detail={h.cache} />
              <HealthTile icon={Radio} label="Realtime" state="unknown" detail={h.realtime} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Storage/cache/realtime show provider name only — see{' '}
            <Link href="/admin/monitoring" className="text-brand hover:underline">
              Monitoring
            </Link>{' '}
            for full probe results.
          </p>
        </CardContent>
      </Card>

      {/* Print-agent connectivity summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !h ? (
          <CardSkeleton />
        ) : (
          <MetricCard
            label="Print-agents online"
            value={`${h.agentsOnline} / ${h.agentsOnline + h.agentsOffline}`}
            hint={`${h.agentsOffline} offline`}
            icon={Wifi}
            accent="bg-success-soft text-success"
          />
        )}
      </div>

      {/* Quick links to other admin sections */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLinkCard
          href="/admin/analytics"
          title="Analytics"
          description="Revenue trends, status breakdowns, top shops"
          icon={BarChart3}
        />
        <QuickLinkCard
          href="/admin/monitoring"
          title="Monitoring"
          description="Service health, audit log, failed jobs"
          icon={Activity}
        />
        <QuickLinkCard
          href="/admin/orders"
          title="All Orders"
          description="Every order across every shop"
          icon={ClipboardList}
        />
        <QuickLinkCard
          href="/admin/shops"
          title="Shops"
          description="Directory of every shop on the platform"
          icon={Store}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <Card className="bg-surface">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Recent orders</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Latest 10 orders across all shops
                </CardDescription>
              </div>
              <Link href="/admin/orders">
                <Button variant="ghost" size="sm" className="gap-1 text-brand">
                  View all <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading || !recentOrders ? (
              <TableSkeleton rows={5} cols={4} />
            ) : recentOrders.orders.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="size-6" aria-hidden="true" />}
                title="No orders yet"
                description="Orders will appear here as customers place them."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead className="hidden sm:table-cell">Shop</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-mono text-xs text-brand hover:underline"
                        >
                          {truncate(o.id, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {o.shopName}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inr(o.totalAmountPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top shops by revenue */}
        <Card className="bg-surface">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Top shops by revenue</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Paid sales today
                </CardDescription>
              </div>
              <Link href="/admin/shops">
                <Button variant="ghost" size="sm" className="gap-1 text-brand">
                  All shops <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading || !analytics ? (
              <TableSkeleton rows={5} cols={4} />
            ) : topShops.length === 0 ? (
              <EmptyState
                icon={<Store className="size-6" aria-hidden="true" />}
                title="No paid orders today"
                description="Top shops will appear here once orders are paid."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Orders</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topShops.map((s) => (
                    <TableRow key={s.shopId}>
                      <TableCell>
                        <Link
                          href={`/admin/shops/${s.shopId}`}
                          className="text-sm font-medium text-brand hover:underline"
                        >
                          {s.shopName}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {s.orders}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {s.paidOrders}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inr(s.revenuePaise)}
                      </TableCell>
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
        <Card className="bg-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Orders by status (today)</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Counts of orders in each lifecycle state
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(analytics.platform.ordersByStatus).map(([status, count]) => (
                <span
                  key={status}
                  className="inline-flex items-center gap-1.5"
                >
                  <OrderStatusBadge status={status} />
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </span>
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
  const variant =
    state === 'healthy'
      ? 'success'
      : state === 'unhealthy'
        ? 'danger'
        : 'neutral';
  const detailLabel =
    state === 'healthy' ? 'Healthy' : state === 'unhealthy' ? 'Unhealthy' : 'Unknown';
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <StatusIndicator variant={variant} label={`${label}: ${detailLabel}`} />
        <div
          className="mt-1 truncate font-mono text-xs text-muted-foreground"
          title={detail}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}
