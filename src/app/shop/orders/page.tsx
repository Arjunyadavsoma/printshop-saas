'use client';

/**
 * /shop/orders — spec screens 22 (list/table) + 23 (kanban).
 *
 * Clear ShopShell provides the chrome; this page renders only content.
 *
 * Three views over the same real data (GET /api/v1/shops/me/orders):
 *   - Mobile (< lg): segmented tabs Waiting / Held / Printing / Done.
 *   - Desktop: a Table / Kanban toggle. The PDF shows both layouts but no
 *     switch control — the segmented toggle here is NEW (added by this
 *     rebuild so the shopkeeper can reach both).
 *
 * Honest gaps (the list endpoint returns the Order domain only):
 *   - "Held": the order domain has no held status, and there is no
 *     hold/unhold endpoint. The Held tab therefore shows an honest empty
 *     state instead of invented rows.
 *   - Table columns "Split" and "Printing on": the list API returns no
 *     per-file split and no printer assignment. Both columns show "—" and
 *     the footnote says the split lives on the order detail page.
 *   - Cancelled / refunded orders are excluded from the kanban and shown
 *     only in the table's "All" filter, with their count noted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  SegmentedControl,
  StatusPill,
  TintedButton,
  EmptyState,
  Input,
} from '@/components/clear';
import { ClipboardList, Plus } from 'lucide-react';

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

type MobileTab = 'waiting' | 'held' | 'printing' | 'done';
type DesktopView = 'table' | 'kanban';
type Column = 'awaiting' | 'queued' | 'printing' | 'ready';

function bucketFor(status: OrderRow['status']): Column | null {
  switch (status) {
    case 'awaiting_payment':
      return 'awaiting';
    case 'paid':
      return 'queued';
    case 'printing':
      return 'printing';
    case 'ready':
    case 'collected':
      return 'ready';
    default:
      return null;
  }
}

function timeAgoShort(iso: string): string {
  try {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

function pillStatus(
  s: OrderRow['status'],
): 'pending' | 'printing' | 'ready' | 'collected' | 'error' {
  switch (s) {
    case 'awaiting_payment':
      return 'pending';
    case 'printing':
      return 'printing';
    case 'ready':
      return 'ready';
    case 'collected':
      return 'collected';
    default:
      return 'error';
  }
}

function statusLabel(s: OrderRow['status']): string {
  switch (s) {
    case 'awaiting_payment':
      return 'To confirm';
    case 'paid':
      return 'Queued';
    case 'printing':
      return 'Printing';
    case 'ready':
      return 'Ready';
    case 'collected':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
    default:
      return s;
  }
}

const COLUMN_DEFS: Array<{ key: Column; label: string }> = [
  { key: 'awaiting', label: 'Awaiting payment' },
  { key: 'queued', label: 'Queued' },
  { key: 'printing', label: 'Printing' },
  { key: 'ready', label: 'Ready' },
];

export default function ShopOrdersPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MobileTab>('waiting');
  const [view, setView] = useState<DesktopView>('table');
  const [search, setSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'unpaid'>('all');

  useEffect(() => {
    document.title = 'Orders · Printelyx';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: OrderRow[] }>(
        'GET',
        '/api/v1/shops/me/orders?limit=200',
      );
      if (r.status === 200 && r.data?.data) setOrders(r.data.data);
      else if (r.status === 401) setError('Session expired. Please log in again.');
      else setError('Could not load orders.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.token) return;
    void load();
  }, [api.token, load]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    const digits = q.replace(/\D/g, '');
    return orders.filter((o) => {
      if ((o.tokenNumber ?? '').toLowerCase().includes(q)) return true;
      if ((o.customerPhone ?? '').toLowerCase().includes(q)) return true;
      if (digits && (o.customerPhone ?? '').replace(/\D/g, '').includes(digits)) return true;
      return false;
    });
  }, [orders, search]);

  const mobileRows = useMemo(() => {
    switch (tab) {
      case 'waiting':
        return searched.filter((o) => o.status === 'awaiting_payment');
      case 'held':
        return []; // No held status exists in the order domain (see header).
      case 'printing':
        return searched.filter((o) => o.status === 'printing');
      case 'done':
        return searched.filter((o) => o.status === 'ready' || o.status === 'collected');
      default:
        return [];
    }
  }, [searched, tab]);

  const tableRows = useMemo(() => {
    const rows = [...searched].sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    );
    if (tableFilter === 'unpaid') return rows.filter((o) => o.status === 'awaiting_payment');
    return rows;
  }, [searched, tableFilter]);

  const buckets = useMemo(() => {
    const map: Record<Column, OrderRow[]> = { awaiting: [], queued: [], printing: [], ready: [] };
    for (const o of searched) {
      const c = bucketFor(o.status);
      if (c) map[c].push(o);
    }
    for (const k of Object.keys(map) as Column[]) {
      map[k].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    }
    return map;
  }, [searched]);

  const hiddenCount = useMemo(
    () => orders.filter((o) => o.status === 'cancelled' || o.status === 'refunded').length,
    [orders],
  );

  const counts = useMemo(
    () => ({
      waiting: orders.filter((o) => o.status === 'awaiting_payment').length,
      printing: orders.filter((o) => o.status === 'printing').length,
      done: orders.filter((o) => o.status === 'ready' || o.status === 'collected').length,
    }),
    [orders],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Orders</h1>
          <p className="text-sm text-[var(--label-2)]">
            {loading ? 'Loading…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
            {hiddenCount > 0 ? ` · ${hiddenCount} cancelled / refunded (table only)` : ''}
          </p>
        </div>
        <Link href="/shop/walk-in">
          <TintedButton>
            <Plus className="size-4" aria-hidden="true" /> Add walk-in
          </TintedButton>
        </Link>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}

      {/* Search */}
      <Input
        label="Search orders"
        value={search}
        onChange={setSearch}
        placeholder="Name, phone or code"
        hint="Search by phone number or the order code (e.g. A104)."
      />

      {/* ── Mobile list (< lg): segmented tabs ── */}
      <div className="flex flex-col gap-4 lg:hidden">
        <SegmentedControl
          ariaLabel="Order status filter"
          value={tab}
          onChange={(v) => setTab(v as MobileTab)}
          options={[
            { value: 'waiting', label: `Waiting ${counts.waiting}` },
            { value: 'held', label: 'Held' },
            { value: 'printing', label: `Printing ${counts.printing}` },
            { value: 'done', label: `Done ${counts.done}` },
          ]}
        />
        <Group padding="rows">
          {loading ? (
            <p className="px-1 py-4 text-sm text-[var(--label-2)]">Loading orders…</p>
          ) : tab === 'held' ? (
            <div className="px-1 py-4">
              <p className="text-[15px] font-medium text-[var(--label)]">No held orders</p>
              <p className="mt-1 text-sm text-[var(--label-2)]">
                Holding isn&apos;t a status the system tracks yet — there is
                no hold/unhold action, so nothing can sit here. Unpaid
                orders wait under Waiting instead.
              </p>
            </div>
          ) : mobileRows.length === 0 ? (
            <div className="px-1 py-4">
              <EmptyState
                icon={<ClipboardList className="size-7" />}
                title="No orders here"
                description={
                  tab === 'waiting'
                    ? 'No payments waiting for confirmation.'
                    : tab === 'printing'
                      ? 'Nothing printing right now.'
                      : 'No finished orders yet.'
                }
              />
            </div>
          ) : (
            mobileRows.map((o) => (
              <Link
                key={o.id}
                href={`/shop/orders/${o.id}`}
                className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-[var(--label)]">
                    {o.customerPhone ?? 'Walk-in'}, {formatINRFromPaise(o.totalAmountPaise)}
                  </span>
                  <span className="block truncate text-sm text-[var(--label-2)]">
                    Order {o.tokenNumber ?? o.customerToken} · {timeAgoShort(o.createdAt)}
                  </span>
                </span>
                <StatusPill status={pillStatus(o.status)} label={statusLabel(o.status)} />
              </Link>
            ))
          )}
        </Group>
      </div>

      {/* ── Desktop (>= lg): table / kanban toggle ── */}
      <div className="hidden flex-col gap-4 lg:flex">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            ariaLabel="Orders view"
            value={view}
            onChange={(v) => setView(v as DesktopView)}
            options={[
              { value: 'table', label: 'Table' },
              { value: 'kanban', label: 'Kanban' },
            ]}
          />
          {view === 'table' ? (
            <SegmentedControl
              ariaLabel="Table filter"
              value={tableFilter}
              onChange={(v) => setTableFilter(v as 'all' | 'unpaid')}
              options={[
                { value: 'all', label: 'All printers' },
                { value: 'unpaid', label: 'Unpaid' },
              ]}
            />
          ) : null}
        </div>

        {view === 'table' ? (
          <Group>
            {loading ? (
              <p className="text-sm text-[var(--label-2)]">Loading orders…</p>
            ) : tableRows.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="size-7" />}
                title="No orders found"
                description={
                  search
                    ? 'Nothing matches that search.'
                    : tableFilter === 'unpaid'
                      ? 'No unpaid orders.'
                      : 'Orders will appear here once customers order.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left">
                  <thead>
                    <tr className="text-xs text-[var(--label-2)]">
                      <th className="py-2 pr-2 font-medium">Customer</th>
                      <th className="py-2 pr-2 font-medium">Split</th>
                      <th className="py-2 pr-2 text-right font-medium">Total</th>
                      <th className="py-2 pr-2 font-medium">Printing on</th>
                      <th className="py-2 pr-2 font-medium">Status</th>
                      <th className="py-2 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((o) => (
                      <tr key={o.id} className="border-t border-[var(--hairline)]">
                        <td className="py-3 pr-2">
                          <Link
                            href={`/shop/orders/${o.id}`}
                            className="text-[15px] font-medium text-[var(--label)] hover:underline"
                          >
                            {o.customerPhone ?? 'Walk-in'}
                          </Link>
                          <span className="block text-xs text-[var(--label-2)]">
                            Order {o.tokenNumber ?? o.customerToken}
                          </span>
                        </td>
                        <td className="py-3 pr-2 text-sm text-[var(--label-2)]">—</td>
                        <td className="py-3 pr-2 text-right text-[15px] tabular-nums text-[var(--label)]">
                          {formatINRFromPaise(o.totalAmountPaise)}
                        </td>
                        <td className="py-3 pr-2 text-sm text-[var(--label-2)]">—</td>
                        <td className="py-3 pr-2">
                          <StatusPill status={pillStatus(o.status)} label={statusLabel(o.status)} />
                        </td>
                        <td className="py-3 text-sm text-[var(--label-2)]">
                          {timeAgoShort(o.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pt-3 text-xs leading-relaxed text-[var(--label-2)]">
                  Split and printer are “—” here: the order-list API returns
                  no per-file page split and no printer assignment. Open an
                  order to see its colour / B&amp;W split.
                </p>
              </div>
            )}
          </Group>
        ) : (
          <div className="grid grid-cols-4 items-start gap-3">
            {COLUMN_DEFS.map((col) => {
              const rows = buckets[col.key];
              return (
                <div
                  key={col.key}
                  className="rounded-[var(--radius-group)] bg-[var(--fill)] p-3"
                >
                  <div className="flex items-center justify-between px-1 pb-2">
                    <h2 className="text-sm font-semibold text-[var(--label)]">{col.label}</h2>
                    <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--label-2)]">
                      {rows.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {rows.length === 0 ? (
                      <p className="px-1 py-3 text-center text-sm text-[var(--label-2)]">
                        No orders
                      </p>
                    ) : (
                      rows.map((o) => (
                        <Link
                          key={o.id}
                          href={`/shop/orders/${o.id}`}
                          className="rounded-[var(--radius-input)] bg-[var(--surface)] p-3 shadow-sm hover:shadow"
                        >
                          <span className="block text-[15px] font-medium text-[var(--label)]">
                            {o.customerPhone ?? 'Walk-in'}, {formatINRFromPaise(o.totalAmountPaise)}
                          </span>
                          <span className="mt-0.5 block text-sm text-[var(--label-2)]">
                            Order {o.tokenNumber ?? o.customerToken} · {timeAgoShort(o.createdAt)}
                          </span>
                          <span className="mt-2 block">
                            <StatusPill status={pillStatus(o.status)} label={statusLabel(o.status)} />
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
