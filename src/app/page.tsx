'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { readRecentOrders, type RecentOrderSummary } from '@/lib/customer/recent-orders';

interface ShopListItem {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  upiId: string;
  subscriptionTier: string;
  isActive: boolean;
  isOpen: boolean;
  waitMinutes: number | null;
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

/**
 * Site home — 1:1 replica of the "Clear" design screens:
 * mobile board 13 (Site: home) and desktop board 31 (Desktop: site home).
 * Real data: live shop list, per-device recent order, offline error state.
 */
export default function HomePage() {
  const api = useApiClient();
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Most recent order on this device — read client-side only (localStorage),
  // surfaced as a "Your recent order" shortcut so returning customers don't
  // have to dig through /orders (audit Phase-3 requirement).
  const [recentOrder, setRecentOrder] = useState<RecentOrderSummary | null>(null);

  useEffect(() => {
    const list = readRecentOrders();
    setRecentOrder(list.length > 0 ? list[0] : null);
  }, []);

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: { shops: ShopListItem[] }; error?: { message?: string } }>('GET', '/api/v1/shops?limit=50');
      if (r.status >= 400 || !r.data?.data) {
        setError('load-failed');
      } else {
        setShops(r.data.data.shops);
      }
    } catch {
      // network failure / offline — show the retry card instead of hanging
      // on the skeleton forever (audit P1-9).
      setError('load-failed');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.ready) return;
    void loadShops();
  }, [api.ready, loadShops]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
  }, [shops, query]);

  const shopRows = (as: 'g' | 'gg') => {
    if (error) {
      return (
        <div className={as === 'g' ? 'g' : 'gg'} key="err">
          <div className="r">
            <span>Couldn&apos;t load shops<small>This is usually temporary. Try again.</small></span>
            <span className="v">
              <button type="button" className="chip rd" onClick={() => void loadShops()}>Try again</button>
            </span>
          </div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={as === 'g' ? 'g' : 'gg'} key="loading">
          <div className="r"><span>Looking for shops nearby…</span><span className="v" /></div>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className={as === 'g' ? 'g' : 'gg'} key="empty">
          <div className="r">
            <span>No shops found{query ? ' for your search' : ''}<small>Scan a shop&apos;s QR code to go straight to its page.</small></span>
          </div>
        </div>
      );
    }
    return filtered.map(s => {
      // Design boards 13/31: the second line is the LIVE status
      // ("Open, about 6 min wait" / "Open, no wait" / "Closed"), not the
      // address. Wait estimate comes from the shops API.
      const statusLine = !s.isOpen
        ? 'Closed'
        : s.waitMinutes == null
          ? 'Open'
          : s.waitMinutes === 0
            ? 'Open, no wait'
            : `Open, about ${s.waitMinutes} min wait`;
      return (
        <div className={as === 'g' ? 'g' : 'gg'} key={s.id}>
          <Link href={`/s/${s.slug}`} className="r" style={{ minHeight: 60 }}>
            <span>{s.name}<small>{statusLine}</small></span>
            <span className="v"><span className={`chip ${s.isOpen ? 'ok' : 'a'}`}>{s.isOpen ? 'Open' : 'Closed'}</span></span>
          </Link>
        </div>
      );
    });
  };

  const recentOrderRow = (
    <div className="g" style={{ marginTop: 0 }}>
      <Link href={`/o/${recentOrder?.token}`} className="r">
        <span>Order {recentOrder?.orderNumber ?? '—'}<small>{recentOrder?.shopName ?? ''} — track your order</small></span>
        <span className="v">›</span>
      </Link>
    </div>
  );

  const searchBlock = (cls: string, id: string) => (
    <div className={cls}>
      <label htmlFor={id} style={{ fontSize: 14, fontWeight: 600, display: 'block', marginTop: 12 }}>Search shops</label>
      <input
        id={id}
        className="in"
        type="text"
        placeholder="Search by shop name or area"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
    </div>
  );

  const registerRows = (cls: string) => (
    <div className={cls}>
      <div className="r">
        <span>Run a print shop?<small>Get a QR code and start taking orders.</small></span>
        <span className="v" />
      </div>
      <Link href="/shop/register" className="r"><span>Register your shop</span><span className="v">›</span></Link>
      <Link href="/shop/login" className="r"><span>Shopkeeper login</span><span className="v">›</span></Link>
    </div>
  );

  return (
    <>
      {/* ── Mobile (design board 13: Site home) ─────────────────────── */}
      <div className="x m">
        <div className="top">
          <b style={{ color: '#1C1C1E', fontSize: 17, display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>Printelyx</b>
          <ThemeToggle />
        </div>
        <h1 className="h">Print without the queue</h1>
        <p className="sub">Find a shop near you, or scan its QR code.</p>
        {searchBlock('g p', 'q')}
        {recentOrder && <div style={{ marginTop: 16 }}>{recentOrderRow}</div>}
        {shopRows('g')}
        <p className="cap">Scan a shop&apos;s QR code to go straight to its page.</p>
        {registerRows('g')}
        <p className="cap" />
      </div>

      {/* ── Desktop (design board 31: Desktop site home) ────────────── */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <Link href="/help" className="v">Help</Link>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Print without the queue</h1>
            <p className="s2">Find a shop near you, or scan its QR code.</p>
            {searchBlock('gg p', 'q-d')}
            {recentOrder && <div style={{ marginTop: 0 }}>{recentOrderRow}</div>}
            {shopRows('gg')}
          </div>
          <div className="rt">
            <div className="gg p">
              <div className="v" style={{ textAlign: 'center' }}>Scan a shop QR code</div>
              <div className="qr" aria-hidden="true" />
            </div>
            {registerRows('gg')}
          </div>
        </div>
      </div>
    </>
  );
}
