'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Search, AlertCircle, Store } from 'lucide-react';
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
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

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

  return (
    <div className="ref-screen m">
      {/* Theme toggle */}
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* Top bar */}
      <div className="ref-top">
        <i className="ref-dot"></i>
        Printelyx
      </div>

      {/* Hero */}
      <h1 className="ref-h">Print without the queue</h1>
      <p className="ref-sub">
        {shops.length > 0 ? `${shops.length} shops nearby` : 'Scan a shop QR or browse below'}
      </p>

      {/* Search */}
      <div className="ref-g" style={{ marginTop: '16px', padding: '0 16px' }}>
        <div style={{ position: 'relative', height: '48px', display: 'flex', alignItems: 'center' }}>
          <Search className="absolute left-3 size-4 text-[#5B5F66]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by shop name or area…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%',
              height: '48px',
              border: '0',
              background: 'transparent',
              fontSize: '16px',
              paddingLeft: '36px',
              fontFamily: 'inherit',
              outline: 'none',
              color: '#1C1C1E',
            }}
            aria-label="Search print shops"
          />
        </div>
      </div>

      {/* Returning customer: shortcut to the most recent order on this device */}
      {recentOrder && (
        <div className="ref-g" style={{ marginTop: '16px', padding: 0 }}>
          <Link
            href={`/o/${recentOrder.token}`}
            className="ref-r"
            style={{ textDecoration: 'none', color: 'inherit', minHeight: '52px', alignItems: 'center' }}
            aria-label={`Track your recent order from ${recentOrder.shopName}`}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '13px', color: '#5B5F66', display: 'block' }}>Your recent order</span>
              <span style={{ fontSize: '16px', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {recentOrder.shopName}
                {recentOrder.orderNumber ? ` · ${recentOrder.orderNumber}` : ''}
              </span>
            </span>
            <span className="ref-chip">Track</span>
          </Link>
        </div>
      )}

      {/* Shops list */}
      <div style={{ marginTop: '8px' }}>
        {loading ? (
          // Skeleton rows sized like real shop rows (reserves layout space —
          // no CLS when the list resolves; no "Loading…" dead text).
          <div className="ref-g" style={{ padding: '8px 16px' }} aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="ref-r" style={{ minHeight: '96px', alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', height: '16px', width: '55%', borderRadius: '8px', background: 'var(--hairline, #E4E6EB)' }} />
                  <span style={{ display: 'block', height: '12px', width: '75%', borderRadius: '8px', background: 'var(--hairline, #E4E6EB)', marginTop: '8px' }} />
                </span>
                <span style={{ flex: 'none', width: '64px', height: '24px', borderRadius: '9999px', background: 'var(--hairline, #E4E6EB)' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="ref-g" style={{ padding: '24px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B3261E' }}>
              <AlertCircle className="size-5" aria-hidden="true" />
              <span style={{ fontSize: '16px', fontWeight: 600 }}>Couldn&apos;t load shops</span>
            </div>
            <p className="ref-v" style={{ marginTop: '4px' }}>This is usually temporary. Try again.</p>
            <button className="ref-btn" style={{ marginTop: '12px', width: '100%' }} onClick={loadShops}>
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ref-g p" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <Store className="mx-auto size-8 text-[#5B5F66]" aria-hidden="true" />
            <p style={{ fontSize: '17px', fontWeight: 600, marginTop: '8px' }}>
              {shops.length === 0 ? 'No shops available yet' : 'No shops match your search'}
            </p>
            <p className="ref-v" style={{ textAlign: 'center', marginTop: '4px' }}>
              {shops.length === 0 ? 'Ask your local print shop to sign up.' : 'Try a different name or area.'}
            </p>
          </div>
        ) : (
          filtered.map(shop => <ShopRow key={shop.id} shop={shop} />)
        )}
      </div>

      {/* How it works */}
      <div className="ref-g p" style={{ marginTop: '16px' }}>
        <p style={{ fontSize: '17px', fontWeight: 600 }}>How it works</p>
        <div className="ref-r" style={{ marginTop: '8px' }}>
          <span>1. Find a shop<small>Or scan the shop&apos;s QR code</small></span>
        </div>
        <div className="ref-r">
          <span>2. Upload files<small>PDF, photos, or Word docs</small></span>
        </div>
        <div className="ref-r">
          <span>3. Pay by UPI<small>Direct to shopkeeper, 0% commission</small></span>
        </div>
        <div className="ref-r">
          <span>4. Pick up<small>Show your code at the counter</small></span>
        </div>
      </div>

      {/* Shopkeeper CTA */}
      <div className="ref-g p" style={{ marginTop: '16px', textAlign: 'center' }}>
        <p style={{ fontSize: '15px', fontWeight: 600 }}>Run a print shop?</p>
        <p className="ref-v" style={{ textAlign: 'center', marginTop: '4px' }}>
          Get your QR code and start taking orders.
        </p>
        <Link href="/shop/register" style={{ display: 'block', marginTop: '12px' }}>
          <span className="ref-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Register your shop
          </span>
        </Link>
        <Link href="/shop/login" style={{ display: 'block', marginTop: '8px', textAlign: 'center', fontSize: '14px', color: '#0A58D6', textDecoration: 'none' }}>
          Shopkeeper login
        </Link>
      </div>

      {/* Footer */}
      <footer className="ref-cap" style={{ textAlign: 'center', marginTop: '24px', marginBottom: '32px', color: '#5B5F66' }}>
        <span style={{ display: 'block', marginBottom: '6px' }}>Printelyx — 0% commission</span>
        <span style={{ display: 'inline-flex', gap: '12px', justifyContent: 'center' }}>
          <Link href="/help" style={{ color: '#0A58D6', display: 'inline-flex', alignItems: 'center', minHeight: '48px', padding: '0 6px' }}>Help</Link>
          <Link href="/about" style={{ color: '#0A58D6', display: 'inline-flex', alignItems: 'center', minHeight: '48px', padding: '0 6px' }}>About</Link>
          <Link href="/contact" style={{ color: '#0A58D6', display: 'inline-flex', alignItems: 'center', minHeight: '48px', padding: '0 6px' }}>Contact</Link>
        </span>
      </footer>
    </div>
  );
}

function ShopRow({ shop }: { shop: ShopListItem }) {
  const bwPrice = Math.round(shop.pricingSummary.bwA4PerPage / 100);
  const colorPrice = Math.round(shop.pricingSummary.colorA4PerPage / 100);
  const minOrder = Math.round(shop.pricingSummary.minOrderValue / 100);
  const tierLabel = shop.subscriptionTier.charAt(0).toUpperCase() + shop.subscriptionTier.slice(1);

  return (
    <Link
      href={`/s/${shop.slug}`}
      className="ref-g"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: 0 }}
    >
      {/* Row 1: Shop name + tier badge */}
      <div className="ref-r" style={{ minHeight: '52px', alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '16px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {shop.name}
          </span>
          <small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
            {shop.address}
          </small>
        </span>
        <span className="ref-chip" style={{ flex: 'none', marginLeft: '8px', alignSelf: 'center' }}>{tierLabel}</span>
      </div>
      {/* Row 2: Pricing summary */}
      <div className="ref-r" style={{ minHeight: '44px', fontSize: '15px' }}>
        <span style={{ flex: 1 }}>
          <small style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span>B&amp;W ₹{bwPrice}</span>
            <span>Colour ₹{colorPrice}</span>
            <span>Min ₹{minOrder}</span>
          </small>
        </span>
        <span className="ref-v" style={{ flex: 'none', whiteSpace: 'nowrap' }}>Visit shop</span>
      </div>
    </Link>
  );
}
