'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Store,
  ArrowLeft,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  MapPin,
  Phone,
  CreditCard,
  Tag,
  IndianRupee,
  ShoppingBag,
  Printer,
  Cpu,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminShopDetailResponse,
} from '@/components/portal/admin-types';
import { OrderStatusBadge, StatusIndicator } from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { truncate } from '@/lib/utils';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  try { return formatINRFromPaise(paise); } catch { return '—'; }
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return s;
  }
}

interface InfoRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ icon: Icon, label, value, mono }: InfoRowProps) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-0.5 text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="flex items-center gap-3 p-5">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md ${accent}`}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * /admin/shops/[id] — shop detail.
 *
 * Renders full shop info, pricing config, order summary, orders list, and
 * agents with connection status. Uses GET /api/v1/admin/shops/[id].
 */
export default function AdminShopDetailPage() {
  const api = useApiClient();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const shopId = params.id;

  const [data, setData] = useState<AdminShopDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<unknown>('GET', `/api/v1/admin/shops/${shopId}`);
      setData(unwrap<AdminShopDetailResponse>(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shop');
    } finally {
      setLoading(false);
    }
  }, [api, shopId]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={loading || !data ? 'Shop detail' : data.shop.name}
        description="Shop detail"
        breadcrumbs={
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link href="/admin/shops" className="hover:text-foreground">
              Shops
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-foreground">
              {data ? data.shop.name : '…'}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/shops')}
              className="gap-1"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="min-h-[44px] gap-2"
            >
              <RefreshCw
                className={`size-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load shop</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading || !data ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={ShoppingBag}
              label="Total orders"
              value={String(data.summary.totalOrders)}
              accent="bg-info-soft text-info"
            />
            <StatCard
              icon={IndianRupee}
              label="Paid orders"
              value={String(data.summary.paidOrders)}
              accent="bg-success-soft text-success"
            />
            <StatCard
              icon={Tag}
              label="Revenue"
              value={inr(data.summary.revenuePaise)}
              accent="bg-muted text-muted-foreground"
            />
            <StatCard
              icon={Printer}
              label="Agents online"
              value={`${data.summary.activeAgents} / ${data.summary.totalAgents}`}
              accent="bg-brand-soft text-brand"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Shop info */}
            <Card className="bg-surface lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Shop information</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Identity, contact, subscription
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <InfoRow
                    icon={Store}
                    label="Shop name"
                    value={<span className="font-medium">{data.shop.name}</span>}
                  />
                  <InfoRow icon={Tag} label="Slug" value={<span className="font-mono">{data.shop.slug}</span>} mono />
                  <InfoRow icon={MapPin} label="Address" value={data.shop.address || '—'} />
                  <InfoRow icon={Phone} label="Phone" value={<span className="font-mono">{data.shop.phone || '—'}</span>} mono />
                  <InfoRow icon={CreditCard} label="UPI ID" value={<span className="font-mono">{data.shop.upiId || '—'}</span>} mono />
                  <InfoRow
                    icon={Cpu}
                    label="Payment provider"
                    value={<span className="font-mono">{data.shop.paymentProvider}</span>}
                    mono
                  />
                  <InfoRow
                    icon={Tag}
                    label="Subscription tier"
                    value={<span className="font-mono">{data.shop.subscriptionTier}</span>}
                    mono
                  />
                  <InfoRow
                    icon={Tag}
                    label="Subscription expires"
                    value={
                      data.shop.subscriptionExpiresAt
                        ? formatDateTime(data.shop.subscriptionExpiresAt)
                        : '—'
                    }
                  />
                  <InfoRow icon={Tag} label="Timezone" value={<span className="font-mono">{data.shop.timezone || '—'}</span>} mono />
                  <InfoRow
                    icon={Tag}
                    label="Active"
                    value={
                      <StatusIndicator
                        variant={data.shop.isActive ? 'success' : 'neutral'}
                        label={data.shop.isActive ? 'Yes' : 'No'}
                      />
                    }
                  />
                  <InfoRow
                    icon={Tag}
                    label="Created at"
                    value={formatDateTime(data.shop.createdAt)}
                  />
                  <InfoRow
                    icon={Tag}
                    label="Updated at"
                    value={formatDateTime(data.shop.updatedAt)}
                  />
                </div>

                <Separator className="my-4" />

                <div className="text-xs font-medium text-muted-foreground">
                  Pricing configuration
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <PricingField label="B&W A4" value={inr(data.shop.pricingConfig.bw_a4_per_page)} />
                  <PricingField label="Color A4" value={inr(data.shop.pricingConfig.color_a4_per_page)} />
                  <PricingField label="B&W A3" value={inr(data.shop.pricingConfig.bw_a3_per_page)} />
                  <PricingField label="Color A3" value={inr(data.shop.pricingConfig.color_a3_per_page)} />
                  <PricingField
                    label="Duplex discount"
                    value={`${data.shop.pricingConfig.duplex_discount}%`}
                  />
                  <PricingField
                    label="Bulk threshold"
                    value={`${data.shop.pricingConfig.bulk_threshold} pages`}
                  />
                  <PricingField
                    label="Bulk discount"
                    value={`${data.shop.pricingConfig.bulk_discount_pct}%`}
                  />
                  <PricingField
                    label="Min order value"
                    value={inr(data.shop.pricingConfig.min_order_value)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  All per-page rates are in paise (1 INR = 100 paise). Payment credentials are
                  intentionally NOT shown.
                </p>

                <Separator className="my-4" />

                <div className="text-xs font-medium text-muted-foreground">
                  Payment config status
                </div>
                <div className="mt-2">
                  <StatusIndicator
                    variant={data.shop.paymentProvider ? 'success' : 'warning'}
                    label={
                      data.shop.paymentProvider
                        ? `Configured (${data.shop.paymentProvider})`
                        : 'Not configured'
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Agents */}
            <Card className="bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Print-agents</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {data.agents.length} registered
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.agents.length === 0 ? (
                  <EmptyState
                    icon={<Printer className="size-6" aria-hidden="true" />}
                    title="No agents registered"
                    description="Print-agents will appear here once the shop owner connects them."
                  />
                ) : (
                  <ul className="space-y-2">
                    {data.agents.map((a) => (
                      <li key={a.id} className="rounded-lg border border-border bg-surface p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {a.name}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {a.printerName ?? 'No printer name'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            {a.isOnline ? (
                              <Wifi className="size-3.5 text-success" aria-hidden="true" />
                            ) : (
                              <WifiOff className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            )}
                            <span
                              className={a.isOnline ? 'text-success' : 'text-muted-foreground'}
                            >
                              {a.isOnline ? 'online' : 'offline'}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>v{a.version ?? '—'}</span>
                          <span>OS: {a.os ?? '—'}</span>
                          <span className="tabular-nums">
                            Last seen: {formatDateTime(a.lastSeenAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Orders for this shop */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Orders for this shop</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {data.orders.length} total orders
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {data.orders.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="size-6" aria-hidden="true" />}
                  title="No orders yet"
                  description="Orders placed at this shop will appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead className="hidden md:table-cell">Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="hidden lg:table-cell">Txn ID</TableHead>
                        <TableHead className="hidden md:table-cell">Created</TableHead>
                        <TableHead className="hidden lg:table-cell">Paid at</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.orders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell>
                            <Link
                              href={`/admin/orders/${o.id}`}
                              className="font-mono text-xs text-brand hover:underline"
                            >
                              {truncate(o.id, 8)}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">
                            {truncate(o.customerToken, 10)}
                          </TableCell>
                          <TableCell>
                            <OrderStatusBadge status={o.status} />
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {inr(o.totalAmountPaise)}
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                            {o.paymentTxnId ? truncate(o.paymentTxnId, 12) : '—'}
                          </TableCell>
                          <TableCell className="hidden text-xs tabular-nums md:table-cell">
                            {formatDateTime(o.createdAt)}
                          </TableCell>
                          <TableCell className="hidden text-xs tabular-nums lg:table-cell">
                            {formatDateTime(o.paidAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function PricingField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}
