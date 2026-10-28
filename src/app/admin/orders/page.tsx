'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ShoppingBag,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminOrderListResponse,
  type AdminOrderListItem,
  type AdminShopListResponse,
  type OrderStatus,
} from '@/components/portal/admin-types';
import { formatINRFromPaise } from '@platform/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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

const STATUS_COLORS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  printing: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  collected: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

const ALL_STATUSES: OrderStatus[] = [
  'awaiting_payment', 'paid', 'printing', 'ready', 'collected', 'cancelled', 'refunded',
];

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status]} border-transparent font-medium`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function truncate(s: string, n = 10): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">All orders</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order across every shop ({orders.length} loaded).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Search by order ID, shop name, or customer token</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search order ID, shop name, customer token…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | OrderStatus)}
            >
              <SelectTrigger className="w-full lg:w-48">
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
              <SelectTrigger className="w-full lg:w-60">
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
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p className="font-semibold">Failed to load orders</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : pageItems.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No orders match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Customer token</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Txn ID</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Paid at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                          {truncate(o.id, 10)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/shops/${o.shopId}`} className="block text-sm font-medium hover:underline">
                          {o.shopName}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">{o.shopSlug}</span>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {pageItems.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + pageItems.length} of {filtered.length}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="min-h-[44px] min-w-[44px] gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="min-h-[44px] min-w-[44px] gap-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
