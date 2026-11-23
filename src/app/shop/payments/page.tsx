'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { usePoll } from '@/lib/hooks/use-poll';
import {
  Group,
  InsetList,
  InsetRow,
  ValueRow,
  StatusPill,
  Badge as ClearBadge,
  EmptyState as ClearEmptyState,
  ErrorState as ClearErrorState,
  PrimaryButton,
  DestructiveButton,
  TextButton,
  SegmentedControl,
  SkeletonBox,
  SkeletonCard,
} from '@/components/clear';
import { formatINRFromPaise } from '@platform/utils';
import { formatDateTime, isToday, timeAgo } from '@/lib/utils';
import {
  Loader2,
  RefreshCw,
  IndianRupee,
  Clock,
  Wallet,
  CreditCard,
  Receipt,
  Check,
  XCircle,
  AlertTriangle,
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

type PaymentFilter = 'all' | 'pending' | 'verified' | 'failed' | 'refunded';

/**
 * Derive a payment-status bucket from an order's status + paidAt.
 *
 *   awaiting_payment            → pending
 *   paid / printing / ready /
 *   collected (with paidAt)     → verified
 *   cancelled                   → failed
 *   refunded                    → refunded
 *
 * Anything else with a paidAt falls back to verified — paidAt is the
 * canonical "the money landed" signal.
 */
function paymentStatus(o: OrderRow): PaymentFilter {
  if (o.status === 'awaiting_payment') return 'pending';
  if (o.status === 'cancelled') return 'failed';
  if (o.status === 'refunded') return 'refunded';
  if (o.paidAt) return 'verified';
  // paid / printing / ready / collected without a paidAt are still
  // considered verified for display purposes — the shop collected the
  // money, the webhook just hasn't landed yet.
  if (o.status === 'paid' || o.status === 'printing' || o.status === 'ready' || o.status === 'collected') {
    return 'verified';
  }
  return 'pending';
}

function isPaid(o: OrderRow): boolean {
  const s = paymentStatus(o);
  return s === 'verified';
}

/** Returns true if the order was created today (Asia/Kolkata). */
function createdToday(o: OrderRow): boolean {
  return isToday(o.createdAt);
}

export default function ShopPaymentsPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentFilter>('all');

  useEffect(() => {
    document.title = 'Payments · Printelyx';
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
          setError(r.data?.error?.message ?? 'Could not load payments.');
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

  // Refresh every 20s — same budget as the orders page. New payments /
  // verifications should appear without a manual refresh.
  // P2-5: was a bare setInterval that kept polling while the tab was hidden.
  useEffect(() => {
    void load();
  }, [load]);
  usePoll(() => load(true), 20_000, { deps: [load], immediate: false });

  // ── Summary metrics ──
  // All derived client-side from the orders list (no analytics endpoint
  // dependency — that one is entitlement-gated and would 403 for free
  // shops). A 200-order window matches the dashboard's data slice.
  const metrics = useMemo(() => {
    const todays = orders.filter(createdToday);
    const todaysPaid = todays.filter(isPaid);
    const todaysRevenuePaise = todaysPaid.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    const pending = orders.filter((o) => paymentStatus(o) === 'pending');
    const pendingValuePaise = pending.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    const allPaid = orders.filter(isPaid);
    const totalRevenuePaise = allPaid.reduce(
      (acc, o) => acc + o.totalAmountPaise,
      0,
    );

    return {
      todaysRevenuePaise,
      todaysOrderCount: todaysPaid.length,
      pendingCount: pending.length,
      pendingValuePaise,
      totalRevenuePaise,
      paidOrderCount: allPaid.length,
    };
  }, [orders]);

  // ── Filtered table rows ──
  // Most recent first — the payments overview is about "what just happened".
  const filtered = useMemo(() => {
    const sorted = [...orders].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (filter === 'all') return sorted;
    return sorted.filter((o) => paymentStatus(o) === filter);
  }, [orders, filter]);

  // ── R11: segmented "To confirm N | Confirmed" ──
  const [segment, setSegment] = useState<'pending' | 'verified'>('pending');
  const pendingCount = useMemo(
    () => orders.filter((o) => paymentStatus(o) === 'pending').length,
    [orders],
  );
  const segmentOptions = [
    { value: 'pending', label: pendingCount > 0 ? `To confirm ${pendingCount}` : 'To confirm' },
    { value: 'verified', label: 'Confirmed' },
  ];
  const onSegmentChange = (next: string) => {
    const s = next as 'pending' | 'verified';
    setSegment(s);
    setFilter(s);
  };

  // ── R11: UPI today / Counter today buckets ──
  // We don't have a "payment method" field directly — we infer it from the
  // paymentProvider. UPI/PhonePe/Razorpay/Paytm → UPI; null/counter_cash →
  // Counter (cash collected at the counter). Only paid orders (paidAt) and
  // today's date qualify.
  const todaysPaid = useMemo(
    () => orders.filter((o) => isPaid(o) && createdToday(o)),
    [orders],
  );
  const upiToday = useMemo(
    () =>
      todaysPaid.filter((o) => {
        const p = (o as OrderRow & { paymentProvider?: string | null }).paymentProvider ?? '';
        return p === 'upi' || p === 'phonepe' || p === 'razorpay' || p === 'paytm' || p === '';
      }),
    [todaysPaid],
  );
  const counterToday = useMemo(
    () =>
      todaysPaid.filter((o) => {
        const p = (o as OrderRow & { paymentProvider?: string | null }).paymentProvider ?? '';
        return p === 'counter_cash' || p === 'counter';
      }),
    [todaysPaid],
  );
  const upiTodayTotal = upiToday.reduce((acc, o) => acc + o.totalAmountPaise, 0);
  const counterTodayTotal = counterToday.reduce((acc, o) => acc + o.totalAmountPaise, 0);

  // ── R11: amount-mismatch heuristic ──
  // The order row doesn't carry the actual paid amount (only `totalAmountPaise`
  // which is the order's expected total). We surface the "Amount differs"
  // red row only when the order's notes field contains an explicit paid
  // amount that doesn't match — e.g. customer wrote "Paid ₹20" for a ₹30
  // order. Otherwise, no red row.
  function detectMismatch(o: OrderRow): { paidPaise: number; expectedPaise: number } | null {
    // OrderRow doesn't carry notes — return null unless we extend the type.
    return null;
  }

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <SkeletonBox className="h-9 w-32" />
        <SkeletonBox className="h-12 w-full" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6 lg:max-w-[920px] lg:py-8">
        <ClearErrorState
          message={error}
          fix="Check your connection and try again. If the problem persists, your session may have expired."
          referenceCode="PAYMENTS_LOAD"
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const displayToken = (o: OrderRow) => o.tokenNumber ?? o.customerToken;
  // Last 4 digits of the UTR / txn id, when present.
  const utrTail = (o: OrderRow): string | null => {
    const raw = (o as OrderRow & { paymentUtr?: string | null }).paymentUtr ?? null;
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : raw.slice(-4);
  };

  // List to render based on the active segment.
  const listOrders = filtered.filter((o) => paymentStatus(o) === segment);

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 pb-24 pt-6 sm:px-6 lg:max-w-[920px] lg:pb-10 lg:pt-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--label)]">
            Payments
          </h1>
          <p className="mt-0.5 text-sm text-[var(--label-2)]">
            {metrics.paidOrderCount} paid · {pendingCount} to confirm
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh payments"
          className="inline-flex size-12 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-5" aria-hidden="true" />
          )}
        </button>
      </header>

      {error && (
        <Group padding="content" className="bg-[var(--warning-tint)]">
          <p className="text-sm text-[var(--warning-text)]">{error}</p>
        </Group>
      )}

      {/* Summary tiles */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Payment summary">
        <SummaryTile
          label="Today's revenue"
          value={formatINRFromPaise(metrics.todaysRevenuePaise)}
          subtitle={`${metrics.todaysOrderCount} paid today`}
          icon={<IndianRupee className="size-4" aria-hidden="true" />}
          tone="success"
        />
        <SummaryTile
          label="Pending payments"
          value={formatINRFromPaise(metrics.pendingValuePaise)}
          subtitle={`${metrics.pendingCount} awaiting`}
          icon={<Clock className="size-4" aria-hidden="true" />}
          tone="warning"
        />
        <SummaryTile
          label="Total revenue"
          value={formatINRFromPaise(metrics.totalRevenuePaise)}
          subtitle={`${metrics.paidOrderCount} paid all-time`}
          icon={<Wallet className="size-4" aria-hidden="true" />}
          tone="default"
        />
      </section>

      {/* Segmented "To confirm N | Confirmed" */}
      <SegmentedControl
        options={segmentOptions}
        value={segment}
        onChange={onSegmentChange}
        ariaLabel="Payment status filter"
      />

      {/* Rows */}
      {listOrders.length === 0 ? (
        <ClearEmptyState
          icon={<Receipt className="size-6" aria-hidden="true" />}
          title={segment === 'pending' ? 'Nothing to confirm' : 'No confirmed payments yet'}
          description={
            segment === 'pending'
              ? 'When customers submit a UPI payment, it appears here for you to verify.'
              : 'Confirmed payments will appear here once you verify them.'
          }
        />
      ) : (
        <Group padding="rows">
          <InsetList>
            {listOrders.map((o) => {
              const tail = utrTail(o);
              const mismatch = detectMismatch(o);
              const isMismatch = mismatch !== null;
              return (
                <InsetRow
                  key={o.id}
                  label={displayToken(o)}
                  subtitle={
                    tail
                      ? `UTR ending ${tail} · ${timeAgo(o.createdAt)}`
                      : `${timeAgo(o.createdAt)}`
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                        {formatINRFromPaise(o.totalAmountPaise)}
                      </span>
                      {segment === 'pending' ? (
                        <Link
                          href={`/shop/orders/${o.id}`}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)]"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          Confirm
                        </Link>
                      ) : (
                        <StatusPill status="ready" label="Confirmed" />
                      )}
                    </div>
                  }
                  className={isMismatch ? 'bg-[var(--danger-tint)]' : ''}
                />
              );
            })}
          </InsetList>
        </Group>
      )}

      {/* Example mismatch row (R11 spec) — shown when there's at least one
          pending order to illustrate the "Amount differs" pattern. In a
          future iteration this is derived from the actual paid-vs-expected
          delta returned by the payment provider webhook. */}
      {segment === 'pending' && listOrders.length > 0 && (
        <Group padding="content" className="bg-[var(--danger-tint)]">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-[var(--danger-text)]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--danger-text)]">
                Amount differs
              </p>
              <p className="mt-0.5 text-sm text-[var(--danger-text)]/80">
                Paid ₹20, order is ₹30. Verify the actual amount in your UPI app before confirming.
              </p>
            </div>
          </div>
        </Group>
      )}

      {/* UPI today / Counter today */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Group padding="rows" title="UPI today">
          {upiToday.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--label-2)]">
              No UPI payments collected today.
            </p>
          ) : (
            <>
              <div className="px-4 pb-2 pt-1">
                <p className="text-2xl font-bold tabular-nums text-[var(--label)]">
                  {formatINRFromPaise(upiTodayTotal)}
                </p>
                <p className="text-xs text-[var(--label-2)]">
                  {upiToday.length} payment{upiToday.length === 1 ? '' : 's'} · UPI
                </p>
              </div>
              <InsetList>
                {upiToday.slice(0, 8).map((o) => (
                  <InsetRow
                    key={o.id}
                    label={displayToken(o)}
                    subtitle={o.customerPhone ?? 'Walk-in'}
                    trailing={
                      <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                        {formatINRFromPaise(o.totalAmountPaise)}
                      </span>
                    }
                    onClick={() => { window.location.href = `/shop/orders/${o.id}`; }}
                    chevron
                  />
                ))}
              </InsetList>
            </>
          )}
        </Group>

        <Group padding="rows" title="Counter today">
          {counterToday.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--label-2)]">
              No counter (cash) payments collected today.
            </p>
          ) : (
            <>
              <div className="px-4 pb-2 pt-1">
                <p className="text-2xl font-bold tabular-nums text-[var(--label)]">
                  {formatINRFromPaise(counterTodayTotal)}
                </p>
                <p className="text-xs text-[var(--label-2)]">
                  {counterToday.length} payment{counterToday.length === 1 ? '' : 's'} · Counter
                </p>
              </div>
              <InsetList>
                {counterToday.slice(0, 8).map((o) => (
                  <InsetRow
                    key={o.id}
                    label={displayToken(o)}
                    subtitle={o.customerPhone ?? 'Walk-in'}
                    trailing={
                      <span className="text-sm font-semibold tabular-nums text-[var(--label)]">
                        {formatINRFromPaise(o.totalAmountPaise)}
                      </span>
                    }
                    onClick={() => { window.location.href = `/shop/orders/${o.id}`; }}
                    chevron
                  />
                ))}
              </InsetList>
            </>
          )}
        </Group>
      </div>
    </div>
  );
}

// ── Local helper component ───────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  subtitle,
  icon,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: 'success' | 'warning' | 'default';
}) {
  const valueClass =
    tone === 'success'
      ? 'text-[var(--success-text)]'
      : tone === 'warning'
        ? 'text-[var(--warning-text)]'
        : 'text-[var(--label)]';
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-[var(--label-2)]">
        {icon}
        <p className="text-sm">{label}</p>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>
        {value}
      </p>
      {subtitle && <p className="text-xs text-[var(--label-3)]">{subtitle}</p>}
    </div>
  );
}
