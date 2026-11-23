'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { usePoll } from '@/lib/hooks/use-poll';
import { PrintEXEOverview } from '@/components/portal/prinexe-overview';
import {
  Group,
  InsetList,
  InsetRow,
  ChevronRow,
  ValueRow,
  SwitchRow,
  Switch,
  StatusPill,
  Badge as ClearBadge,
  Chip,
  EmptyState as ClearEmptyState,
  ErrorState as ClearErrorState,
  Banner,
  PrimaryButton,
  TintedButton,
  DestructiveButton,
  TextButton,
  SkeletonBox,
  SkeletonCard,
} from '@/components/clear';
import { formatINRFromPaise } from '@platform/utils';
import { formatDate, timeAgo } from '@/lib/utils';
import {
  Loader2,
  Printer as PrinterIcon,
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  FileText,
  Inbox,
  Wifi,
  WifiOff,
  ShieldCheck,
  PackageCheck,
  XCircle,
  Check,
  Settings as SettingsIcon,
  QrCode,
  Plus,
  Terminal,
  Cpu,
  ArrowRight,
  Users,
  Wrench,
  ClipboardList,
  Phone,
  Home,
  CreditCard,
  Monitor,
  MoreHorizontal,
  AlertTriangle,
  ShoppingBag,
} from 'lucide-react';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { DeploymentOriginBanner } from '@/components/pwa/deployment-banner';
import {
  checkPrintLatchStatus,
} from '@/lib/printlatch/client';
import {
  checkNativePrinterStatus,
  getEnginePref,
  type PrintEngine,
} from '@/lib/native-printer/client';
import { toast } from 'sonner';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  address: string;
  phone: string;
  isActive: boolean;
  description: string | null;
  hasUpiQr?: boolean;
  servicesJson: string | null;
  paymentPhone: string | null;
  upiQrStorageKey: string | null;
}

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
  notes?: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
}

interface Analytics {
  revenue: { totalPaise: number; formatted: string };
  orderCount: { total: number; paid: number };
  byStatus: Record<string, number>;
}

/** One PrintDeliveryAttempt, joined with file + device names (P2-8). */
interface DeliveryRow {
  id: string;
  printJobId: string;
  orderId: string | null;
  fileName: string | null;
  deviceName: string | null;
  deliveryMode: string;
  status: string;
  attemptNumber: number;
  fileSize: number | null;
  checksum: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
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
  } catch { return false; }
}

export default function ShopDashboardPage() {
  const api = useApiClient();
  useEffect(() => { document.title = 'Dashboard · Printelyx'; }, []);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  // P2-8: delivery-attempt history (which device received which file).
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Printer-engine status for the "Choose your print engine" callout. The
  // shopkeeper picks between PrintLatch + Native Windows Printer on the
  // /shop/devices page; here we just surface whether they've picked yet.
  const [printerEngine, setPrinterEngine] = useState<PrintEngine | null | undefined>(undefined);
  const [printerConnected, setPrinterConnected] = useState(false);

  // ── R9: "Open for orders" + "Accepting new orders" switches ──
  // Presentation-only for now — the backend endpoint to toggle shop.isActive
  // (and a future "accepting new orders" flag) is a follow-up task. We persist
  // the toggle in localStorage so the shopkeeper's choice survives a refresh,
  // and seed the initial value from `shop.isActive` when the shop loads.
  const [shopOpen, setShopOpen] = useState(true);
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedOpen = window.localStorage.getItem('printshop:shop-open');
    const storedAccepting = window.localStorage.getItem('printshop:shop-accepting');
    if (storedOpen !== null) setShopOpen(storedOpen === '1');
    else if (shop) setShopOpen(Boolean(shop.isActive));
    if (storedAccepting !== null) setAcceptingOrders(storedAccepting === '1');
  }, [shop]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('printshop:shop-open', shopOpen ? '1' : '0');
  }, [shopOpen]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('printshop:shop-accepting', acceptingOrders ? '1' : '0');
  }, [acceptingOrders]);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [shopR, ordersR, analyticsR, agentsR, deliveriesR] = await Promise.all([
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        // H-1 / Live H-1 fix: fetch up to 200 orders (same window as the
        // Payments page) so the dashboard's all-time sales summary can be
        // derived from the SAME data source as Payments — instead of from
        // the analytics endpoint (which is entitlement-gated + returns 0s
        // for free-tier shops, causing the dashboard to contradict the
        // Payments page). Limit=50 was also too small to cover a busy
        // shop's history.
        api.request<{ data?: OrderRow[] }>('GET', '/api/v1/shops/me/orders?limit=200'),
        api.request<{ data?: Analytics }>('GET', '/api/v1/shops/me/analytics'),
        api.request<{ data?: AgentRow[] }>('GET', '/api/v1/shops/me/agents'),
        api.request<{ data?: DeliveryRow[] }>('GET', '/api/v1/shops/me/deliveries?limit=50'),
      ]);
      if (shopR.status === 200 && shopR.data?.data) setShop(shopR.data.data);
      if (ordersR.status === 200 && ordersR.data?.data) setOrders(ordersR.data.data);
      if (analyticsR.status === 200 && analyticsR.data?.data) setAnalytics(analyticsR.data.data);
      if (agentsR.status === 200 && agentsR.data?.data) setAgents(agentsR.data.data);
      if (deliveriesR.status === 200 && deliveriesR.data?.data) setDeliveries(deliveriesR.data.data);
      if (shopR.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (shopR.status >= 500) {
        setError('The server had a problem loading the dashboard. Try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  };

  // P2-5: was a bare setInterval that kept polling while the tab was hidden.
  useEffect(() => {
    void load();
    return undefined;
  }, []);
  usePoll(() => load(true), 15_000, { immediate: false });

  // Check the printer-engine status once on mount — surfaces the
  // "Choose your print engine" callout if the shopkeeper hasn't set up
  // a printer yet. Both checks are best-effort + run in parallel.
  useEffect(() => {
    let cancelled = false;
    const engine = getEnginePref();
    setPrinterEngine(engine);
    if (engine === 'printlatch') {
      checkPrintLatchStatus().then((s) => {
        if (!cancelled) setPrinterConnected(s.state === 'connected');
      });
    } else if (engine === 'native') {
      checkNativePrinterStatus().then((s) => {
        if (!cancelled) setPrinterConnected(s.state === 'connected');
      });
    }
    return () => { cancelled = true; };
  }, []);

  const todays = useMemo(() => {
    const todaysOrders = orders.filter((o) => isToday(o.createdAt));
    // Today's revenue = sum of order totals for orders that were PAID today
    // (paidAt falls on today's calendar date). This is what the shopkeeper
    // actually collected today — an order placed yesterday but paid this
    // morning counts toward today's revenue, not yesterday's.
    const paidToday = orders.filter((o) => o.paidAt && isToday(o.paidAt));
    const revenuePaise = paidToday.reduce((acc, o) => acc + o.totalAmountPaise, 0);
    return {
      total: todaysOrders.length,
      newOrders: todaysOrders.length,
      paidTodayCount: paidToday.length,
      awaitingPayment: todaysOrders.filter((o) => o.status === 'awaiting_payment').length,
      awaitingPrinting: todaysOrders.filter((o) => o.status === 'paid').length,
      printing: todaysOrders.filter((o) => o.status === 'printing').length,
      ready: todaysOrders.filter((o) => o.status === 'ready').length,
      completed: todaysOrders.filter((o) => o.status === 'collected').length,
      revenue: revenuePaise,
    };
  }, [orders]);

  // ── Queues ──
  const paymentQueue = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_payment'),
    [orders],
  );
  const readyQueue = useMemo(
    () => orders.filter((o) => o.status === 'ready'),
    [orders],
  );
  const printingQueue = useMemo(
    () => orders.filter((o) => o.status === 'printing'),
    [orders],
  );

  // ── "Did not print" heuristic ──
  // Any order in `printing` status that was placed > 10 minutes ago is
  // surfaced as a "needs you — did not print" chip on the dashboard. The
  // 10-minute threshold is the same budget the print-agent uses for its
  // first heartbeat retry, so an order that's still in `printing` past
  // that point genuinely needs a manual nudge.
  const stuckPrintCandidates = useMemo(() => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    return printingQueue.filter((o) => {
      try {
        return new Date(o.createdAt).getTime() < tenMinAgo;
      } catch {
        return false;
      }
    });
  }, [printingQueue]);

  // ── All-time sales summary ──
  // H-1 / Live H-1 fix: the dashboard previously read this from the
  // `/api/v1/shops/me/analytics` endpoint, which is entitlement-gated and
  // returns zeros on the free tier — causing the dashboard to contradict
  // the Payments page (which derives its numbers client-side from the
  // orders list). Now both pages derive from the SAME data source: the
  // up-to-200-orders window fetched above. Per the audit:
  //   total orders = orders.length
  //   paid orders  = orders.filter(o => o.paidAt !== null).length
  //   total revenue = sum of totalAmountPaise for paid orders
  // (`paidAt !== null` is the canonical "the money landed" signal —
  // a paid order with no paidAt is in-flight, not collected.)
  const allTimeSummary = useMemo(() => {
    const paidOrders = orders.filter((o) => o.paidAt !== null);
    const totalRevenuePaise = paidOrders.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );
    return {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      totalRevenuePaise,
    };
  }, [orders]);

  // ── Setup checklist ──
  const checklist = useMemo(() => {
    return [
      {
        key: 'profile',
        label: 'Shop profile filled',
        done: Boolean(shop?.name && shop?.address),
        href: '/shop/settings',
      },
      {
        key: 'services',
        label: 'Services selected',
        done: Boolean(shop?.servicesJson && shop.servicesJson !== '[]'),
        href: '/shop/settings',
      },
      {
        key: 'upi',
        label: 'UPI ID configured',
        done: Boolean(shop?.upiId),
        href: '/shop/settings',
      },
      {
        key: 'upi-qr',
        label: 'UPI QR uploaded',
        done: Boolean(shop?.hasUpiQr || shop?.upiQrStorageKey),
        href: '/shop/settings',
      },
    ];
  }, [shop]);
  const checklistDone = checklist.filter((c) => c.done).length;
  const checklistPct = (checklistDone / checklist.length) * 100;

  const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);
  const anyAgentOnline = agents.some((a) => a.isOnline);

  // ── Quick action: verify/reject payment ──
  const quickVerify = async (orderId: string, action: 'verify' | 'reject') => {
    setVerifyBusy(orderId);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/verify-payment`,
        { body: { action } },
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`;
        setActionError(msg);
        toast.error(
          action === 'verify' ? 'Could not verify payment' : 'Could not reject payment',
          { description: msg },
        );
        return;
      }
      // Success — give the shopkeeper clear feedback that the payment status
      // was updated. Without this, the order just silently disappears from
      // the queue (the `load(true)` refresh re-computes paymentQueue) and
      // the shopkeeper has no confirmation that the click landed.
      if (action === 'verify') {
        toast.success('✓ Payment verified', {
          description: 'Order marked as paid. The customer will see the update on their tracking page.',
        });
      } else {
        toast.success('Payment rejected', {
          description: 'Order marked as cancelled. The customer will see "rejected" on their tracking page.',
        });
      }
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setActionError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setVerifyBusy(null);
    }
  };

  // ── Quick action: mark ready ──
  const quickReady = async (orderId: string) => {
    setVerifyBusy(orderId);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/ready`,
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`;
        setActionError(msg);
        toast.error('Could not mark ready', { description: msg });
        return;
      }
      toast.success('✓ Marked ready for pickup', {
        description: 'The customer will see the update on their tracking page.',
      });
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setActionError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setVerifyBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <SkeletonBox className="h-9 w-32" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <ClearErrorState
          message={error}
          fix="Check your connection and try again. If the problem persists, your session may have expired."
          referenceCode="DASHBOARD_LOAD"
          onRetry={() => void load()}
        />
      </div>
    );
  }

  // ── R9 spec: KPIs as plain tiles ──
  // Orders today, Collected so far (revenue), Colour pages today.
  // Colour pages isn't directly tracked at the order level — we approximate
  // by counting today's orders whose file set includes a colour file. Since
  // the dashboard only loads the lightweight order row (no files), we fall
  // back to the analytics byStatus map if present.
  const colourPagesToday = analytics?.byStatus
    ? // No per-file colour count in the lightweight row — surface as "—"
      // until the analytics endpoint exposes a `colourPages` metric.
      null
    : null;

  // ── "Needs you" chips ──
  // Derived from live data: payment queue length, printer connectivity, and
  // any printing-status order that has been stuck for > 10 minutes (heuristic
  // for "did not print"). Each chip has a tinted action label that links to
  // the surface where the shopkeeper resolves it.
  const needsYou: Array<{
    key: string;
    label: string;
    action: string;
    href: string;
    tone: 'pending' | 'error' | 'printing';
  }> = [];
  if (paymentQueue.length > 0) {
    needsYou.push({
      key: 'payments',
      label: `${paymentQueue.length} payment${paymentQueue.length === 1 ? '' : 's'} to confirm`,
      action: 'Review',
      href: '/shop/payments',
      tone: 'pending',
    });
  }
  if (printerEngine !== undefined && !(printerEngine && printerConnected)) {
    needsYou.push({
      key: 'printer',
      label:
        printerEngine === null
          ? 'No printer connected'
          : 'Colour printer is offline',
      action: 'Fix',
      href: '/shop/devices',
      tone: 'error',
    });
  }
  if (stuckPrintCandidates.length > 0) {
    const o = stuckPrintCandidates[0];
    needsYou.push({
      key: 'reprint',
      label: `Order ${o.tokenNumber ?? o.customerToken} did not print`,
      action: 'Reprint',
      href: `/shop/orders/${o.id}`,
      tone: 'printing',
    });
  }

  const displayToken = (o: OrderRow) => o.tokenNumber ?? o.customerToken;

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-5 px-4 pb-24 pt-6 sm:px-6 lg:max-w-[920px] lg:space-y-6 lg:pb-10 lg:pt-8">
      {/* ── Title "Today" + slug + refresh ── */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)] sm:text-[32px]">
            Today
          </h1>
          <p className="mt-0.5 truncate text-sm text-[var(--label-2)]">
            {shop ? shop.name : 'Shop portal'}
            {shop?.slug ? <span className="text-[var(--label-3)]"> · {shop.slug}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh dashboard"
          className="inline-flex size-12 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] active:bg-[var(--fill)] disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-5" aria-hidden="true" />
          )}
        </button>
      </header>

      {/* Install-prompt + deployment-origin banners (kept from the original) */}
      <InstallPrompt />
      <DeploymentOriginBanner />

      {/* ── Printer-engine callout ── */}
      {printerEngine !== undefined && !(printerEngine && printerConnected) && (
        <Group padding="content" className="bg-[var(--accent-tint)]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--accent-tint-text)]">
              <PrinterIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[var(--accent-tint-text)]">
                {printerEngine === null
                  ? 'Choose your print engine'
                  : 'Finish setting up your printer'}
              </h2>
              <p className="mt-1 text-sm text-[var(--accent-tint-text)]/80">
                Pick PrintLatch (recommended, one-click installer) or the native Windows printer service.
              </p>
              <div className="mt-3">
                <Link
                  href="/shop/devices"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[15px] font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)]"
                >
                  {printerEngine === null ? 'Choose engine' : 'Finish setup'}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </Group>
      )}

      {/* ── R9: switches "Open for orders" / "Accepting new orders" ── */}
      {/* These are presentation-only for now — the backend endpoint to toggle
          shop.isActive + an "accepting new orders" flag is a future task.
          We persist the toggle in localStorage so the shopkeeper's choice
          survives a refresh. */}
      <Group padding="rows" title="Shop status">
        <InsetList>
          <SwitchRow label="Open for orders" subtitle="Customers can place new orders">
            <Switch
              checked={shopOpen}
              onChange={setShopOpen}
              aria-label="Open for orders"
            />
          </SwitchRow>
          <SwitchRow label="Accepting new orders" subtitle="Receive orders into the queue">
            <Switch
              checked={acceptingOrders}
              onChange={setAcceptingOrders}
              aria-label="Accepting new orders"
            />
          </SwitchRow>
        </InsetList>
      </Group>

      {/* ── R9: "Needs you" Group with chips ── */}
      <Group padding="rows" title="Needs you">
        {needsYou.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
            <CheckCircle2 className="size-6 text-[var(--success-text)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--label)]">All caught up</p>
            <p className="text-xs text-[var(--label-2)]">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <InsetList>
            {needsYou.map((n) => (
              <InsetRow
                key={n.key}
                label={n.label}
                trailing={
                  <Link
                    href={n.href}
                    className={[
                      'inline-flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs font-semibold',
                      n.tone === 'pending'
                        ? 'bg-[var(--warning-tint)] text-[var(--warning-text)]'
                        : n.tone === 'error'
                          ? 'bg-[var(--danger-tint)] text-[var(--danger-text)]'
                          : 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
                    ].join(' ')}
                  >
                    {n.action}
                  </Link>
                }
              />
            ))}
          </InsetList>
        )}
      </Group>

      {/* ── R9: KPI tiles ── */}
      <section
        className="grid grid-cols-3 gap-2 sm:gap-3"
        aria-label="Today's metrics"
      >
        <KpiTile
          label="Orders today"
          value={String(todays.total)}
          hint={`${todays.completed} collected`}
        />
        <KpiTile
          label="Collected so far"
          value={formatINRFromPaise(todays.revenue)}
          hint={`${todays.paidTodayCount} paid`}
        />
        <KpiTile
          label="Colour pages"
          value={colourPagesToday === null ? '—' : String(colourPagesToday)}
          hint="today"
        />
      </section>

      {/* PrintEXE device overview (kept) */}
      <PrintEXEOverview />

      {/* ── Payment queue ── */}
      <Group padding="rows" title="Payments to confirm">
        <InsetList>
          {paymentQueue.length === 0 ? (
            <InsetRow
              label="All caught up"
              subtitle="No orders are awaiting payment verification."
              trailing={
                <Link
                  href="/shop/payments"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-tint)] px-3 text-xs font-semibold text-[var(--accent-tint-text)]"
                >
                  Open
                </Link>
              }
            />
          ) : (
            paymentQueue.slice(0, 6).map((o) => (
              <InsetRow
                key={o.id}
                label={displayToken(o)}
                subtitle={`${o.customerPhone ?? 'no phone'} · ${timeAgo(o.createdAt)}`}
                trailing={
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                      {formatINRFromPaise(o.totalAmountPaise)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void quickVerify(o.id, 'verify')}
                      disabled={verifyBusy === o.id}
                      aria-label={`Verify payment for order ${displayToken(o)}`}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
                    >
                      {verifyBusy === o.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-3.5" aria-hidden="true" />
                      )}
                      Verify
                    </button>
                  </div>
                }
              />
            ))
          )}
          {paymentQueue.length > 6 && (
            <InsetRow
              label={`${paymentQueue.length - 6} more waiting`}
              trailing={
                <Link
                  href="/shop/payments"
                  className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--fill)] px-3 text-xs font-semibold text-[var(--label-2)]"
                >
                  See all
                </Link>
              }
            />
          )}
        </InsetList>
        {actionError && (
          <p className="px-4 pt-2 text-xs text-[var(--danger-text)]" role="alert">
            {actionError}
          </p>
        )}
      </Group>

      {/* ── Ready for pickup ── */}
      <Group padding="rows" title="Ready for pickup">
        {readyQueue.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--label-2)]">
            No orders ready for pickup yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 px-2 py-2 sm:grid-cols-3 lg:grid-cols-4">
            {readyQueue.slice(0, 12).map((o) => (
              <Link
                key={o.id}
                href={`/shop/orders/${o.id}`}
                className="flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-3 transition-colors hover:bg-[var(--fill)]"
              >
                <span className="font-mono text-xl font-bold tabular-nums tracking-tight text-[var(--label)]">
                  {displayToken(o)}
                </span>
                <span className="text-xs tabular-nums text-[var(--label-2)]">
                  {formatINRFromPaise(o.totalAmountPaise)} · {timeAgo(o.createdAt)}
                </span>
                {o.customerPhone && (
                  <span className="font-mono text-xs text-[var(--label-3)]">
                    {o.customerPhone}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </Group>

      {/* ── Currently printing (compact chips) ── */}
      {printingQueue.length > 0 && (
        <Group padding="rows" title="Currently printing">
          <div className="flex flex-wrap gap-2 px-2 py-2">
            {printingQueue.slice(0, 8).map((o) => (
              <Link
                key={o.id}
                href={`/shop/orders/${o.id}`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--fill)]"
              >
                <Loader2 className="size-3 animate-spin text-[var(--accent)]" aria-hidden="true" />
                <span className="font-mono font-semibold tabular-nums text-[var(--label)]">
                  {displayToken(o)}
                </span>
                <span className="text-xs tabular-nums text-[var(--label-2)]">
                  {formatINRFromPaise(o.totalAmountPaise)}
                </span>
              </Link>
            ))}
          </div>
        </Group>
      )}

      {/* ── Recent orders ── */}
      <Group padding="rows" title="Recent orders">
        {recentOrders.length === 0 ? (
          <ClearEmptyState
            icon={<Inbox className="size-6" aria-hidden="true" />}
            title="No orders yet"
            description="Share your QR code with customers so they can scan, upload, and pay directly to your UPI."
            action={{
              label: 'View shop QR',
              onClick: () => {
                window.location.href = '/shop/settings';
              },
            }}
          />
        ) : (
          <InsetList>
            {recentOrders.map((o) => (
              <InsetRow
                key={o.id}
                label={displayToken(o)}
                subtitle={`${o.customerPhone ?? 'Walk-in'} · ${timeAgo(o.createdAt)}`}
                trailing={
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                      {formatINRFromPaise(o.totalAmountPaise)}
                    </span>
                    <OrderRowStatusPill status={o.status} />
                  </div>
                }
                onClick={() => {
                  window.location.href = `/shop/orders/${o.id}`;
                }}
                chevron
              />
            ))}
          </InsetList>
        )}
      </Group>

      {/* ── Delivery history ── */}
      {deliveries.length > 0 && (
        <Group padding="rows" title="Delivery history">
          <InsetList>
            {deliveries.slice(0, 8).map((d) => (
              <InsetRow
                key={d.id}
                label={d.fileName ?? '(file removed)'}
                subtitle={`${d.deviceName ?? '—'} · ${d.deliveryMode}${
                  d.startedAt ? ` · ${timeAgo(d.startedAt)}` : ''
                }`}
                trailing={<DeliveryStatusPill status={d.status} />}
              />
            ))}
          </InsetList>
        </Group>
      )}

      {/* ── All-time summary + status breakdown ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Group padding="rows" title="All-time sales summary">
          <InsetList>
            <ValueRow label="Total orders" value={String(allTimeSummary.totalOrders)} />
            <ValueRow label="Paid orders" value={String(allTimeSummary.paidOrders)} />
            <ValueRow
              label="Total revenue"
              value={formatINRFromPaise(allTimeSummary.totalRevenuePaise)}
            />
          </InsetList>
        </Group>
        <Group padding="rows" title="Status breakdown">
          {analytics ? (
            <InsetList>
              {Object.entries(analytics.byStatus).map(([s, n]) => (
                <ValueRow
                  key={s}
                  label={s.replace(/_/g, ' ')}
                  value={String(n)}
                />
              ))}
            </InsetList>
          ) : (
            <p className="px-4 py-3 text-sm text-[var(--label-2)]">
              Analytics unavailable on this plan.
            </p>
          )}
        </Group>
      </div>

      {/* ── Agent banner ── */}
      <Group padding="content">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {anyAgentOnline ? (
              <Wifi className="size-5 text-[var(--success-text)]" aria-hidden="true" />
            ) : (
              <WifiOff className="size-5 text-[var(--label-2)]" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--label)]">
                {anyAgentOnline
                  ? 'Print agent online'
                  : 'No print agent connected'}
              </p>
              <p className="text-xs text-[var(--label-2)]">
                {agents.length === 0
                  ? 'No agents registered yet.'
                  : `${agents.length} agent(s) · ${agents.filter((a) => a.isOnline).length} online`}
              </p>
            </div>
          </div>
          <Link
            href="/shop/devices"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[15px] font-semibold text-[var(--label)] transition-colors hover:bg-[var(--fill)]"
          >
            <PrinterIcon className="size-4" aria-hidden="true" />
            {anyAgentOnline ? 'Manage' : 'Set up'}
          </Link>
        </div>
      </Group>

      {/* ── Quick actions ── */}
      <Group padding="rows" title="Quick actions">
        <InsetList>
          <ChevronRow label="Orders" icon={<ClipboardList className="size-5" />} onClick={() => { window.location.href = '/shop/orders'; }} />
          <ChevronRow label="Customers" icon={<Users className="size-5" />} onClick={() => { window.location.href = '/shop/customers'; }} />
          <ChevronRow label="Services & pricing" icon={<Wrench className="size-5" />} onClick={() => { window.location.href = '/shop/services'; }} />
          <ChevronRow label="Reports" icon={<FileText className="size-5" />} onClick={() => { window.location.href = '/shop/reports'; }} />
          <ChevronRow label="Settings" icon={<SettingsIcon className="size-5" />} onClick={() => { window.location.href = '/shop/settings'; }} />
          <ChevronRow label="Print agent" icon={<PrinterIcon className="size-5" />} onClick={() => { window.location.href = '/shop/devices'; }} />
        </InsetList>
      </Group>

      {/* ── R9: Bottom tab bar (mobile only) ── */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-[rgba(255,255,255,0.86)] backdrop-blur-lg lg:hidden safe-bottom"
      >
        <div className="mx-auto flex max-w-[640px] items-stretch justify-around">
          <BottomTab href="/shop/dashboard" label="Home" icon={<Home className="size-5" />} active />
          <BottomTab href="/shop/orders" label="Orders" icon={<ClipboardList className="size-5" />} />
          <BottomTab href="/shop/payments" label="Payments" icon={<CreditCard className="size-5" />} />
          <BottomTab href="/shop/devices" label="Printers" icon={<Monitor className="size-5" />} />
          <BottomTab href="/shop/settings" label="More" icon={<MoreHorizontal className="size-5" />} />
        </div>
      </nav>
    </div>
  );
}

// ── Local helper components ──────────────────────────────────────────────

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-[var(--radius-card)] bg-[var(--surface)] p-3 shadow-[var(--shadow-card)]"
    >
      <span className="text-xs font-medium text-[var(--label-2)]">{label}</span>
      <span className="text-lg font-bold tabular-nums leading-tight text-[var(--label)] sm:text-xl">
        {value}
      </span>
      {hint && <span className="text-xs text-[var(--label-3)]">{hint}</span>}
    </div>
  );
}

function BottomTab({
  href,
  label,
  icon,
  active = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-h-[48px]',
        'text-[10px] font-medium transition-colors',
        active ? 'text-[var(--accent)]' : 'text-[var(--label-2)]',
      ].join(' ')}
    >
      <span className="inline-flex" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

/** Maps an order status string to a Clear StatusPill (lifecycle view). */
function OrderRowStatusPill({ status }: { status: string }) {
  const map: Record<string, 'pending' | 'printing' | 'ready' | 'collected' | 'error'> = {
    awaiting_payment: 'pending',
    paid: 'pending',
    printing: 'printing',
    ready: 'ready',
    collected: 'collected',
    cancelled: 'error',
    refunded: 'error',
  };
  const s = map[status] ?? 'pending';
  const labelOverride: Record<string, string> = {
    awaiting_payment: 'Awaiting payment',
    paid: 'Paid',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };
  return <StatusPill status={s} label={labelOverride[status]} />;
}

/** Maps a delivery attempt status to a Clear StatusPill. */
function DeliveryStatusPill({ status }: { status: string }) {
  const map: Record<string, { s: 'pending' | 'printing' | 'ready' | 'collected' | 'error'; label: string }> = {
    created: { s: 'pending', label: 'Queued' },
    dispatched: { s: 'printing', label: 'Sent' },
    received: { s: 'collected', label: 'Received' },
    failed: { s: 'error', label: 'Failed' },
    expired: { s: 'error', label: 'Expired' },
  };
  const m = map[status] ?? { s: 'pending' as const, label: status };
  return <StatusPill status={m.s} label={m.label} />;
}
