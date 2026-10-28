'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Store,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminShopListResponse,
  type AdminShopSummary,
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

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return s;
  }
}

const PAGE_SIZE = 20;

/**
 * /admin/shops — searchable, paginated directory of ALL shops (active + inactive).
 *
 * Each row: name, slug, owner email, created date, active status, order count,
 * paid sales, agent status. Click a row → /admin/shops/[id].
 */
export default function AdminShopsPage() {
  const api = useApiClient();
  const [shops, setShops] = useState<AdminShopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<unknown>('GET', '/api/v1/admin/shops?limit=200');
      const data = unwrap<AdminShopListResponse>(res);
      setShops(data.shops ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shops');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  // Reset to first page when filters change.
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shops.filter((s) => {
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.ownerEmail.toLowerCase().includes(q)
      );
    });
  }, [shops, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Shop directory</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            All shops on the platform ({shops.length} total).
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
          <CardDescription>Search by name, slug, or owner email</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search shops…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All shops</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="inactive">Inactive only</SelectItem>
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
              <p className="font-semibold">Failed to load shops</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : pageItems.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No shops match the current filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Paid sales</TableHead>
                  <TableHead>Agents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20">
                    <TableCell>
                      <Link href={`/admin/shops/${s.id}`} className="block">
                        <div className="font-medium text-zinc-900 hover:text-emerald-700 dark:text-zinc-100 dark:hover:text-emerald-400">
                          {s.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.subscriptionTier} tier</div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/shops/${s.id}`} className="block">
                        <span className="font-mono text-xs">{s.slug}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/shops/${s.id}`} className="block">
                        <span className="font-mono text-xs text-muted-foreground">{s.ownerEmail}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(s.createdAt)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/shops/${s.id}`} className="block">
                        {s.isActive ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            Inactive
                          </Badge>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.stats.orderCount}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{inr(s.stats.paidSalesPaise)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/shops/${s.id}`} className="block">
                        <div className="flex items-center gap-1.5 text-xs">
                          {s.stats.agentsOnline > 0 ? (
                            <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="tabular-nums">
                            {s.stats.agentsOnline}/{s.stats.agentsTotal}
                          </span>
                        </div>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
