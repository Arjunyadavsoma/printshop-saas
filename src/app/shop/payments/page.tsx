'use client';

/**
 * /shop/payments — spec screen 25.
 *
 * Clear ShopShell provides the chrome; this page renders only content.
 *
 * Data: GET /api/v1/shops/me/orders?limit=200. Payment status is derived
 * from order status + paidAt (same rule the old page used).
 *
 * Actions (all real):
 *   - Confirm per payment → POST /api/v1/shops/me/orders/{id}/confirm-payment
 *     { action: 'confirm', method: 'upi' } (inline, no navigation needed).
 *   - Confirm all (desktop) → confirms every pending row, one call each,
 *     then reloads; failures are reported per-order.
 *   - "Amount differs": NOT implemented — the order record carries no
 *     paid-amount field (only the order total + the UTR), so a mismatch
 *     cannot be detected from the API. The footnote says so, and the
 *     Confirm flow asks the shopkeeper to check the amount in their UPI
 *     app first. Adding mismatch detection needs a payments ledger with
 *     the amount actually received.
 *
 * Summary heuristic (same as before): paid-today orders WITH a UTR count
 * as UPI; paid-today orders WITHOUT one count as counter.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  SegmentedControl,
  TintedButton,
  PrimaryButton,
  EmptyState,
} from '@/components/clear';
import { CreditCard, Check, CheckCheck } from 'lucide-react';

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
  paymentUtr?: string | null;
}

type PayStatus = 'pending' | 'verified' | 'failed' | 'refunded';

function paymentStatus(o: OrderRow): PayStatus {
  if (o.status === 'awaiting_payment') return 'pending';
  if (o.status === 'cancelled') return 'failed';
  if (o.status === 'refunded') return 'refunded';
  return 'verified';
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

export default function ShopPaymentsPage() {
  const api = useApiClient();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'verified'>('pending');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Payments · Printelyx';
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
      else setError('Could not load payments.');
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

  const pending = useMemo(
    () =>
      orders
        .filter((o) => paymentStatus(o) === 'pending')
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [orders],
  );
  const verified = useMemo(
    () =>
      orders
        .filter((o) => paymentStatus(o) === 'verified')
        .sort((a, b) => +new Date(b.paidAt ?? b.createdAt) - +new Date(a.paidAt ?? a.createdAt)),
    [orders],
  );

  const summary = useMemo(() => {
    const todayPaid = orders.filter((o) => o.paidAt !== null && isToday(o.paidAt));
    const upiPaise = todayPaid
      .filter((o) => Boolean(o.paymentUtr))
      .reduce((acc, o) => acc + o.totalAmountPaise, 0);
    const counterPaise = todayPaid
      .filter((o) => !o.paymentUtr)
      .reduce((acc, o) => acc + o.totalAmountPaise, 0);
    const unpaidReady = orders.filter(
      (o) => (o.status === 'ready' || o.status === 'collected') && o.paidAt === null,
    ).length;
    return { upiPaise, counterPaise, unpaidReady };
  }, [orders]);

  const confirmOne = useCallback(
    async (o: OrderRow) => {
      setConfirmingId(o.id);
      setActionError(null);
      setActionOk(null);
      try {
        const r = await api.request<{ error?: { message?: string } }>(
          'POST',
          `/api/v1/shops/me/orders/${o.id}/confirm-payment`,
          { body: { action: 'confirm', method: 'upi' } },
        );
        if (r.status >= 400) {
          setActionError(r.data?.error?.message ?? `Could not confirm (HTTP ${r.status}).`);
          return;
        }
        setActionOk(`Confirmed ${formatINRFromPaise(o.totalAmountPaise)} for ${o.customerPhone ?? 'the customer'}.`);
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setConfirmingId(null);
      }
    },
    [api, load],
  );

  const confirmAll = useCallback(async () => {
    if (pending.length === 0) return;
    setConfirmingAll(true);
    setActionError(null);
    setActionOk(null);
    const failures: string[] = [];
    for (const o of pending) {
      try {
        const r = await api.request<{ error?: { message?: string } }>(
          'POST',
          `/api/v1/shops/me/orders/${o.id}/confirm-payment`,
          { body: { action: 'confirm', method: 'upi' } },
        );
        if (r.status >= 400) failures.push(o.tokenNumber ?? o.id);
      } catch {
        failures.push(o.tokenNumber ?? o.id);
      }
    }
    await load();
    setConfirmingAll(false);
    if (failures.length === 0) {
      setActionOk(`Confirmed all ${pending.length} payment${pending.length === 1 ? '' : 's'}.`);
    } else {
      setActionError(
        `Could not confirm ${failures.length} payment${failures.length === 1 ? '' : 's'}: ${failures.join(', ')}. The rest were confirmed.`,
      );
    }
  }, [api, pending, load]);

  const rows = tab === 'pending' ? pending : verified;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Payments</h1>
          <p className="text-sm text-[var(--label-2)]">
            Confirm UPI payments against the UTR the customer entered.
          </p>
        </div>
        {pending.length > 0 ? (
          <div className="hidden md:block">
            <TintedButton disabled={confirmingAll} onClick={() => void confirmAll()}>
              <CheckCheck className="size-4" aria-hidden="true" />
              {confirmingAll ? 'Confirming…' : `Confirm all (${pending.length})`}
            </TintedButton>
          </div>
        ) : null}
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}
      {actionError ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            {actionError}
          </p>
        </Group>
      ) : null}
      {actionOk ? (
        <Group>
          <p className="text-sm text-[var(--success-text)]" role="status">
            {actionOk}
          </p>
        </Group>
      ) : null}

      <SegmentedControl
        ariaLabel="Payment filter"
        value={tab}
        onChange={(v) => setTab(v as 'pending' | 'verified')}
        options={[
          { value: 'pending', label: `To confirm ${pending.length}` },
          { value: 'verified', label: 'Confirmed' },
        ]}
      />

      <Group padding="rows">
        {loading ? (
          <p className="px-1 py-4 text-sm text-[var(--label-2)]">Loading payments…</p>
        ) : rows.length === 0 ? (
          <div className="px-1 py-4">
            <EmptyState
              icon={<CreditCard className="size-7" />}
              title={tab === 'pending' ? 'No payments to confirm' : 'No confirmed payments yet'}
              description={
                tab === 'pending'
                  ? 'You are all caught up.'
                  : 'Confirmed payments will appear here.'
              }
            />
          </div>
        ) : (
          rows.map((o) => {
            const status = paymentStatus(o);
            const last4 = o.paymentUtr ? o.paymentUtr.slice(-4) : null;
            return (
              <div
                key={o.id}
                className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
              >
                <Link href={`/shop/orders/${o.id}`} className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-[var(--label)]">
                    {o.customerPhone ?? 'Walk-in'}, {formatINRFromPaise(o.totalAmountPaise)}
                  </span>
                  <span className="block truncate text-sm text-[var(--label-2)]">
                    {last4 ? `UTR ending ${last4}, ` : ''}
                    {timeAgoShort(status === 'pending' ? o.createdAt : (o.paidAt ?? o.createdAt))}
                    {status === 'failed' ? ' · Rejected' : ''}
                    {status === 'refunded' ? ' · Refunded' : ''}
                  </span>
                </Link>
                {status === 'pending' ? (
                  <PrimaryButton
                    size="compact"
                    disabled={confirmingId === o.id || confirmingAll}
                    onClick={() => void confirmOne(o)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {confirmingId === o.id ? 'Confirming…' : 'Confirm'}
                  </PrimaryButton>
                ) : (
                  <span className="rounded-full bg-[var(--success-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--success-text)]">
                    Paid
                  </span>
                )}
              </div>
            );
          })
        )}
      </Group>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Group>
          <p className="text-xs text-[var(--label-2)]">UPI today</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : formatINRFromPaise(summary.upiPaise)}
          </p>
        </Group>
        <Group>
          <p className="text-xs text-[var(--label-2)]">Counter today</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : formatINRFromPaise(summary.counterPaise)}
          </p>
        </Group>
        <Group>
          <p className="text-xs text-[var(--label-2)]">Unpaid ready</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--label)]">
            {loading ? '—' : summary.unpaidReady}
          </p>
        </Group>
      </div>
      <p className="-mt-1 text-xs leading-relaxed text-[var(--label-2)]">
        “UPI today” counts paid-today orders with a UTR; the rest count as
        counter. Amount mismatches can&apos;t be detected here — the order
        record has no paid-amount field, only the order total and the UTR.
        Check the amount in your UPI app before tapping Confirm.
      </p>
    </div>
  );
}
