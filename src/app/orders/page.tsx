'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { SiteFooter } from '@/components/clear/site-footer';
import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';

const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === 'true';

/** Status chip class — maps pill status to the Clear chip colours */
function chipFor(status: string): string {
  const pill = mapToPill(status as never);
  if (pill === 'success') return 'chip ok';
  if (pill === 'warning') return 'chip a';
  if (pill === 'danger') return 'chip rd';
  return 'chip';
}

/**
 * /orders — "My orders" — Clear design (matches homepage).
 * Real data: device's recent orders from localStorage.
 */
export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);

  useEffect(() => { setOrders(readRecentOrders()); }, []);

  const onForget = (token: string) => {
    if (!window.confirm('Remove this order from your list? The order itself is not affected.')) return;
    forgetOrder(token);
    setOrders(readRecentOrders());
  };

  const ordersCard = (isDesktop = false) => {
    const cls = isDesktop ? 'gg' : 'g';
    if (orders === null) {
      return <div className={cls}><div className="r"><span style={{ color: '#5B5F66' }}>Loading your orders…</span></div></div>;
    }
    if (orders.length === 0) {
      return (
        <div className={cls}>
          <div className="r"><span>No orders yet<small>Scan a shop&apos;s QR code to start your first print order.</small></span></div>
          <Link href="/" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Find a shop</span><span className="v">›</span></Link>
        </div>
      );
    }
    return (
      <div className={cls}>
        {orders.map(o => (
          <div key={o.token} className="r">
            <Link href={`/o/${o.token}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}>
              <span>{o.orderNumber ? `Order ${o.orderNumber}` : o.shopName}<small>{o.shopName}{o.totalPaise != null ? `, ₹${Math.round(o.totalPaise / 100)}` : ''}</small></span>
            </Link>
            <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={chipFor(o.status)}>{statusLabel(o.status)}</span>
              <button type="button" onClick={() => onForget(o.token)} aria-label={`Remove ${o.orderNumber ?? 'this order'}`} style={{ background: 'none', border: 0, color: '#B3261E', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Mobile */}
      <div className="x m">
        <div className="top"><i className="dot" /><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">My orders</h1>
        <p className="sub">On this device</p>
        {ordersCard()}
        <p className="cap">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
        {OTP_ENABLED && (
          <div className="g"><div className="r"><span>Look up by phone<small>Enabled on this deployment.</small></span></div></div>
        )}
        <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Desktop */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">
            <Link href="/" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Home</Link>
            <Link href="/track" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Track order</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap"><div className="l" style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 className="h1">My orders</h1>
          <p className="s2">On this device</p>
          {ordersCard(true)}
          <p className="cap">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
        </div></div>
        <SiteFooter />
      </div>

      <ConsumerTabBar />
    </>
  );
}
