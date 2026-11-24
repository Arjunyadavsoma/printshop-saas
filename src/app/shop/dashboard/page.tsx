'use client';

/**
 * /shop/dashboard — spec screen 21: Today (shopkeeper home).
 *
 * Clear ShopShell provides the chrome (desktop sidebar / mobile 5-tab
 * bottom nav); this page renders only its content — no `.ref-screen`.
 *
 * Data (all real, no demo fallback — an empty shop shows real zeros):
 *   - Shop name + server `isActive`: GET /api/v1/shops/me
 *   - Orders: GET /api/v1/shops/me/orders?limit=200
 *   - Printer agents: GET /api/v1/shops/me/agents
 *   - Page counts: GET /api/v1/shops/me/analytics (best-effort; the
 *     order list carries no per-page data, so B&W/colour pages come from
 *     here and show "—" when analytics is unavailable)
 *
 * Toggles — honest limitation: there is NO owner endpoint that writes
 * `isActive` (PATCH /api/v1/shops/me accepts name/upiId/pricingConfig/
 * address/phone/… but not isActive), and no "accepting new orders"
 * field exists on the shop at all. Both switches therefore read the
 * server state for their initial value and persist changes on this
 * device only (localStorage, same keys the old layout used). The caption
 * under the card says so plainly. Wiring a real server toggle needs
 * `isActive` added to the PATCH schema — a one-line API change, not a
 * page change.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  Switch,
  StatusPill,
  PrimaryButton,
  TintedButton,
  EmptyState,
} from '@/components/clear';
import { ClipboardList, Printer, CreditCard, Plus, Inbox } from 'lucide-react';

const OPEN_KEY = 'printshop:shop-open';
const ACCEPTING_KEY = 'printshop:shop-accepting';

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

interface AgentRow {
  id: string;
  name: string;
  isOnline: boolean;
  isEnabled: boolean;
  printerName?: string | null;
}

interface Analytics {
  popular?: { color?: number; bw?: number };
}

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch {
    return false;
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

function statusPillStatus(
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

export default function ShopDashboardPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(true);
  const [accepting, setAccepting] = useState(true);

  useEffect(() => {
    document.title = 'Today · Printelyx';
  }, []);

  // Restore device-local toggle values; the server value (isActive) seeds
  // `open` on first load when nothing is stored yet.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedOpen = window.localStorage.getItem(OPEN_KEY);
    if (storedOpen !== null) setOpen(storedOpen === '1');
    const storedAccepting = window.localStorage.getItem(ACCEPTING_KEY);
    if (storedAccepting !== null) setAccepting(storedAccepting === '1');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }, [open]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCEPTING_KEY, accepting ? '1' : '0');
  }, [accepting]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shopR, ordersR, agentsR, analyticsR] = await Promise.all([
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        api.request<{ data?: OrderRow[] }>('GET', '/api/v1/shops/me/orders?limit=200'),
        api.request<{ data?: AgentRow[] }>('GET', '/api/v1/shops/me/agents'),
        api.request<{ data?: Analytics }>('GET', '/api/v1/shops/me/analytics'),
      ]);
      if (shopR.status === 200 && shopR.data?.data) {
        setShop(shopR.data.data);
        if (typeof window !== 'undefined' && window.localStorage.getItem(OPEN_KEY) === null) {
          setOpen(Boolean(shopR.data.data.isActive));
        }
      }
      if (ordersR.status === 200 && ordersR.data?.data) setOrders(ordersR.data.data);
      else if (ordersR.status === 401) setError('Session expired. Please log in again.');
      if (agentsR.status === 200 && agentsR.data?.data) setAgents(agentsR.data.data);
      if (analyticsR.status === 200 && analyticsR.data?.data) setAnalytics(analyticsR.data.data);
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

  // ── Derived metrics (real data only) ──
  const paymentQueue = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_payment'),
    [orders],
  );
  const todaysOrders = useMemo(() => orders.filter((o) => isToday(o.createdAt)), [orders]);
  const collectedTodayPaise = useMemo(
    () =>
      todaysOrders
        .filter((o) => o.paidAt !== null)
        .reduce((acc, o) => acc + o.totalAmountPaise, 0),
    [todaysOrders],
  );
  const stuckPrinting = useMemo(() => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    return orders.filter(
      (o) => o.status === 'printing' && new Date(o.createdAt).getTime() < tenMinAgo,
    );
  }, [orders]);
  const offlineAgents = useMemo(
    () => agents.filter((a) => a.isEnabled && !a.isOnline),
    [agents],
  );
  const nextInQueue = useMemo(() => {
    const queued = orders.filter((o) => o.status === 'paid' || o.status === 'awaiting_payment');
    queued.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return queued.slice(0, 5);
  }, [orders]);
  const alertsEmpty =
    paymentQueue.length === 0 && offlineAgents.length === 0 && stuckPrinting.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Today</h1>
          <p className="text-sm text-[var(--label-2)]">
            {shop ? shop.name : 'Your shop'} · Manage orders, payments and printers.
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

      {/* Toggles */}
      <Group title="Shop status">
        <div className="flex flex-col gap-1">
          <div className="flex min-h-[48px] items-center justify-between gap-3">
            <span className="text-[15px] text-[var(--label)]">Open for orders</span>
            <Switch checked={open} onChange={setOpen} aria-label="Open for orders" />
          </div>
          <div className="flex min-h-[48px] items-center justify-between gap-3 border-t border-[var(--hairline)] pt-1">
            <span className="text-[15px] text-[var(--label)]">Accepting new orders</span>
            <Switch checked={accepting} onChange={setAccepting} aria-label="Accepting new orders" />
          </div>
          <p className="pt-1 text-xs leading-relaxed text-[var(--label-2)]">
            These switches are saved on this device only. The server has no
            owner endpoint to change your shop&apos;s open state yet, so
            turning them off does not close your shop online — it only
            changes what this screen shows.
            {shop ? ` Server state: ${shop.isActive ? 'open' : 'closed'}.` : ''}
          </p>
        </div>
      </Group>

      {/* Alerts */}
      <Group title="Needs you">
        {loading ? (
          <p className="text-sm text-[var(--label-2)]">Checking…</p>
        ) : alertsEmpty ? (
          <p className="text-sm text-[var(--label-2)]">
            All clear — no payments to confirm, no printer problems, no stuck prints.
          </p>
        ) : (
          <ul className="flex flex-col">
            {paymentQueue.length > 0 ? (
              <li>
                <Link
                  href="/shop/payments"
                  className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[var(--hairline)] py-1 text-[15px] text-[var(--label)]"
                >
                  <span className="flex items-center gap-2">
                    <CreditCard className="size-4 text-[var(--label-2)]" aria-hidden="true" />
                    {paymentQueue.length} payment{paymentQueue.length === 1 ? '' : 's'} to confirm
                  </span>
                  <span className="rounded-full bg-[var(--warning-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning-text)]">
                    Review
                  </span>
                </Link>
              </li>
            ) : null}
            {agents.length === 0 ? (
              <li>
                <Link
                  href="/shop/devices"
                  className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[var(--hairline)] py-1 text-[15px] text-[var(--label)]"
                >
                  <span className="flex items-center gap-2">
                    <Printer className="size-4 text-[var(--label-2)]" aria-hidden="true" />
                    No printer connected yet
                  </span>
                  <span className="rounded-full bg-[var(--danger-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--danger-text)]">
                    Fix
                  </span>
                </Link>
              </li>
            ) : (
              offlineAgents.map((a) => (
                <li key={a.id}>
                  <Link
                    href="/shop/devices"
                    className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[var(--hairline)] py-1 text-[15px] text-[var(--label)]"
                  >
                    <span className="flex items-center gap-2">
                      <Printer className="size-4 text-[var(--label-2)]" aria-hidden="true" />
                      {a.printerName ?? a.name} is offline
                    </span>
                    <span className="rounded-full bg-[var(--danger-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--danger-text)]">
                      Fix
                    </span>
                  </Link>
                </li>
              ))
            )}
            {stuckPrinting.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/shop/orders/${o.id}`}
                  className="flex min-h-[48px] items-center justify-between gap-3 py-1 text-[15px] text-[var(--label)]"
                >
                  <span className="flex items-center gap-2">
                    <ClipboardList className="size-4 text-[var(--label-2)]" aria-hidden="true" />
                    Order {o.tokenNumber ?? o.customerToken} did not print
                  </span>
                  <span className="rounded-full bg-[var(--danger-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--danger-text)]">
                    Reprint
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Group>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Group>
          <p className="text-xs text-[var(--label-2)]">Orders today</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : todaysOrders.length}
          </p>
        </Group>
        <Group>
          <p className="text-xs text-[var(--label-2)]">Collected so far</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : formatINRFromPaise(collectedTodayPaise)}
          </p>
        </Group>
        <Group>
          <p className="text-xs text-[var(--label-2)]">B&amp;W pages</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : (analytics?.popular?.bw ?? '—')}
          </p>
        </Group>
        <Group>
          <p className="text-xs text-[var(--label-2)]">Colour pages</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : (analytics?.popular?.color ?? '—')}
          </p>
        </Group>
      </div>
      <p className="-mt-1 text-xs text-[var(--label-2)]">
        Page counts come from the analytics endpoint, which has no per-day
        breakdown — if it is unavailable the page figures show “—” rather
        than a guessed number.
      </p>

      {/* Next in queue */}
      <Group title="Next in queue">
        {loading ? (
          <p className="text-sm text-[var(--label-2)]">Loading orders…</p>
        ) : nextInQueue.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-7" />}
            title="Nothing in the queue"
            description="New orders will appear here once customers pay."
            action={{ label: 'Add a walk-in order', onClick: () => { window.location.href = '/shop/walk-in'; } }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="text-xs text-[var(--label-2)]">
                  <th className="py-2 pr-2 font-medium">Customer</th>
                  <th className="py-2 pr-2 font-medium">Total</th>
                  <th className="py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {nextInQueue.map((o) => (
                  <tr key={o.id} className="border-t border-[var(--hairline)]">
                    <td className="py-3 pr-2">
                      <Link
                        href={`/shop/orders/${o.id}`}
                        className="text-[15px] font-medium text-[var(--label)] hover:underline"
                      >
                        {o.customerPhone ?? 'Walk-in'} · {o.tokenNumber ?? o.customerToken}
                      </Link>
                    </td>
                    <td className="py-3 pr-2 text-[15px] tabular-nums text-[var(--label)]">
                      {formatINRFromPaise(o.totalAmountPaise)}
                    </td>
                    <td className="py-3 pr-2">
                      <StatusPill status={statusPillStatus(o.status)} label={statusLabel(o.status)} />
                    </td>
                    <td className="py-3 text-sm text-[var(--label-2)]">{timeAgoShort(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Link href="/shop/orders">
            <TintedButton>See all orders</TintedButton>
          </Link>
        </div>
      </Group>

      <div className="flex justify-center pb-2 lg:hidden">
        <Link href="/shop/walk-in">
          <PrimaryButton>
            <Plus className="size-4" aria-hidden="true" /> Add walk-in
          </PrimaryButton>
        </Link>
      </div>
    </div>
  );
}
