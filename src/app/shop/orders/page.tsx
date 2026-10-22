'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { StatusBadge } from '@/components/portal/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { formatINRFromPaise } from '@platform/utils';
import { ORDER_STATUSES, type OrderStatus } from '@platform/core/domain';
import {
  ClipboardList,
  RefreshCw,
  Loader2,
  Search,
  Inbox,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';

interface OrderRow {
  id: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  createdAt: string;
  paidAt: string | null;
}

const PAGE_SIZE = 20;

type FilterValue = 'all' | OrderStatus;

export default function ShopOrdersPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const r = await api.request<{
        data?: OrderRow[];
        meta?: { pagination?: { total?: number } };
      }>('GET', '/api/v1/shops/me/orders?limit=200');
      if (r.status === 200 && r.data?.data) {
        setOrders(r.data.data);
        const totalFromMeta = r.data.meta?.pagination?.total;
        setTotal(typeof totalFromMeta === 'number' ? totalFromMeta : r.data.data.length);
      } else if (r.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Could not load orders.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 20_000);
    return () => clearInterval(id);
  }, []);

  // Client-side filter + search — we keep the server call simple (one big
  // fetch) and let the shopkeeper slice it locally; 200 orders is small.
  const filtered = useMemo(() => {
    let out = orders;
    if (statusFilter !== 'all') {
      out = out.filter((o) => o.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.customerToken.toLowerCase().includes(q),
      );
    }
    return out;
  }, [orders, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Orders</h1>
            <p className="text-xs text-muted-foreground">
              {orders.length} of {total} total · filtered to {filtered.length}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="gap-1.5"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="search" className="text-xs font-medium text-muted-foreground">
              Search by order ID or customer token
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. ABC123 or 3f2a…"
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5 sm:w-56">
            <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
              Filter by status
            </label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as FilterValue)}
            >
              <SelectTrigger id="status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Order queue</CardTitle>
          <CardDescription className="text-xs">
            Click any order to view its files, download print-ready documents, and advance the
            status through the lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              {error}
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : paged.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Inbox className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No orders match your filters</p>
              <p className="max-w-md text-xs text-muted-foreground">
                {orders.length === 0
                  ? 'No orders have been placed at your shop yet. New orders will appear here automatically.'
                  : 'Try clearing the search or switching the status filter.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="pr-4 text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer">
                    <TableCell className="pl-4">
                      <Link
                        href={`/shop/orders/${o.id}`}
                        className="font-mono font-semibold text-amber-700 hover:underline"
                      >
                        {o.customerToken}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINRFromPaise(o.totalAmountPaise)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.paidAt ? new Date(o.paidAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild size="sm" variant="ghost" className="gap-1">
                        <Link href={`/shop/orders/${o.id}`}>
                          <FileText className="size-3.5" /> Open
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {safePage + 1} of {totalPages} · {filtered.length} orders
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
