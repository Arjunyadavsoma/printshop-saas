'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';

/**
 * /orders — "My orders" — 1:1 replica of design board 17 (Customer: my
 * orders). Real data: the device's recent orders (localStorage summaries
 * saved when an order is placed; the token IS the credential).
 *
 * The phone-lookup panel stays gated behind NEXT_PUBLIC_OTP_ENABLED
 * (default off — dead "Coming soon" UI was audit P1-13).
 */
const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === 'true';

function chipClass(pill: string): string {
  switch (pill) {
    case 'positive': return 'chip ok';
    case 'warning': return 'chip a';
    case 'negative': return 'chip rd';
    default: return 'chip';
  }
}

function OrdersCard({ cls, orders, onForget }: { cls: 'g' | 'gg'; orders: RecentOrderSummary[] | null; onForget: (token: string) => void }) {
  if (orders === null) {
    return (
      <div className={cls}>
        <div className="r"><span>Loading your orders…</span><span className="v" /></div>
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className={cls}>
        <div className="r">
          <span>No orders yet<small>Scan a shop&apos;s QR code to start your first print order.</small></span>
        </div>
        <div className="r">
          <Link href="/"><span>Find a shop</span><span className="v">›</span></Link>
        </div>
      </div>
    );
  }
  return (
    <div className={cls}>
      {orders.map(o => (
        <div key={o.token} className="r" style={{ minHeight: 64 }}>
          <Link href={`/o/${o.token}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.orderNumber ? `Order ${o.orderNumber}` : o.shopName}
            </span>
            <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.shopName}{o.totalPaise != null ? `, ₹${Math.round(o.totalPaise / 100)}` : ''}
            </small>
          </Link>
          <span className="chip rd" role="button" tabIndex={0}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onForget(o.token); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onForget(o.token); } }}
            aria-label={`Remove ${o.orderNumber ?? 'this order'} from the list`}
            style={{ cursor: 'pointer' }}>Remove</span>
          <span className={chipClass(mapToPill(o.status))}>{statusLabel(o.status)}</span>
        </div>
      ))}
    </div>
  );
}

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
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">My orders</h1>
        <p className="sub">On this device</p>
        <OrdersCard cls="g" orders={orders} onForget={onForget} />
        <p className="cap">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
        {OTP_ENABLED && <div className="g"><div className="r"><span>Look up by phone<small>Enabled on this deployment.</small></span><span className="v">›</span></div></div>}
      </div>

      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <Link href="/help" className="v">Help</Link>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">My orders</h1>
            <p className="s2">On this device</p>
            <OrdersCard cls="gg" orders={orders} onForget={onForget} />
            <p className="cap">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
          </div>
        </div>
      </div>
    </>
  );
}
