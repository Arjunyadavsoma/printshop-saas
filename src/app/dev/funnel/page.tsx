'use client';

import { useEffect, useState } from 'react';
import { AppBar } from '@/components/clear/app-bar';

/**
 * /dev/funnel — internal analytics funnel view.
 *
 * Reads the analytics events from localStorage (where `src/lib/customer/analytics.ts`
 * stores them before flushing to the server) + renders a funnel visualization
 * showing where customers drop off in the order flow.
 *
 * Dev-only — not linked from production navigation.
 */

interface AnalyticsEvent {
  event: string;
  timestamp: number;
  properties?: Record<string, string | number | boolean>;
}

const FUNNEL_STEPS = [
  { event: 'shop_landed', label: 'Shop landing' },
  { event: 'upload_started', label: 'Upload started' },
  { event: 'file_ready', label: 'File processed' },
  { event: 'preset_chosen', label: 'Preset chosen' },
  { event: 'quote_viewed', label: 'Price viewed' },
  { event: 'checkout_started', label: 'Checkout started' },
  { event: 'paid_clicked', label: 'Paid clicked' },
  { event: 'utr_submitted', label: 'UTR submitted' },
  { event: 'payment_confirmed', label: 'Payment confirmed' },
  { event: 'order_ready_seen', label: 'Order ready seen' },
] as const;

export default function FunnelPage() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('printshop_analytics_queue');
      if (raw) setEvents(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Count events per funnel step
  const counts = FUNNEL_STEPS.map((step) => ({
    ...step,
    count: events.filter((e) => e.event === step.event).length,
  }));
  const maxCount = Math.max(...counts.map((c) => c.count), 1);

  return (
    <div className="customer-flow min-h-[100dvh] bg-[var(--color-paper)]">
      <AppBar title="Analytics Funnel" subtitle="Dev-only — reads from localStorage" />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-ink)] rounded-[var(--radius-default)] p-4">
          <p className="text-sm text-[var(--color-muted)] mb-4">
            {events.length} events queued. The funnel shows where customers drop off.
          </p>
          <div className="space-y-2">
            {counts.map((step, i) => {
              const prevCount = i > 0 ? counts[i - 1]!.count : step.count;
              const conversion = prevCount > 0 ? Math.round((step.count / prevCount) * 100) : 0;
              const width = (step.count / maxCount) * 100;
              return (
                <div key={step.event} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--color-ink)]">
                      {i + 1}. {step.label}
                    </span>
                    <span className="text-[var(--color-muted)] tnum">
                      {step.count} {i > 0 && `(${conversion}%)`}
                    </span>
                  </div>
                  <div className="h-8 bg-[var(--color-paper)] rounded-[var(--radius-tight)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-cyan-ink)] transition-all duration-300"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Raw events list */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-ink)] rounded-[var(--radius-default)] p-4">
          <h2 className="text-base font-semibold text-[var(--color-ink)] mb-3">Raw events</h2>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No events yet. Place an order to see analytics.</p>
            ) : (
              events.slice().reverse().map((e, i) => (
                <div key={i} className="flex items-center gap-3 text-xs py-1">
                  <span className="text-[var(--color-muted)] tnum shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-mono text-[var(--color-ink)]">{e.event}</span>
                  {e.properties && (
                    <span className="text-[var(--color-muted)] truncate">
                      {JSON.stringify(e.properties)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
