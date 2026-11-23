'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Search, MapPin, Printer, ArrowRight, Loader2, AlertCircle, Store } from 'lucide-react';

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

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await api.request<{ data?: { shops: ShopListItem[] }; error?: { message?: string } }>('GET', '/api/v1/shops?limit=50');
    if (r.status >= 400 || !r.data?.data) {
      setError('load-failed');
    } else {
      setShops(r.data.data.shops);
    }
    setLoading(false);
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
        {shops.length > 0
          ? `${shops.length} shops nearby, ready to print`
          : 'Scan a shop QR or browse below'}
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
            }}
            aria-label="Search print shops"
          />
        </div>
      </div>

      {/* Shops list */}
      <div style={{ marginTop: '8px' }}>
        {loading ? (
          <div className="ref-g" style={{ padding: '24px 16px', textAlign: 'center' }}>
            <Loader2 className="mx-auto size-6 animate-spin text-[#5B5F66]" aria-hidden="true" />
            <p className="ref-v" style={{ textAlign: 'center', marginTop: '8px' }}>Loading shops…</p>
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
          <span>3. Pay by UPI<small>Direct to the shopkeeper, 0% commission</small></span>
        </div>
        <div className="ref-r">
          <span>4. Pick up<small>Show your code at the counter</small></span>
        </div>
      </div>

      {/* Shopkeeper CTA */}
      <div className="ref-g p" style={{ marginTop: '16px', textAlign: 'center' }}>
        <p style={{ fontSize: '15px', fontWeight: 600 }}>Run a print shop?</p>
        <p className="ref-v" style={{ textAlign: 'center', marginTop: '4px' }}>
          Get your QR code and start taking orders in minutes.
        </p>
        <Link href="/shop/register" className="ref-btn" style={{ display: 'block', marginTop: '12px', textAlign: 'center', textDecoration: 'none' }}>
          Register your shop
        </Link>
        <Link href="/shop/login" style={{ display: 'block', marginTop: '8px', textAlign: 'center', fontSize: '14px', color: '#0A58D6', textDecoration: 'none' }}>
          Shopkeeper login →
        </Link>
      </div>

      {/* Footer */}
      <div className="ref-cap" style={{ textAlign: 'center', marginTop: '24px', marginBottom: '32px' }}>
        Printelyx · 0% commission · <Link href="/help" style={{ color: '#0A58D6' }}>Help</Link> · <Link href="/about" style={{ color: '#0A58D6' }}>About</Link>
      </div>
    </div>
  );
}

function ShopRow({ shop }: { shop: ShopListItem }) {
  return (
    <Link
      href={`/s/${shop.slug}`}
      className="ref-g"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      aria-label={`Visit ${shop.name}`}
    >
      <div className="ref-r">
        <span style={{ flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Printer className="size-4 shrink-0 text-[#0A58D6]" aria-hidden="true" />
            <b style={{ fontSize: '16px' }}>{shop.name}</b>
          </span>
          <small style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <MapPin className="size-3 shrink-0" aria-hidden="true" />
            {shop.address}
          </small>
        </span>
        <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <span className="ref-chip">₹{Math.round(shop.pricingSummary.bwA4PerPage / 100)}/page</span>
          <span style={{ fontSize: '13px', color: '#5B5F66' }}>Visit shop →</span>
        </span>
      </div>
      <div className="ref-r" style={{ minHeight: '40px' }}>
        <small>B&amp;W ₹{Math.round(shop.pricingSummary.bwA4PerPage / 100)} · Colour ₹{Math.round(shop.pricingSummary.colorA4PerPage / 100)} · Min ₹{Math.round(shop.pricingSummary.minOrderValue / 100)}</small>
        <small style={{ color: '#5B5F66' }}>UPI: {shop.upiId}</small>
      </div>
    </Link>
  );
}
