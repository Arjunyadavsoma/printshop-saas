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
  type OrderStatus,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

const STATUS_COLORS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  printing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  collected: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status]} border-transparent font-medium`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function truncate(s: string, n = 8): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

interface InfoRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}

function InfoRow({ icon: Icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm break-words">{value}</div>
      </div>
    </div>
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/shops')} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-emerald-600" />
              {loading || !data ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{data.shop.name}</h2>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Shop detail</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <ShoppingBag className="h-5 w-5 text-sky-600" />
                <div>
                  <div className="text-xs text-muted-foreground">Total orders</div>
                  <div className="text-lg font-bold tabular-nums">{data.summary.totalOrders}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <IndianRupee className="h-5 w-5 text-emerald-600" />
                <div>
                  <div className="text-xs text-muted-foreground">Paid orders</div>
                  <div className="text-lg font-bold tabular-nums">{data.summary.paidOrders}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Tag className="h-5 w-5 text-violet-600" />
                <div>
                  <div className="text-xs text-muted-foreground">Revenue</div>
                  <div className="text-lg font-bold tabular-nums">{inr(data.summary.revenuePaise)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Printer className="h-5 w-5 text-amber-600" />
                <div>
                  <div className="text-xs text-muted-foreground">Agents online</div>
                  <div className="text-lg font-bold tabular-nums">
                    {data.summary.activeAgents} / {data.summary.totalAgents}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Shop info */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Shop information</CardTitle>
                <CardDescription>Identity, contact, subscription</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <InfoRow icon={Store} label="Shop name" value={<span className="font-medium">{data.shop.name}</span>} />
                  <InfoRow icon={Tag} label="Slug" value={<span className="font-mono">{data.shop.slug}</span>} />
                  <InfoRow icon={MapPin} label="Address" value={data.shop.address || '—'} />
                  <InfoRow icon={Phone} label="Phone" value={<span className="font-mono">{data.shop.phone || '—'}</span>} />
                  <InfoRow icon={CreditCard} label="UPI ID" value={<span className="font-mono">{data.shop.upiId || '—'}</span>} />
                  <InfoRow icon={Cpu} label="Payment provider" value={<span className="font-mono">{data.shop.paymentProvider}</span>} />
                  <InfoRow icon={Tag} label="Subscription tier" value={<span className="font-mono">{data.shop.subscriptionTier}</span>} />
                  <InfoRow
                    icon={Tag}
                    label="Subscription expires"
                    value={data.shop.subscriptionExpiresAt ? formatDateTime(data.shop.subscriptionExpiresAt) : '—'}
                  />
                  <InfoRow icon={Tag} label="Timezone" value={<span className="font-mono">{data.shop.timezone || '—'}</span>} />
                  <InfoRow icon={Tag} label="Active" value={
                    data.shop.isActive ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">Yes</Badge>
                    ) : (
                      <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">No</Badge>
                    )
                  } />
                  <InfoRow icon={Tag} label="Created at" value={formatDateTime(data.shop.createdAt)} />
                  <InfoRow icon={Tag} label="Updated at" value={formatDateTime(data.shop.updatedAt)} />
                </div>

                <Separator className="my-4" />

                <div className="text-xs font-medium text-muted-foreground">Pricing configuration</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <PricingField label="B&W A4" value={inr(data.shop.pricingConfig.bw_a4_per_page)} />
                  <PricingField label="Color A4" value={inr(data.shop.pricingConfig.color_a4_per_page)} />
                  <PricingField label="B&W A3" value={inr(data.shop.pricingConfig.bw_a3_per_page)} />
                  <PricingField label="Color A3" value={inr(data.shop.pricingConfig.color_a3_per_page)} />
                  <PricingField label="Duplex discount" value={`${data.shop.pricingConfig.duplex_discount}%`} />
                  <PricingField label="Bulk threshold" value={`${data.shop.pricingConfig.bulk_threshold} pages`} />
                  <PricingField label="Bulk discount" value={`${data.shop.pricingConfig.bulk_discount_pct}%`} />
                  <PricingField label="Min order value" value={inr(data.shop.pricingConfig.min_order_value)} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  All per-page rates are in paise (1 INR = 100 paise). Payment credentials are
                  intentionally NOT shown.
                </p>
              </CardContent>
            </Card>

            {/* Agents */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Print-agents</CardTitle>
                <CardDescription>{data.agents.length} registered</CardDescription>
              </CardHeader>
              <CardContent>
                {data.agents.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No agents registered.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.agents.map((a) => (
                      <li key={a.id} className="rounded-md border border-border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{a.name}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {a.printerName ?? 'No printer name'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            {a.isOnline ? (
                              <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className={a.isOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                              {a.isOnline ? 'online' : 'offline'}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>v{a.version ?? '—'}</span>
                          <span>OS: {a.os ?? '—'}</span>
                          <span>Last seen: {formatDateTime(a.lastSeenAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Orders for this shop */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders for this shop</CardTitle>
              <CardDescription>{data.orders.length} total orders</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {data.orders.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer token</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Txn ID</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Paid at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                            {truncate(o.id, 8)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{truncate(o.customerToken, 10)}</TableCell>
                        <TableCell><StatusBadge status={o.status} /></TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{inr(o.totalAmountPaise)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {o.paymentTxnId ? truncate(o.paymentTxnId, 12) : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{formatDateTime(o.createdAt)}</TableCell>
                        <TableCell className="text-xs">{formatDateTime(o.paidAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}
