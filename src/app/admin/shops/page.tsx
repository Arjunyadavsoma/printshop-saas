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
import { StatusIndicator } from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
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
    <div className="space-y-6">
      <PageHeader
        title="Shops"
        description={`All shops on the platform (${shops.length} total).`}
        actions={
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
        }
      />

      {/* Filters card */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Filters</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Search by name, slug, or owner email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="Search shops…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search shops"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
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
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load shops</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={8} cols={6} />
            </div>
          ) : pageItems.length === 0 ? (
            <EmptyState
              icon={<Store className="size-6" aria-hidden="true" />}
              title="No shops found"
              description="No shops match the current filters. Try adjusting your search."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="hidden md:table-cell">Slug</TableHead>
                    <TableHead className="hidden lg:table-cell">Owner</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Orders</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Revenue</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                    <TableHead className="hidden md:table-cell">Agents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-surface-elevated">
                      <TableCell>
                        <Link href={`/admin/shops/${s.id}`} className="block">
                          <div className="font-medium text-brand hover:underline">
                            {s.name}
                          </div>
                          <div className="text-xs text-muted-foreground">{s.subscriptionTier} tier</div>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Link href={`/admin/shops/${s.id}`} className="block">
                          <span className="font-mono text-xs">{s.slug}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Link href={`/admin/shops/${s.id}`} className="block">
                          <span className="font-mono text-xs text-muted-foreground">
                            {s.ownerEmail}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {s.stats.orderCount}
                      </TableCell>
                      <TableCell className="hidden text-right font-medium tabular-nums sm:table-cell">
                        {inr(s.stats.paidSalesPaise)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/shops/${s.id}`} className="block">
                          <StatusIndicator
                            variant={s.isActive ? 'success' : 'neutral'}
                            label={s.isActive ? 'Active' : 'Inactive'}
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums lg:table-cell">
                        {formatDate(s.createdAt)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Link href={`/admin/shops/${s.id}`} className="block">
                          <div className="flex items-center gap-1.5 text-xs">
                            {s.stats.agentsOnline > 0 ? (
                              <Wifi className="size-3.5 text-success" aria-hidden="true" />
                            ) : (
                              <WifiOff className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            )}
                            <span className="tabular-nums text-muted-foreground">
                              {s.stats.agentsOnline}/{s.stats.agentsTotal}
                            </span>
                          </div>
                        </Link>
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
