'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';
import { useApiClient } from '@/components/portal/use-api-client';

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
 * Real data, two sources:
 *   - Signed in as a customer: order history from the server
 *     (GET /api/v1/customer/orders) — orders placed while signed in,
 *     across all devices. Shown first.
 *   - This device: recent orders from localStorage (guest orders and
 *     anything placed on this device before signing in). Shown below.
 *
 * Shared consumer shell (ConsumerPage) — the old `.x .m` / `.x .d` dual
 * canvas is gone. Behaviour is unchanged.
 */
interface AccountOrder {
  token: string;
  orderNumber: string | null;
  shopName: string | null;
  status: string;
  totalAmountPaise: number;
  placedAt: string;
}

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);
  const [accountOrders, setAccountOrders] = useState<AccountOrder[] | null>(null);
  const api = useApiClient();
  const signedInAsCustomer = Boolean(api.ready && api.token && api.role === 'customer');

  useEffect(() => { setOrders(readRecentOrders()); }, []);

  useEffect(() => {
    if (!signedInAsCustomer) {
      setAccountOrders(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.request<{ data?: { orders?: AccountOrder[] }; error?: { message?: string } }>(
          'GET',
          '/api/v1/customer/orders',
        );
        if (!cancelled && r.status === 200 && r.data?.data) {
          setAccountOrders(r.data.data.orders ?? []);
        }
      } catch {
        // Server history is a bonus on top of the device list — a failed
        // fetch leaves the device list as the whole page, like guests see.
        if (!cancelled) setAccountOrders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedInAsCustomer, api]);

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
      <p className="type-sub mt-2">{signedInAsCustomer ? 'Your account orders, on any device' : 'On this device'}</p>
      {signedInAsCustomer && (
        <div className="mt-6">
          {accountOrders === null ? (
            <div className={cardClass}><div className="r"><span className="text-[var(--label-2)]">Loading your account orders…</span></div></div>
          ) : accountOrders.length === 0 ? (
            <div className={cardClass}>
              <div className="r"><span>No account orders yet<small>Orders you place while signed in will show up here, on any device.</small></span></div>
            </div>
          ) : (
            <div className={cardClass}>
              {accountOrders.map(o => (
                <div key={o.token} className="r">
                  <Link href={`/o/${o.token}`} className="min-w-0 flex-1">
                    <span>{o.orderNumber ? `Order ${o.orderNumber}` : o.shopName}<small>{o.shopName}{o.totalAmountPaise != null ? `, ₹${Math.round(o.totalAmountPaise / 100)}` : ''}</small></span>
                  </Link>
                  <span className="v flex items-center gap-2">
                    <span className={chipFor(o.status)}>{statusLabel(o.status)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-6">
        {signedInAsCustomer && (
          <p className="px-2 text-sm font-semibold text-[var(--label-2)]">On this device</p>
        )}
        {ordersCard()}
      </div>
      <p className="mt-4 px-2 text-sm text-[var(--label-2)]">Orders stay on this device for 30 days. Open your order link to see an older one.</p>
      {OTP_ENABLED && (
        <div className={`${cardClass} mt-4`}><div className="r"><span>Look up by phone<small>Enabled on this deployment.</small></span></div></div>
      )}
    </ConsumerPage>
  );
}
