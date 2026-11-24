'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Phone, MapPin, Share2, XCircle, AlertTriangle, Loader2, CheckCircle2,
} from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';
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
import { openStreetMapUrl } from '@/lib/location/validation';
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
    id: string;
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
  shop: { name: string; address: string; phone: string; latitude: number | null; longitude: number | null } | null;
  upiIntentUrl: string | null;
  payment: {
    method: string;
    status: string;
    utr: string | null;
    rejectReason: string | null;
  } | null;
  // Per-file print config + individual price (from orderTracking).
  files: Array<{
    id: string; name: string; status: string; pageCount: number | null; colorSuggestion: unknown;
    copies: number; colorMode: string; pageRange: string | null; paperSize: string;
    duplex: boolean; pricePaise: number;
  }>;
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
  // Prefers exact coordinates when the shop has set a location.
  const onDirections = useCallback(() => {
    if (!data?.shop) return;
    const lat = data.shop.latitude;
    const lng = data.shop.longitude;
    const q = lat != null && lng != null
      ? `${lat},${lng}`
      : `${data.shop.name}, ${data.shop.address}`;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
  }, [data]);

  // ── Action: cancel the order (only before printing) ──
  // Reason dropdown (POST /api/v1/o/[token]/cancel accepts { reason }).
  // No refund is claimed here: per /refund-policy, refunds are issued
  // directly by the shop to the customer's UPI account — Printelyx
  // never holds the money, so a cancelled order is "refund requested
  // from the shop", not "refunded".
  const CANCEL_REASONS = [
    'Changed my mind',
    'Uploaded the wrong files',
    'Ordered from the wrong shop by mistake',
    'Price is too high',
    'No longer needed',
    'Other',
  ];
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelling, setCancelling] = useState(false);
  const onCancel = useCallback(async () => {
    if (!data) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/o/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not cancel');
      setToast({ variant: 'success', message: 'Order cancelled. The shop has been notified.' });
      setShowCancel(false);
      refresh();
    } catch (e) {
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Could not cancel' });
    } finally {
      setCancelling(false);
    }
  }, [data, token, refresh, cancelReason]);

  // ── Action: edit one file's print settings ──
  // The API permits this only while status is 'awaiting_payment'
  // (PATCH /api/v1/orders/:id/files/:fileId, X-Order-Token auth — the
  // server rejects edits in any other status). Editing reprices the
  // file and the order total; the page refreshes to show the new total.
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ copies: 1, colorMode: 'bw', paperSize: 'a4', duplex: false });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const canEditFiles = (status: string) => status === 'awaiting_payment';
  const startEdit = useCallback((file: Track['files'][number]) => {
    setEditError(null);
    setEditDraft({
      copies: file.copies ?? 1,
      colorMode: file.colorMode === 'color' ? 'color' : 'bw',
      paperSize: file.paperSize ?? 'a4',
      duplex: file.duplex ?? false,
    });
    setEditingFileId(file.id);
  }, []);
  const saveEdit = useCallback(async (fileId: string) => {
    if (!data) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/v1/orders/${data.order.id}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Order-Token': token },
        body: JSON.stringify(editDraft),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not save the changes');
      setToast({ variant: 'success', message: 'Print settings updated — the total was recalculated.' });
      setEditingFileId(null);
      refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not save the changes');
    } finally {
      setSavingEdit(false);
    }
  }, [data, token, refresh, editDraft]);

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
        <main className="mx-auto max-w-xl px-4 py-6">
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
        <main className="mx-auto max-w-xl px-4 py-6">
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
        <main className="mx-auto max-w-xl px-4 py-6">
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
  const shopLat = track.shop?.latitude ?? null;
  const shopLng = track.shop?.longitude ?? null;
  const totalRupees = formatRupees(track.order.totalPaise);

  // Payment state — surfaced as a card under the timeline.
  const payment = track.payment;
  const paymentPending = payment && payment.method === 'upi' && payment.status === 'SUBMITTED';
  const paymentConfirmed = payment && payment.status === 'CONFIRMED';
  const paymentRejected = payment && payment.status === 'REJECTED';
  const paymentCounter = payment && (payment.method === 'counter_cash' || payment.method === 'counter_upi') && payment.status !== 'CONFIRMED';
  const needsUtr = track.order.status === 'awaiting_payment' || paymentRejected;

  return (
    <div className="rv">
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

        {/* ── Hero: the pickup-code slip (.rv dark code card) ── */}
        {track.order.pickupCode && !cancelled ? (
          <div className="rv-code-card" aria-label="Pickup code">
            <p className="text-[13px] font-bold" style={{ color: 'var(--rv-code-blue)' }}>
              {shopName} · Order {orderNumber}
            </p>
            <p className="code">{track.order.pickupCode}</p>
            <p className="eta">{summaryLine || totalRupees}</p>
            <p className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
              Show this code at the counter
            </p>
          </div>
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
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  If you already paid, ask the shop for a refund — refunds are issued directly by the shop to your UPI account. See our{' '}
                  <a href="/refund-policy" className="underline hover:text-[var(--color-ink)]">refund policy</a>.
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

        {/* ── Timeline (.rv rows with dots) ── */}
        <section aria-labelledby="status-heading">
          <h2 id="status-heading" className="mb-3 text-[15px] font-extrabold text-[var(--rv-ink)]">
            Status
          </h2>
          <div className="rv-card">
            {timeline.map((step, i) => (
              <div key={step.label} className="rv-row" style={i === timeline.length - 1 ? { borderBottom: 0 } : undefined}>
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="rv-dot"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      border: `2px solid ${step.status === 'future' ? 'var(--rv-chip-border)' : 'var(--rv-done-green)'}`,
                      background: step.status === 'done' ? 'var(--rv-done-green)' : 'transparent',
                      flex: '0 0 auto',
                    }}
                  >
                    {step.status === 'current' && (
                      <span className="m-auto block size-2 rounded-full" style={{ background: 'var(--rv-accent)' }} />
                    )}
                  </span>
                  <span
                    className="text-[15px]"
                    style={{
                      fontWeight: step.status === 'current' ? 800 : 600,
                      color: step.status === 'future' ? 'var(--rv-muted)' : 'var(--rv-ink)',
                    }}
                  >
                    {step.label}
                  </span>
                </span>
                {step.timestamp && (
                  <span className="text-[12px] text-[var(--rv-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatStepTimestamp(step.timestamp)}
                  </span>
                )}
              </div>
            ))}
          </div>
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

        {/* ── Documents — uploaded files with print config + individual prices ──
            Config + price come from the tracking API (real data, not
            assumptions). Editing is only offered while the order is still
            awaiting payment — the API rejects edits in any other status. */}
        {track.files.length > 0 && (
          <section aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-2">
              Documents · {track.files.length}
            </h2>
            <ul className="space-y-2">
              {track.files.map((f) => (
                <li
                  key={f.id}
                  className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--color-ink)]" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-[var(--color-ink)] tnum tabular-nums">
                      {formatRupees(f.pricePaise ?? 0)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {f.pageCount ?? '–'} pages · {f.copies ?? 1} {f.copies === 1 ? 'copy' : 'copies'} ·{' '}
                    {f.colorMode === 'color' ? 'Colour' : 'B&W'} · {String(f.paperSize ?? 'a4').toUpperCase()} ·{' '}
                    {f.duplex ? 'double-sided' : 'single-sided'}
                    {f.pageRange ? ` · pages ${f.pageRange}` : ''}
                  </p>
                  {editingFileId === f.id ? (
                    <div className="space-y-3 border-t border-dashed border-[var(--color-border-ink)] pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-[var(--color-muted)]">
                          Copies
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={editDraft.copies}
                            onChange={(e) => setEditDraft((d) => ({ ...d, copies: Math.max(1, Number(e.target.value) || 1) }))}
                            className="mt-1 w-full rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] min-h-[44px]"
                          />
                        </label>
                        <label className="text-xs text-[var(--color-muted)]">
                          Colour
                          <select
                            value={editDraft.colorMode}
                            onChange={(e) => setEditDraft((d) => ({ ...d, colorMode: e.target.value }))}
                            className="mt-1 w-full rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] min-h-[44px]"
                          >
                            <option value="bw">B&amp;W</option>
                            <option value="color">Colour</option>
                          </select>
                        </label>
                        <label className="text-xs text-[var(--color-muted)]">
                          Paper size
                          <select
                            value={editDraft.paperSize}
                            onChange={(e) => setEditDraft((d) => ({ ...d, paperSize: e.target.value }))}
                            className="mt-1 w-full rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] min-h-[44px]"
                          >
                            <option value="a4">A4</option>
                            <option value="a3">A3</option>
                            <option value="letter">Letter</option>
                            <option value="legal">Legal</option>
                          </select>
                        </label>
                        <label className="flex items-end gap-2 pb-1 text-xs text-[var(--color-muted)]">
                          <input
                            type="checkbox"
                            checked={editDraft.duplex}
                            onChange={(e) => setEditDraft((d) => ({ ...d, duplex: e.target.checked }))}
                            className="size-5 accent-[var(--color-cyan-ink)]"
                          />
                          Double-sided
                        </label>
                      </div>
                      {editError && <p className="text-xs text-[var(--color-error)]" role="alert">{editError}</p>}
                      <div className="flex gap-2">
                        <PrimaryButton onClick={() => void saveEdit(f.id)} loading={savingEdit} className="flex-1">
                          Save changes
                        </PrimaryButton>
                        <TextButton onClick={() => setEditingFileId(null)} className="flex-1">
                          Cancel
                        </TextButton>
                      </div>
                    </div>
                  ) : canEditFiles(track.order.status) ? (
                    <div>
                      <TextButton onClick={() => startEdit(f)}>Edit print settings</TextButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {canEditFiles(track.order.status)
                ? 'Print settings can be changed until payment — the total updates automatically.'
                : 'Print settings can only be changed before payment.'}
            </p>
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
              {shopLat != null && shopLng != null && (
                <a
                  href={openStreetMapUrl(shopLat, shopLng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="touch-target col-span-2 inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
                >
                  <MapPin className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
                  View shop on map
                </a>
              )}
            </div>

            {canCancelOrder && (
              <div className="pt-1 space-y-2">
                {showCancel ? (
                  <>
                    <label htmlFor="cancel-reason" className="block text-xs font-medium text-[var(--color-muted)]">
                      Reason for cancelling
                    </label>
                    <select
                      id="cancel-reason"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="w-full rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] min-h-[48px]"
                    >
                      {CANCEL_REASONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <p className="text-xs text-[var(--color-muted)]">
                      Cancelling is free before printing starts. If you already paid, the shop refunds you directly to your UPI account — see our{' '}
                      <a href="/refund-policy" className="underline hover:text-[var(--color-ink)]">refund policy</a>.
                    </p>
                    <div className="flex gap-2">
                      <SecondaryButton
                        onClick={onCancel}
                        loading={cancelling}
                        className="flex-1"
                      >
                        {cancelling ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            Cancelling…
                          </>
                        ) : (
                          <>
                            <XCircle className="size-4 text-[var(--color-error)]" aria-hidden="true" />
                            Confirm cancellation
                          </>
                        )}
                      </SecondaryButton>
                      <TextButton onClick={() => setShowCancel(false)} className="flex-1">
                        Keep order
                      </TextButton>
                    </div>
                  </>
                ) : (
                  <>
                    <SecondaryButton
                      onClick={() => setShowCancel(true)}
                      className="w-full"
                    >
                      <XCircle className="size-4 text-[var(--color-error)]" aria-hidden="true" />
                      Cancel order
                    </SecondaryButton>
                    <p className="mt-1 text-xs text-[var(--color-muted)] text-center">
                      Available only before printing starts.
                    </p>
                  </>
                )}
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
