'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Smartphone, ArrowRight, Trash2, RefreshCw } from 'lucide-react';

import { AppBar } from '@/components/customer/app-bar';
import { StatusPill } from '@/components/customer/status-pill';
import { EmptyState } from '@/components/customer/empty-state';
import { SkeletonBox, SkeletonText } from '@/components/customer/skeleton';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/customer/button';
import { TextField } from '@/components/customer/text-field';
import { formatRupees } from '@/components/customer/price-breakdown';

import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';
import { track, ANALYTICS_EVENTS } from '@/lib/customer/analytics';

/**
 * /orders — "My orders": the customer's recent orders on THIS device.
 *
 * Each entry is a tiny summary saved to localStorage when an order is placed
 * (see CustomerOrderFlow's `place()`). The token IS the credential, so the
 * list is the device's view, not the customer's view across devices. A
 * "Look up by phone" panel teases the cross-device lookup — for the MVP it
 * only shows a phone input (no OTP backend).
 */

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Read on the client only (localStorage isn't available on the server).
  useEffect(() => {
    setOrders(readRecentOrders());
  }, []);

  const onForget = (token: string) => {
    if (!window.confirm('Remove this order from your list? The order itself is not affected.')) return;
    forgetOrder(token);
    setOrders(readRecentOrders());
  };

  const onPhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setPhoneError('Enter a 10-digit mobile number.');
      return;
    }
    setPhoneError(null);
    // MVP: no OTP backend. Surface an informative message instead of actually looking up.
    alert('Phone-based order lookup is coming soon. For now, open the tracking link from your receipt.');
  };

  return (
    <div className="customer-flow">
      <AppBar title="My orders" subtitle="Orders placed on this device" />

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* ── Recent orders on this device ── */}
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-3">
            Recent on this device
          </h2>

          {orders === null ? (
            // First-render skeleton — localStorage hasn't been read yet.
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4"
                  aria-hidden="true"
                >
                  <div className="flex items-center justify-between">
                    <SkeletonText lines={1} width="medium" />
                    <SkeletonBox width={84} height={22} radius="9999px" />
                  </div>
                  <div className="mt-2">
                    <SkeletonText lines={1} width="long" />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <SkeletonText lines={1} width="short" />
                    <SkeletonBox width={64} height={20} radius="var(--radius-tight)" />
                  </div>
                </div>
              ))}
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="size-7" />}
              title="No orders yet"
              description="Scan a shop's QR code to start your first print order."
              action={{ label: 'Find a shop', onClick: () => { window.location.href = '/'; } }}
            />
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.token}>
                  <OrderCard order={o} onForget={() => onForget(o.token)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Look up by phone (MVP — no OTP backend) ── */}
        <section
          className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
          aria-labelledby="phone-lookup-heading"
        >
          <div className="flex items-center gap-2">
            <Smartphone className="size-5 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            <h2 id="phone-lookup-heading" className="text-sm font-semibold text-[var(--color-ink)]">
              Look up by phone
            </h2>
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            Enter your phone number to see all orders across devices. (Coming soon — for now, open the link from your receipt.)
          </p>
          <form onSubmit={onPhoneSubmit} className="space-y-3">
            <TextField
              id="phone"
              label="Mobile number"
              placeholder="10-digit mobile"
              value={phone}
              onChange={setPhone}
              error={phoneError ?? undefined}
              inputMode="numeric"
              autoComplete="tel"
              hint="We'll send a one-time password to confirm it's you."
            />
            <PrimaryButton type="submit" className="w-full">
              Continue
            </PrimaryButton>
          </form>
        </section>

        {/* ── Footer links ── */}
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] pt-2">
          <Link href="/" className="underline hover:text-[var(--color-ink)]">Home</Link>
          <span aria-hidden="true">·</span>
          <Link href="/help" className="underline hover:text-[var(--color-ink)]">Help</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className="underline hover:text-[var(--color-ink)]">Privacy</Link>
        </nav>
      </main>
    </div>
  );
}

/** A single order row — shop name, date, status pill, total, track + reorder. */
function OrderCard({ order, onForget }: { order: RecentOrderSummary; onForget: () => void }) {
  const placedDate = new Date(order.placedAt);
  const dateLabel = Number.isNaN(placedDate.getTime())
    ? ''
    : placedDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <article className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-ink)] truncate">
            {order.shopName}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)] tnum">
            {order.orderNumber ? `${order.orderNumber} · ` : ''}{dateLabel}
          </p>
        </div>
        <StatusPill
          status={mapToPill(order.status)}
          label={statusLabel(order.status)}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-muted)]">Total</span>
        <span className="text-base font-semibold text-[var(--color-ink)] tnum tabular-nums">
          {formatRupees(order.totalPaise)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/o/${order.token}`}
          className="touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-4 text-sm font-medium text-white min-h-[48px]"
        >
          Track order
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {order.shopSlug ? (
          <Link
            href={`/s/${order.shopSlug}`}
            onClick={() => {
              track(ANALYTICS_EVENTS.reorderClicked, {
                shop_slug: order.shopSlug ?? '',
                source: 'orders_list',
              });
            }}
            className="touch-target inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
          >
            <RefreshCw className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            Print again
          </Link>
        ) : (
          <TextButton
            onClick={() => {
              track(ANALYTICS_EVENTS.reorderClicked, {
                shop_slug: '',
                source: 'orders_list_no_slug',
              });
              window.location.href = '/';
            }}
            className="inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            Print again
          </TextButton>
        )}
        <button
          type="button"
          onClick={onForget}
          aria-label={`Remove ${order.orderNumber ?? 'this order'} from the list`}
          className="touch-target inline-flex items-center justify-center rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 text-[var(--color-muted)] min-h-[48px] min-w-[48px]"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
