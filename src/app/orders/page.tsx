'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { CustomerShell } from '@/components/clear/customer-shell';
import { StatusPill } from '@/components/clear/status-pill';
import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';

/**
 * /orders — "My orders" — spec screen 16.
 * Real data: the device's recent orders (localStorage summaries saved
 * when an order is placed; the token IS the credential). Only the short
 * order number (e.g. 1042) is shown, never a raw token/UUID.
 * Layout is CustomerShell (max-w-[640px] mobile / max-w-[1120px]
 * desktop) — no 390px mockup column.
 *
 * The phone-lookup panel stays gated behind NEXT_PUBLIC_OTP_ENABLED
 * (default off — dead "Coming soon" UI was audit P1-13).
 */
const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === 'true';

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);

  useEffect(() => {
    setOrders(readRecentOrders());
  }, []);

  const onForget = (token: string) => {
    if (!window.confirm('Remove this order from your list? The order itself is not affected.')) return;
    forgetOrder(token);
    setOrders(readRecentOrders());
  };

  return (
    <CustomerShell shopName="Printelyx">
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">My orders</h1>
      <p className="mt-1 text-base text-[var(--label-2)]">On this device</p>

      <section
        className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]"
        aria-label="Your orders"
      >
        {orders === null ? (
          <div className="px-4 py-3 text-sm text-[var(--label-2)]" aria-busy="true">Loading your orders…</div>
        ) : orders.length === 0 ? (
          <div>
            <div className="px-4 py-3 text-sm text-[var(--label)]">
              No orders yet
              <span className="block text-[13px] text-[var(--label-2)]">Scan a shop&apos;s QR code to start your first print order.</span>
            </div>
            <div className="border-t border-[var(--hairline)]">
              <Link href="/" className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2 text-sm font-medium text-[var(--label)]">
                Find a shop <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {orders.map(o => (
              <li key={o.token} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
                <Link
                  href={`/o/${o.token}`}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-[var(--label)]"
                >
                  <span className="truncate text-sm font-medium">
                    {o.orderNumber ? `Order ${o.orderNumber}` : o.shopName}
                  </span>
                  <span className="truncate text-[13px] text-[var(--label-2)]">
                    {o.shopName}{o.totalPaise != null ? `, ₹${Math.round(o.totalPaise / 100)}` : ''}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => onForget(o.token)}
                  aria-label={`Remove ${o.orderNumber ?? 'this order'} from the list`}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-[var(--danger-tint)] px-3 text-xs font-semibold text-[var(--danger-text)]"
                >
                  Remove
                </button>
                <span className="shrink-0">
                  <StatusPill status={mapToPill(o.status)} label={statusLabel(o.status)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-3 text-[13px] text-[var(--label-2)]">Orders stay on this device for 30 days. Open your order link to see an older one.</p>

      {OTP_ENABLED && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]">
          <div className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2 text-sm font-medium text-[var(--label)]">
            Look up by phone
            <span className="text-[13px] font-normal text-[var(--label-2)]">Enabled on this deployment.</span>
          </div>
        </div>
      )}
    </CustomerShell>
  );
}
