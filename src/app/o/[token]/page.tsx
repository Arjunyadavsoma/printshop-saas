'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * /o/[token] — live order tracking (brief §4.7). No login; the 128-bit
 * token is the credential. Timeline numbering IS a sequence (the design
 * brief allows numbering for true sequences). Polls every 5 s as the
 * socket fallback.
 */

type Track = {
  order: {
    orderNumber: string | null; status: string; totalPaise: number;
    subtotalPaise: number; addonsPaise: number; pickupCode: string | null;
    urgent: boolean; cancelReason: string | null; priceSnapshot: unknown;
  };
  shop: { name: string; address: string; phone: string } | null;
  upiIntentUrl: string | null;
  payment: { method: string; status: string; utr: string | null; rejectReason: string | null } | null;
  files: Array<{ id: string; name: string; status: string; pageCount: number | null; colorSuggestion: unknown }>;
  tasks: Array<{ id: string; kind: string | null; colorMode: string | null; sheetCount: number | null; setLabel: string | null; status: string; lastError: string | null }>;
  events: Array<{ type: string; actorType: string; at: string }>;
};

const STATUS_STEPS = ['placed', 'payment', 'queued', 'printing', 'ready', 'collected'] as const;

function statusIndex(status: string): number {
  switch (status) {
    case 'draft': return 0;
    case 'awaiting_payment': return 1;
    case 'payment_submitted': return 1;
    case 'paid': return 2;
    case 'queued': return 2;
    case 'printing': return 3;
    case 'partially_printed': return 3;
    case 'ready': return 4;
    case 'paid_on_pickup': return 4;
    case 'collected': return 5;
    default: return 1;
  }
}

const TASK_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'text-ink/60' },
  dispatched: { label: 'Sent to printer', className: 'text-ink/60' },
  received: { label: 'Received by printer', className: 'text-ink/60' },
  printing: { label: 'Printing', className: 'text-[color:var(--p-cyan)]' },
  spooled: { label: 'Spooled', className: 'text-[color:var(--p-cyan)]' },
  printed: { label: 'Printed', className: 'text-[color:var(--p-cyan)]' },
  completed: { label: 'Printed', className: 'text-[color:var(--p-cyan)]' },
  uncertain: { label: 'Uncertain — the shop is checking', className: 'text-[color:var(--p-yellow)]' },
  failed: { label: 'Failed — the shop has been notified', className: 'text-[color:var(--p-magenta)]' },
  cancelled: { label: 'Cancelled', className: 'text-ink/40' },
};

export default function TrackOrderPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/v1/o/${token}`);
      const d = await res.json();
      if (!alive) return;
      if (res.ok) setTrack(d.data);
      else setError(d?.error?.message ?? 'Order not found');
    };
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-medium">{error}</p>
        <p className="mt-1 text-sm text-ink/60">Open the full link from your receipt — it includes the order token.</p>
      </div>
    );
  }
  if (!track) {
    return <div className="mx-auto max-w-xl px-4 py-16 animate-pulse text-center text-ink/50">Loading your order…</div>;
  }

  const idx = statusIndex(track.order.status);
  const cancelled = ['cancelled', 'expired'].includes(track.order.status);

  return (
    <div className="min-h-dvh bg-paper pb-16 text-ink">
      <header className="border-b border-ink/15 px-4 py-3">
        <div className="mx-auto flex max-w-xl items-baseline justify-between">
          <h1 className="text-lg font-bold tracking-tight">Order {track.order.orderNumber}</h1>
          {track.order.urgent && <span className="rounded bg-[color:var(--p-yellow-tint)] px-2 py-0.5 text-xs font-medium text-[color:var(--p-yellow)]">Urgent</span>}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-5">
        {/* pickup code — the perforated counter stub */}
        {track.order.pickupCode && !cancelled && (
          <div className="rounded-xl border border-ink/25 bg-white p-4">
            <div className="perforation h-[3px] w-full" aria-hidden="true" />
            <p className="mt-3 text-center text-sm text-ink/60">Show this pickup code at the counter</p>
            <p className="mt-1 text-center text-4xl font-bold tracking-[0.3em] tabular-nums">{track.order.pickupCode}</p>
            <div className="perforation mt-3 h-[3px] w-full" aria-hidden="true" />
          </div>
        )}

        {/* timeline — numbered, it IS a sequence */}
        <ol className="mt-6 space-y-0" aria-label="Order progress">
          {STATUS_STEPS.map((step, i) => {
            const done = i <= idx && !cancelled;
            const current = i === idx && !cancelled;
            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${done ? 'border-transparent bg-ink text-paper' : 'border-ink/30 text-ink/50'} ${current ? 'ring-2 ring-[color:var(--p-cyan)]' : ''}`}>
                    {i + 1}
                  </span>
                  {i < STATUS_STEPS.length - 1 && <span className={`h-8 w-px ${done ? 'bg-ink' : 'bg-ink/25'}`} aria-hidden="true" />}
                </div>
                <span className={`pb-8 pt-1 capitalize ${current ? 'font-semibold' : done ? '' : 'text-ink/45'}`}>
                  {step === 'payment' ? 'Payment' : step}
                </span>
              </li>
            );
          })}
        </ol>

        {cancelled && (
          <div className="rounded-lg border border-[color:var(--p-magenta)]/40 bg-white p-3 text-sm">
            This order was {track.order.status}. {track.order.cancelReason}
          </div>
        )}

        {/* payment state — honest, never auto-verified */}
        {track.payment && (
          <div className="mt-2 rounded-lg border border-ink/20 bg-white p-3 text-sm">
            {track.payment.method === 'upi' && track.payment.status === 'SUBMITTED' && (
              <p>Reference <span className="font-semibold tabular-nums">{track.payment.utr}</span> sent — waiting for the shop to confirm your payment.</p>
            )}
            {track.payment.status === 'CONFIRMED' && <p className="text-[color:var(--p-cyan)]">Payment confirmed by the shop.</p>}
            {track.payment.status === 'REJECTED' && (
              <p className="text-[color:var(--p-magenta)]">Payment rejected: {track.payment.rejectReason ?? 'check with the shop'}. You can resubmit the correct UTR from your order link.</p>
            )}
            {(track.payment.method === 'counter_cash' || track.payment.method === 'counter_upi') && track.payment.status !== 'CONFIRMED' && (
              <p>Pay at the counter when you collect.</p>
            )}
          </div>
        )}

        {/* task progress — per set, in shop language not internals */}
        {track.tasks.length > 0 && (
          <div className="mt-4">
            <h2 className="text-sm font-semibold tracking-tight">Printing progress</h2>
            <ul className="mt-2 space-y-1.5">
              {track.tasks.map(t => {
                const st = TASK_STATUS_LABEL[t.status] ?? { label: t.status, className: 'text-ink/60' };
                return (
                  <li key={t.id} className="flex items-baseline justify-between rounded-md border border-ink/15 bg-white px-3 py-2 text-sm">
                    <span className="truncate">
                      {t.setLabel ?? (t.colorMode === 'COLOR' ? 'Color set' : 'B&W set')}
                      {t.sheetCount ? ` · ${t.sheetCount} sheet${t.sheetCount === 1 ? '' : 's'}` : ''}
                    </span>
                    <span className={`shrink-0 text-xs font-medium ${st.className}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-5 rounded-lg border border-ink/15 bg-white p-3 text-sm">
          <p className="font-medium">{track.shop?.name}</p>
          <p className="mt-0.5 text-ink/70">{track.shop?.address}</p>
          <p className="mt-1"><a className="underline" href={`tel:${track.shop?.phone}`}>Call the shop</a></p>
        </div>
        <p className="mt-3 text-right text-sm tabular-nums">Total {`₹${(track.order.totalPaise / 100).toFixed(2)}`}</p>
      </main>
    </div>
  );
}
