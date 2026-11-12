'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ShoppingBag,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminOrderListResponse,
  type AdminOrderListItem,
  type AdminShopListResponse,
  type OrderStatus,
} from '@/components/portal/admin-types';
import { OrderStatusBadge } from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { truncate } from '@/lib/utils';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const ALL_STATUSES: OrderStatus[] = [
  'awaiting_payment', 'paid', 'printing', 'ready', 'collected', 'cancelled', 'refunded',
];

const PAGE_SIZE = 25;

/**
 * /admin/orders — global order explorer.
 *
 * All orders across all shops. Search by order ID or shop name, filter by
 * status, filter by shop. Paginated. Each row links to /admin/orders/[id].
 */
export default function AdminOrdersPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<AdminOrderListItem[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [shopFilter, setShopFilter] = useState<'all' | string>('all');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oRes, sRes] = await Promise.all([
        api.request<unknown>('GET', '/api/v1/admin/orders?limit=200'),
        api.request<unknown>('GET', '/api/v1/admin/shops?limit=200'),
      ]);
      setOrders(unwrap<AdminOrderListResponse>(oRes).orders ?? []);
      setShops((unwrap<AdminShopListResponse>(sRes).shops ?? []).map((s) => ({ id: s.id, name: s.name })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  // Reset to first page when filters change.
  useEffect(() => { setPage(0); }, [search, statusFilter, shopFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (shopFilter !== 'all' && o.shopId !== shopFilter) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        o.shopName.toLowerCase().includes(q) ||
        o.shopSlug.toLowerCase().includes(q) ||
        (o.customerToken ?? '').toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter, shopFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Orders"
        description={`Every order across every shop (${orders.length} loaded).`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw
              className={`size-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />

      {/* Filter card — search + status + shop */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Filters</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Search by order ID, shop name, or customer token
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="Search order ID, shop name, customer token…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search orders"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | OrderStatus)}
            >
              <SelectTrigger className="w-full lg:w-48" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={shopFilter}
              onValueChange={(v) => setShopFilter(v)}
            >
              <SelectTrigger className="w-full lg:w-60" aria-label="Filter by shop">
                <SelectValue placeholder="All shops" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All shops</SelectItem>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load orders</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={10} cols={6} />
            </div>
          ) : pageItems.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="size-6" aria-hidden="true" />}
              title="No orders found"
              description="No orders match the current filters. Try adjusting your search or status."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead className="hidden lg:table-cell">Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Txn ID</TableHead>
                    <TableHead className="hidden md:table-cell">Created</TableHead>
                    <TableHead className="hidden lg:table-cell">Paid at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-mono text-xs text-brand hover:underline"
                        >
                          {truncate(o.id, 10)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/shops/${o.shopId}`}
                          className="block text-sm font-medium text-brand hover:underline"
                        >
                          {o.shopName}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">
                          {o.shopSlug}
                        </span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs lg:table-cell">
                        {truncate(o.customerToken, 10)}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inr(o.totalAmountPaise)}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
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

      {/* Pagination */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs tabular-nums text-muted-foreground">
          Showing {pageItems.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + pageItems.length} of {filtered.length}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="min-h-[44px] min-w-[44px] gap-1"
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> Prev
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="min-h-[44px] min-w-[44px] gap-1"
            aria-label="Next page"
          >
            Next <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
