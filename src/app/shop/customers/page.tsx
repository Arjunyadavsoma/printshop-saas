'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { usePoll } from '@/lib/hooks/use-poll';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { OrderStatusBadge } from '@/components/shared/status-indicator';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINRFromPaise } from '@platform/utils';
import { formatDate, timeAgo } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  Search,
  Users,
  Phone,
  ArrowRight,
  IndianRupee,
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

interface CustomerAgg {
  phone: string;
  totalOrders: number;
  totalValuePaise: number;
  lastOrderAt: string;
  lastStatus: OrderRow['status'];
}

/**
 * Aggregate orders by customer phone. Orders without a phone are skipped —
 * they're walk-ins the shopkeeper can't contact again, so they don't belong
 * in a "customer directory".
 */
function aggregateCustomers(orders: OrderRow[]): CustomerAgg[] {
  const map = new Map<string, CustomerAgg>();
  for (const o of orders) {
    const phone = (o.customerPhone ?? '').trim();
    if (!phone) continue;
    const existing = map.get(phone);
    if (existing) {
      existing.totalOrders += 1;
      existing.totalValuePaise += o.totalAmountPaise;
      if (new Date(o.createdAt).getTime() > new Date(existing.lastOrderAt).getTime()) {
        existing.lastOrderAt = o.createdAt;
        existing.lastStatus = o.status;
      }
    } else {
      map.set(phone, {
        phone,
        totalOrders: 1,
        totalValuePaise: o.totalAmountPaise,
        lastOrderAt: o.createdAt,
        lastStatus: o.status,
      });
    }
  }
  // Sort by last order date descending — the most recently active customers
  // surface to the top, which is what a shopkeeper scanning the directory
  // actually cares about ("who placed an order today?").
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime(),
  );
}

export default function ShopCustomersPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Customers · Printelyx';
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
          setError(r.data?.error?.message ?? 'Could not load customers.');
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

  // P2-5: was a bare setInterval that kept polling while the tab was hidden.
  // Refresh every 30s — customers are derived from orders, so the same
  // staleness budget as the orders page applies.
  useEffect(() => {
    void load();
  }, [load]);
  usePoll(() => load(true), 30_000, { deps: [load], immediate: false });

  const customers = useMemo(() => aggregateCustomers(orders), [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    // Phone-number search: also match if the user types digits only (strip
    // the leading +91 / 0 prefix that Indian numbers often carry).
    const qDigits = q.replace(/\D/g, '');
    return customers.filter((c) => {
      if (c.phone.toLowerCase().includes(q)) return true;
      if (qDigits && c.phone.replace(/\D/g, '').includes(qDigits)) return true;
      return false;
    });
  }, [customers, search]);

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customers"
          description="Every customer who has placed an order at your shop, grouped by phone number."
        />
        <div className="space-y-4">
          <TableSkeleton rows={6} cols={5} />
        </div>
      </div>
    );
  }

  // ── Render: hard error (no data loaded) ──
  if (error && orders.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customers"
          description="Every customer who has placed an order at your shop, grouped by phone number."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              Couldn&apos;t load customers
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

  // ── Summary stats ──
  const totalValuePaise = customers.reduce((acc, c) => acc + c.totalValuePaise, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Every customer who has placed an order at your shop, grouped by phone number."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="min-h-[44px] gap-1.5"
            aria-label="Refresh customers"
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card className="bg-surface">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="size-4" aria-hidden="true" />
              <p className="text-sm">Total customers</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {customers.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Unique phone numbers
            </p>
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ArrowRight className="size-4" aria-hidden="true" />
              <p className="text-sm">Total orders</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {orders.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across all customers
            </p>
          </CardContent>
        </Card>
        <Card className="bg-surface col-span-2 lg:col-span-1">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4" aria-hidden="true" />
              <p className="text-sm">Lifetime value</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {formatINRFromPaise(totalValuePaise)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sum of all order totals
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Directory</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Search by phone number. Click a row to view that customer&apos;s orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="tel"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone, e.g. 9876543210"
              className="h-11 pl-9 text-base sm:h-9 sm:text-sm"
              aria-label="Search customers by phone number"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" />}
              title={
                customers.length === 0
                  ? 'No customers yet'
                  : 'No matching customers'
              }
              description={
                customers.length === 0
                  ? 'Customers appear here once they place an order with a phone number.'
                  : 'Try a different phone number or clear the search.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Total value</TableHead>
                    <TableHead className="hidden sm:table-cell">Last order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.phone}>
                      <TableCell>
                        <Link
                          href={`/shop/orders?phone=${encodeURIComponent(c.phone)}`}
                          className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-brand hover:underline"
                        >
                          <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="tabular-nums">{c.phone}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.totalOrders}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatINRFromPaise(c.totalValuePaise)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        <div className="flex flex-col">
                          <span>{timeAgo(c.lastOrderAt)}</span>
                          <span className="text-xs">{formatDate(c.lastOrderAt)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={c.lastStatus} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="min-h-[44px] gap-1 text-brand hover:bg-brand-soft"
                        >
                          <Link
                            href={`/shop/orders?phone=${encodeURIComponent(c.phone)}`}
                            aria-label={`View orders for ${c.phone}`}
                          >
                            Orders
                            <ArrowRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
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
