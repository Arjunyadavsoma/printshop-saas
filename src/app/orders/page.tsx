'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';

const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === 'true';

/** Status chip class — maps pill status to the Clear chip colours */
function chipFor(status: string): string {
  const pill = mapToPill(status);
  if (pill === 'ready' || pill === 'collected') return 'chip ok';
  if (pill === 'error') return 'chip rd';
  if (pill === 'pending' || pill === 'printing') return 'chip a';
  return 'chip';
}

const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';

/**
 * /orders — "My orders".
 * Real data: device's recent orders from localStorage.
 *
 * Shared consumer shell (ConsumerPage) — the old `.x .m` / `.x .d` dual
 * canvas is gone. Behaviour is unchanged.
 */
export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);

  useEffect(() => { setOrders(readRecentOrders()); }, []);

  const onForget = (token: string) => {
    if (!window.confirm('Remove this order from your list? The order itself is not affected.')) return;
    forgetOrder(token);
    setOrders(readRecentOrders());
  };

  const ordersCard = () => {
    if (orders === null) {
      return <div className={cardClass}><div className="r"><span className="text-[var(--label-2)]">Loading your orders…</span></div></div>;
    }
    if (orders.length === 0) {
      return (
        <div className={cardClass}>
          <div className="r"><span>No orders yet<small>Scan a shop&apos;s QR code to start your first print order.</small></span></div>
          <Link href="/" className="r"><span>Find a shop</span><span className="v">›</span></Link>
        </div>
      );
    }
    return (
      <div className={cardClass}>
        {orders.map(o => (
          <div key={o.token} className="r">
            <Link href={`/o/${o.token}`} className="min-w-0 flex-1">
              <span>{o.orderNumber ? `Order ${o.orderNumber}` : o.shopName}<small>{o.shopName}{o.totalPaise != null ? `, ₹${Math.round(o.totalPaise / 100)}` : ''}</small></span>
            </Link>
            <span className="v flex items-center gap-2">
              <span className={chipFor(o.status)}>{statusLabel(o.status)}</span>
              <button type="button" onClick={() => onForget(o.token)} aria-label={`Remove ${o.orderNumber ?? 'this order'}`} className="text-[13px] font-semibold text-[var(--danger)]">Remove</button>
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <ConsumerPage>
      <h1 className="type-hero">My orders</h1>
      <p className="type-sub mt-2">On this device</p>
      <div className="mt-6">{ordersCard()}</div>
      <p className="mt-4 px-2 text-sm text-[var(--label-2)]">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
      {OTP_ENABLED && (
        <div className={`${cardClass} mt-4`}><div className="r"><span>Look up by phone<small>Enabled on this deployment.</small></span></div></div>
      )}
    </ConsumerPage>
  );
}
