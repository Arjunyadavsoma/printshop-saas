'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Phone, MapPin, Share2, XCircle, AlertTriangle, Loader2, CheckCircle2,
} from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';
import { TokenSlip } from '@/components/clear/token-slip';
import { StatusTimeline } from '@/components/clear/status-timeline';
import { StatusPill } from '@/components/clear/status-pill';
import { PriceBreakdown, formatRupees, type PriceLine } from '@/components/clear/price-breakdown';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/clear/compat';
import { SkeletonBox, SkeletonText } from '@/components/clear/compat';
import { ErrorState } from '@/components/clear/compat';
import { OfflineBanner } from '@/components/clear/compat';
import { Toast } from '@/components/clear/compat';
import { UTRInput } from '@/components/clear/utr-input';

import { useTrackPoll, type FetchResult } from '@/lib/hooks/use-track-poll';
import { useOrderRealtime } from '@/lib/hooks/use-order-realtime';
import { useOnline, useShare } from '@/lib/hooks/use-online';
import {
  mapToPill, buildTimeline, formatStepTimestamp, statusLabel,
  isCancelledStatus, canCancel,
} from '@/lib/customer/order-status-mapping';
import { saveRecentOrder } from '@/lib/customer/recent-orders';
import { track as trackEvent, ANALYTICS_EVENTS } from '@/lib/customer/analytics';

/**
 * /o/[token] — live order tracking (brief §4.7, DESIGN-PLAN screen 6).
 *
 * No login: the 128-bit token IS the credential. Polls `/api/v1/o/[token]`
 * with visibility-aware exponential backoff (5s → 10s → 30s → 60s, stop
 * after 30 min of no status change). The token slip is the hero; the
 * timeline shows the 5-step lifecycle (Placed → Payment → Printing → Ready
 * → Collected).
 */

// ── Response shape from GET /api/v1/o/[token] ─────────────────────────────
type Track = {
  order: {
    orderNumber: string | null;
    status: string;
    totalPaise: number;
    subtotalPaise: number;
    addonsPaise: number;
    pickupCode: string | null;
    urgent: boolean;
    placedAt: string | null;
    paidAt: string | null;
    readyAt: string | null;
    collectedAt: string | null;
    cancelReason: string | null;
    priceSnapshot: unknown;
  };
  shop: { name: string; address: string; phone: string } | null;
  upiIntentUrl: string | null;
  payment: {
    method: string;
    status: string;
    utr: string | null;
    rejectReason: string | null;
  } | null;
  files: Array<{ id: string; name: string; status: string; pageCount: number | null; colorSuggestion: unknown }>;
  tasks: Array<{
    id: string;
    kind: string | null;
    colorMode: string | null;
    sheetCount: number | null;
    copies: number | null;
    setLabel: string | null;
    status: string;
    lastError: string | null;
  }>;
  events: Array<{ type: string; actorType: string; at: string; data?: unknown }>;
};

// ── Per-task status copy (kept terse and in the shop's vocabulary) ────────
const TASK_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  queued:      { label: 'Queued',                 className: 'text-[var(--color-muted)]' },
  dispatched:  { label: 'Sent to printer',        className: 'text-[var(--color-muted)]' },
  received:    { label: 'Received by printer',    className: 'text-[var(--color-muted)]' },
  printing:    { label: 'Printing',               className: 'text-[var(--color-cyan-ink)]' },
  spooled:     { label: 'Spooled',                className: 'text-[var(--color-cyan-ink)]' },
  printed:     { label: 'Printed',                className: 'text-[var(--color-cyan-ink)]' },
  completed:   { label: 'Printed',                className: 'text-[var(--color-cyan-ink)]' },
  uncertain:   { label: 'Uncertain — shop checking', className: 'text-[var(--color-warning)]' },
  failed:      { label: 'Failed — shop notified', className: 'text-[var(--color-error)]' },
  cancelled:   { label: 'Cancelled',              className: 'text-[var(--color-muted)]' },
};

export default function TrackOrderPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const online = useOnline();
  const share = useShare();

  // The fetcher wraps the polling hook — it must NOT throw on HTTP errors.
  const fetcher = useCallback(async (): Promise<FetchResult<Track>> => {
    try {
      const res = await fetch(`/api/v1/o/${token}`, { headers: { Accept: 'application/json' } });
      const d = (await res.json()) as { data?: Track; error?: { message?: string } };
      if (res.ok) {
        return { ok: true, status: res.status, data: d.data };
      }
      return {
        ok: false,
        status: res.status,
        message: d?.error?.message ?? (res.status === 404 ? 'Order not found' : 'Could not load this order'),
      };
    } catch {
      return { ok: false, status: 0, message: 'Network error — check your connection and try again.' };
    }
  }, [token]);

  const { phase, data, error, notFound, refresh } = useTrackPoll<Track>(fetcher, [token]);

  // ── Realtime layer (P8.5): a Socket.IO client joins room `order:<token>`
  //    and pushes instant status changes. When the socket is down, the hook
  //    falls back to polling internally; when it reconnects, it stops polling
  //    + does a full state sync. Here we just consume its `status` to trigger
  //    an immediate `refresh()` of the data-polling hook — the realtime
  //    status arrives faster than the 5-second poll cadence, so the pill +
  //    timeline jump the moment the shop advances the order.
  const realtime = useOrderRealtime(token);
  useEffect(() => {
    if (!realtime.status) return;
    if (data?.order.status === realtime.status) return; // already in sync
    refresh();
  }, [realtime.status, data?.order.status, refresh]);

  // Persist the order into the device-local recent-orders list so /orders
  // can list it. Skip on the very first load (no data yet) and only update
  // when the shape is real (we need shopName + totalPaise).
  useEffect(() => {
    if (!data || !data.shop) return;
    saveRecentOrder({
      token,
      shopSlug: null, // The tracking API does not expose the shop slug.
      shopName: data.shop.name,
      orderNumber: data.order.orderNumber,
      pickupCode: data.order.pickupCode,
      totalPaise: data.order.totalPaise,
      status: data.order.status,
      placedAt: data.order.placedAt ?? new Date().toISOString(),
    });
  }, [data, token]);

  // ── Analytics: fire `order_ready_seen` / `payment_confirmed` /
  //    `payment_rejected` once each, on the relevant transition. We use
  //    refs so re-renders (poll ticks) don't double-fire.
  const firedReadyRef = useRef(false);
  const firedConfirmedRef = useRef(false);
  const firedRejectedRef = useRef(false);
  useEffect(() => {
    if (!data) return;
    // order_ready_seen — the customer is looking at the order while it's
    // ready for pickup (the polling just surfaced a 'ready' or
    // 'paid_on_pickup' status).
    if (
      !firedReadyRef.current &&
      (data.order.status === 'ready' || data.order.status === 'paid_on_pickup')
    ) {
      firedReadyRef.current = true;
      trackEvent(ANALYTICS_EVENTS.orderReadySeen, {});
    }
    // payment_confirmed — the shop confirmed the payment.
    if (
      !firedConfirmedRef.current &&
      data.payment &&
      data.payment.status === 'CONFIRMED'
    ) {
      firedConfirmedRef.current = true;
      trackEvent(ANALYTICS_EVENTS.paymentConfirmed, {});
    }
    // payment_rejected — the shop rejected the payment reference.
    if (
      !firedRejectedRef.current &&
      data.payment &&
      data.payment.status === 'REJECTED'
    ) {
      firedRejectedRef.current = true;
      trackEvent(ANALYTICS_EVENTS.paymentRejected, {});
    }
  }, [data]);

  // Toast state — surfaces share / cancel / payment outcomes.
  const [toast, setToast] = useState<{ variant: 'success' | 'error' | 'info'; message: string }>({ variant: 'info', message: '' });

  // ── QR: fetch the order-tracking-URL QR PNG data URL once the page mounts.
  //    The QR lets the customer scan the slip from another device to reopen
  //    the tracking page. /api/v1/qr is the production route (stateless,
  //    rate-limited).
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const trackingUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/o/${token}`
      : `/o/${token}`;
    fetch(`/api/v1/qr?data=${encodeURIComponent(trackingUrl)}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d?.data?.pngDataUrl) setQrDataUrl(d.data.pngDataUrl);
      })
      .catch(() => { /* QR is non-essential — the slip renders a placeholder */ });
    return () => { alive = false; };
  }, [token]);

  // ── Action: share the tracking link ──
  const onShare = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : `/o/${token}`;
    const result = await share(url, 'My print order', 'Track my print order here:');
    if (result === 'shared') {
      setToast({ variant: 'success', message: 'Shared the order link.' });
    } else if (result === 'copied') {
      setToast({ variant: 'success', message: 'Order link copied to clipboard.' });
    } else {
      setToast({ variant: 'info', message: 'Could not share — copy the URL from your browser.' });
    }
  }, [share, token]);

  // ── Action: open Google Maps directions to the shop ──
  const onDirections = useCallback(() => {
    if (!data?.shop) return;
    const q = encodeURIComponent(`${data.shop.name}, ${data.shop.address}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank', 'noopener,noreferrer');
  }, [data]);

  // ── Action: cancel the order (only before printing) ──
  const [cancelling, setCancelling] = useState(false);
  const onCancel = useCallback(async () => {
    if (!data) return;
    if (!window.confirm('Cancel this order? This cannot be undone.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/o/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by customer' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not cancel');
      setToast({ variant: 'success', message: 'Order cancelled. The shop has been notified.' });
      refresh();
    } catch (e) {
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Could not cancel' });
    } finally {
      setCancelling(false);
    }
  }, [data, token, refresh]);

  // ── Action: resubmit a UTR (when payment was rejected) ──
  const [utrValue, setUtrValue] = useState('');
  const [utrError, setUtrError] = useState<string | null>(null);
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const onSubmitUtr = useCallback(async () => {
    if (!data) return;
    setUtrError(null);
    setSubmittingUtr(true);
    try {
      const res = await fetch(`/api/v1/o/${token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'upi', utr: utrValue.replace(/\D/g, '') }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not submit the payment');
      setToast({ variant: 'success', message: 'Payment reference submitted. Waiting for the shop to confirm.' });
      setUtrValue('');
      refresh();
    } catch (e) {
      setUtrError(e instanceof Error ? e.message : 'Could not submit the payment');
    } finally {
      setSubmittingUtr(false);
    }
  }, [data, token, utrValue, refresh]);

  const onCounterPay = useCallback(async () => {
    if (!data) return;
    try {
      const res = await fetch(`/api/v1/o/${token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'counter_cash' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not switch to counter payment');
      setToast({ variant: 'success', message: 'You will pay at the counter when you collect.' });
      refresh();
    } catch (e) {
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Could not switch to counter payment' });
    }
  }, [data, token, refresh]);

  // ── Derived view state ──
  const track = data;
  const cancelled = track ? isCancelledStatus(track.order.status) : false;
  const canCancelOrder = track ? canCancel(track.order.status) : false;
  const pillVariant = track ? mapToPill(track.order.status) : 'pending';
  const pillLabel = track ? statusLabel(track.order.status) : '';

  const timeline = useMemo(() => {
    if (!track) return [];
    return buildTimeline(track.order.status, {
      Placed:    formatStepTimestamp(track.order.placedAt),
      Payment:   formatStepTimestamp(track.order.paidAt),
      Ready:     formatStepTimestamp(track.order.readyAt),
      Collected: formatStepTimestamp(track.order.collectedAt),
    });
  }, [track]);

  const priceLines = useMemo<PriceLine[]>(() => {
    if (!track) return [];
    const lines: PriceLine[] = [
      { label: 'Subtotal', amountPaise: track.order.subtotalPaise },
    ];
    if (track.order.addonsPaise > 0) {
      lines.push({ label: 'Add-ons', amountPaise: track.order.addonsPaise });
    }
    if (track.order.urgent) {
      lines.push({ label: 'Urgent surcharge', amountPaise: 0 });
    }
    return lines;
  }, [track]);

  // The order summary line for the token slip — "12 B&W · 3 Colour pages".
  const summaryLine = useMemo(() => {
    if (!track) return '';
    const bw = track.tasks
      .filter(t => t.colorMode === 'BW' || t.colorMode === 'BLACK_WHITE')
      .reduce((s, t) => s + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
    const color = track.tasks
      .filter(t => t.colorMode === 'COLOR' || t.colorMode === 'COLOUR')
      .reduce((s, t) => s + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
    const parts: string[] = [];
    if (bw) parts.push(`${bw} B&W`);
    if (color) parts.push(`${color} Colour`);
    return parts.length ? `${parts.join(' · ')} page${bw + color === 1 ? '' : 's'}` : `${track.files.length} file${track.files.length === 1 ? '' : 's'}`;
  }, [track]);

  // ── Loading skeleton (first load only) ──
  if (phase === 'loading' && !track) {
    return (
      <div className="customer-flow">
        <OfflineBanner variant="offline" show={!online}>You are offline.</OfflineBanner>
        <AppBar title="Loading order" onBack={() => router.back()} />
        <main className="mx-auto max-w-xl px-4 py-6 space-y-6" aria-busy="true" aria-live="polite">
          {/* TokenSlip skeleton */}
          <div className="rounded-[var(--radius-soft)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-6">
            <SkeletonBox width="short" height={20} className="self-center" />
            <div className="mt-3 flex justify-center">
              <SkeletonBox width={160} height={40} radius="var(--radius-default)" />
            </div>
            <div className="mt-4 border-t border-dashed border-[var(--color-border-ink)] pt-4 space-y-2">
              <SkeletonBox width="long" height={20} />
              <SkeletonBox width="medium" height={20} />
              <SkeletonBox width="long" height={20} />
            </div>
            <div className="mt-4 flex justify-center">
              <SkeletonBox width={96} height={96} radius="var(--radius-tight)" />
            </div>
          </div>
          {/* Timeline skeleton */}
          <div className="space-y-4">
            <SkeletonBox width="short" height={20} />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <SkeletonBox width={32} height={32} radius="9999px" />
                <div className="flex-1 pt-1">
                  <SkeletonBox width="medium" height={20} />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ── Invalid token: dedicated "Order not found" panel ──
  if (notFound) {
    return (
      <div className="customer-flow">
        <OfflineBanner variant="offline" show={!online}>You are offline.</OfflineBanner>
        <AppBar title="Order not found" onBack={() => router.push('/')} />
        <main className="mx-auto max-w-xl">
          <ErrorState
            message="We couldn't find this order."
            fix="Check your link — the order token may have expired or be incomplete. Open the link from your receipt."
          />
        </main>
      </div>
    );
  }

  // ── Generic error (network / server) ──
  if (phase === 'error' && !track) {
    return (
      <div className="customer-flow">
        <OfflineBanner variant="offline" show={!online}>You are offline.</OfflineBanner>
        <AppBar title="Order tracking" onBack={() => router.push('/')} />
        <main className="mx-auto max-w-xl">
          <ErrorState
            message="We couldn't load this order."
            fix="Check your connection and try again. If the problem persists, open the link from your receipt."
            onRetry={() => refresh()}
          />
        </main>
        <Toast variant="error" message={error ?? ''} onDismiss={() => {}} />
      </div>
    );
  }

  if (!track) {
    // Defensive — shouldn't reach here, but render a stable fallback.
    return (
      <div className="customer-flow">
        <AppBar title="Order tracking" onBack={() => router.push('/')} />
        <main className="mx-auto max-w-xl">
          <ErrorState message="We couldn't load this order." onRetry={() => refresh()} />
        </main>
      </div>
    );
  }

  // ── Main content ──
  const orderNumber = track.order.orderNumber ?? `Order ${token.slice(0, 6)}`;
  const shopName = track.shop?.name ?? 'This shop';
  const shopPhone = track.shop?.phone;
  const shopAddress = track.shop?.address;
  const totalRupees = formatRupees(track.order.totalPaise);

  // Payment state — surfaced as a card under the timeline.
  const payment = track.payment;
  const paymentPending = payment && payment.method === 'upi' && payment.status === 'SUBMITTED';
  const paymentConfirmed = payment && payment.status === 'CONFIRMED';
  const paymentRejected = payment && payment.status === 'REJECTED';
  const paymentCounter = payment && (payment.method === 'counter_cash' || payment.method === 'counter_upi') && payment.status !== 'CONFIRMED';
  const needsUtr = track.order.status === 'awaiting_payment' || paymentRejected;

  return (
    <div className="customer-flow">
      <OfflineBanner variant="offline" show={!online}>You are offline.</OfflineBanner>
      <AppBar
        title={`Order ${orderNumber}`}
        subtitle={shopName}
        onBack={() => router.back()}
        actions={
          <span
            aria-live="polite"
            aria-atomic="true"
            className="inline-flex items-center gap-1"
          >
            <StatusPill status={pillVariant} label={pillLabel} />
          </span>
        }
      />

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* Urgent badge — if the order is marked urgent, call it out up top */}
        {track.order.urgent && (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-warning)]/15 px-4 py-2 text-sm text-[var(--color-ink)]"
            role="status"
          >
            <AlertTriangle className="size-4 text-[var(--color-warning)]" aria-hidden="true" />
            <span>Marked urgent — the shop will print this first.</span>
          </div>
        )}

        {/* ── Hero: the token slip ── */}
        {track.order.pickupCode && !cancelled ? (
          <TokenSlip
            pickupCode={track.order.pickupCode}
            orderNumber={orderNumber}
            shopName={shopName}
            summary={summaryLine || totalRupees}
            qrUrl={qrDataUrl ?? undefined}
          />
        ) : cancelled ? (
          <section
            className="rounded-[var(--radius-default)] border border-[var(--color-error)]/40 bg-[var(--color-surface)] p-4"
            aria-label="Cancelled order notice"
          >
            <div className="flex items-start gap-3">
              <XCircle className="size-5 shrink-0 text-[var(--color-error)]" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  This order was {track.order.status}.
                </p>
                {track.order.cancelReason && (
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{track.order.cancelReason}</p>
                )}
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  Place a new order at the shop to print again.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section
            className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4"
            aria-label="Order placed"
          >
            <p className="text-sm font-medium text-[var(--color-ink)]">Order {orderNumber} placed.</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Your pickup code will appear here once the order is confirmed.
            </p>
          </section>
        )}

        {/* ── Timeline ── */}
        <section aria-labelledby="status-heading">
          <h2 id="status-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-3">
            Status
          </h2>
          <StatusTimeline steps={timeline} ariaLabel="Order status timeline" />
        </section>

        {/* ── Per-set printing progress (kept terse — shop vocabulary) ── */}
        {track.tasks.length > 0 && (
          <section aria-labelledby="printing-progress-heading">
            <h2 id="printing-progress-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-2">
              Printing progress
            </h2>
            <ul className="space-y-1.5">
              {track.tasks.map(t => {
                const st = TASK_STATUS_LABEL[t.status] ?? { label: t.status, className: 'text-[var(--color-muted)]' };
                return (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-3 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 py-2.5 text-sm"
                  >
                    <span className="truncate text-[var(--color-ink)]">
                      {t.setLabel ?? (t.colorMode === 'COLOR' || t.colorMode === 'COLOUR' ? 'Colour set' : 'B&W set')}
                      {t.sheetCount ? ` · ${t.sheetCount} sheet${t.sheetCount === 1 ? '' : 's'}` : ''}
                    </span>
                    <span className={`shrink-0 text-xs font-medium tnum ${st.className}`}>
                      {st.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Payment state ── */}
        {(payment || needsUtr) && (
          <section
            className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
            aria-labelledby="payment-heading"
          >
            <h2 id="payment-heading" className="text-sm font-semibold text-[var(--color-ink)]">
              Payment
            </h2>

            {paymentConfirmed && (
              <p className="text-sm text-[var(--color-success)] flex items-center gap-1.5">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Payment confirmed by the shop.
              </p>
            )}

            {paymentPending && (
              <p className="text-sm text-[var(--color-ink)]">
                Reference <span className="font-semibold tnum tabular-nums">{payment?.utr}</span> submitted — waiting for the shop to confirm your payment.
              </p>
            )}

            {paymentCounter && (
              <p className="text-sm text-[var(--color-ink)]">
                You will pay at the counter when you collect.
              </p>
            )}

            {paymentRejected && (
              <div className="text-sm">
                <p className="text-[var(--color-error)] font-medium">
                  Payment rejected: {payment?.rejectReason ?? 'check with the shop'}.
                </p>
                <p className="mt-1 text-[var(--color-muted)]">
                  Enter the correct UTR below, or pay at the counter instead.
                </p>
              </div>
            )}

            {needsUtr && (
              <div className="space-y-3">
                {track.upiIntentUrl && (
                  <a
                    href={track.upiIntentUrl}
                    className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-4 text-base font-medium text-white min-h-[48px]"
                    rel="noopener noreferrer"
                  >
                    Open UPI app to pay
                  </a>
                )}
                <UTRInput
                  value={utrValue}
                  onChange={setUtrValue}
                  onSubmit={onSubmitUtr}
                  error={utrError ?? undefined}
                />
                <div className="flex items-center gap-2">
                  <PrimaryButton
                    onClick={onSubmitUtr}
                    disabled={utrValue.replace(/\D/g, '').length !== 12}
                    loading={submittingUtr}
                    className="flex-1"
                  >
                    Submit payment reference
                  </PrimaryButton>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <TextButton onClick={onCounterPay} className="flex-1">
                    Pay at counter instead
                  </TextButton>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Price breakdown ── */}
        <PriceBreakdown
          totalPaise={track.order.totalPaise}
          lines={priceLines}
          trailing={<StatusPill status={pillVariant} label={pillLabel} />}
        />

        {/* ── Shop details + actions ── */}
        {track.shop && (
          <section
            className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
            aria-labelledby="shop-heading"
          >
            <h2 id="shop-heading" className="text-sm font-semibold text-[var(--color-ink)]">
              {shopName}
            </h2>
            {shopAddress && (
              <p className="text-sm text-[var(--color-muted)]">{shopAddress}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {shopPhone && (
                <a
                  href={`tel:${shopPhone}`}
                  className="touch-target inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
                >
                  <Phone className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
                  Call shop
                </a>
              )}
              <button
                type="button"
                onClick={onDirections}
                className="touch-target inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
              >
                <MapPin className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
                Directions
              </button>
              <button
                type="button"
                onClick={onShare}
                className="touch-target col-span-2 inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
              >
                <Share2 className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
                Share order link
              </button>
            </div>

            {canCancelOrder && (
              <div className="pt-1">
                <SecondaryButton
                  onClick={onCancel}
                  loading={cancelling}
                  className="w-full"
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Cancelling…
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 text-[var(--color-error)]" aria-hidden="true" />
                      Cancel order
                    </>
                  )}
                </SecondaryButton>
                <p className="mt-1 text-xs text-[var(--color-muted)] text-center">
                  Available only before printing starts.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Footer links ── */}
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] pt-2">
          <a href="/orders" className="underline hover:text-[var(--color-ink)]">My orders</a>
          <span aria-hidden="true">·</span>
          <a href="/help" className="underline hover:text-[var(--color-ink)]">Help</a>
          <span aria-hidden="true">·</span>
          <a href="/privacy" className="underline hover:text-[var(--color-ink)]">Privacy</a>
        </nav>
      </main>

      <Toast
        variant={toast.variant}
        message={toast.message}
        onDismiss={() => setToast({ variant: 'info', message: '' })}
      />
    </div>
  );
}
