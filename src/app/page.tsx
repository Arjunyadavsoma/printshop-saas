'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/clear/site-header';
import { SiteFooter } from '@/components/clear/site-footer';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { readRecentOrders, type RecentOrderSummary } from '@/lib/customer/recent-orders';
import { readPendingOrder, type PendingOrder } from '@/lib/customer/order-restore';
import {
  geolocationErrorMessage,
  loadStoredLocation,
  parseOpenStatus,
  requestGeolocation,
  saveStoredLocation,
  type CustomerLocation,
  type GeolocationFailure,
  type NearbyShop,
} from '@/lib/location/shop-filters';

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
  queueCount?: number | null;
  distanceLabel?: string | null;
  distanceKm?: number | null;
  image?: string | null;
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const DEMO_SHOP_SLUGS = new Set(['quickprint', 'copycenter', 'prinithub']);
function isDemoOrTestShop(s: ShopListItem): boolean {
  if (IS_DEV) return false;
  if (DEMO_SHOP_SLUGS.has(s.slug.toLowerCase())) return true;
  if (s.slug.toLowerCase().startsWith('test-')) return true;
  if (/demo shop/i.test(s.name)) return true;
  return false;
}

const SHOPS_CACHE_KEY = 'printshop:shops-cache';
const SHOPS_CACHE_TTL_MS = 60_000;

interface ShopsCacheEntry { fetchedAt: number; shops: ShopListItem[]; }

function readShopsCache(): ShopListItem[] | null {
  try {
    const raw = sessionStorage.getItem(SHOPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopsCacheEntry;
    if (!Array.isArray(parsed.shops) || Date.now() - parsed.fetchedAt > SHOPS_CACHE_TTL_MS) return null;
    return parsed.shops;
  } catch { return null; }
}

function writeShopsCache(shops: ShopListItem[]): void {
  try { sessionStorage.setItem(SHOPS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), shops })); }
  catch { /* sessionStorage unavailable */ }
}

/** Wait-time display string per the reference: "about 6 min wait" / "no wait" / "Opens …" */
function waitText(s: ShopListItem): string {
  if (!s.isOpen) return 'Closed';
  if (s.waitMinutes != null && s.waitMinutes > 0) return `about ${s.waitMinutes} min wait`;
  if ((s.queueCount ?? 0) > 0) return `${s.queueCount} in queue`;
  return 'no wait';
}

/** Status chip class per the reference: ok (green) for open, a (amber) for closed */
function chipClass(s: ShopListItem): string {
  return s.isOpen ? 'chip ok' : 'chip a';
}

/**
 * Site home — Clear design (1:1 match to the uploaded reference screens).
 *
 * Mobile (390px): top bar → "Print without the queue" → subtitle → search
 *   card → shops card (single white card with divider rows) → caption →
 *   "Run a print shop?" card. Bottom nav for navigation consistency.
 *
 * Desktop (1280px): top bar → two-column layout — left: headline (44px) +
 *   subtitle + search + shops; right: "Scan a shop QR code" card + register/
 *   login card.
 *
 * No filter chips, no QR hero banner, no individual shop cards — the
 * reference is deliberately quiet: content is the hero, chrome disappears.
 */
export default function HomePage() {
  const router = useRouter();
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [savedLocation, setSavedLocation] = useState<CustomerLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [recentOrder, setRecentOrder] = useState<RecentOrderSummary | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);

  useEffect(() => {
    const list = readRecentOrders();
    setRecentOrder(list.length > 0 ? list[0] : null);
    setPendingOrder(readPendingOrder());
    setSavedLocation(loadStoredLocation());
  }, []);

  const fetchShops = useCallback(async (): Promise<ShopListItem[] | null> => {
    const loc = loadStoredLocation();
    if (loc) {
      try {
        const res = await fetch(`/api/shops/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=10&limit=50`);
        if (res.ok) {
          const body = (await res.json()) as { data?: { shops?: NearbyShop[] } };
          const nearby = (body.data?.shops ?? []).map((s): ShopListItem => ({
            id: s.id, name: s.name, slug: s.slug, address: s.address,
            phone: '', upiId: '', subscriptionTier: '', isActive: true,
            isOpen: parseOpenStatus(s.openStatus).isOpen ?? true,
            waitMinutes: s.waitMinutes ?? null,
            queueCount: s.queueCount ?? null,
            distanceLabel: s.distanceLabel ?? null,
            distanceKm: s.distanceKm ?? null,
            image: s.image ?? null,
            pricingSummary: {
              bwA4PerPage: s.pricingSummary?.bwA4PerPage ?? 200,
              colorA4PerPage: s.pricingSummary?.colorA4PerPage ?? 500,
              minOrderValue: s.pricingSummary?.minOrderValue ?? 1000,
            },
          }));
          return nearby.filter((s) => !isDemoOrTestShop(s));
        }
      } catch { /* fall through to list endpoint */ }
    }
    const res = await fetch('/api/v1/shops?limit=50', { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const retry = await fetch('/api/v1/shops?limit=50', { headers: { Accept: 'application/json' } });
      if (!retry.ok) return null;
      const d = (await retry.json()) as { data?: { shops: ShopListItem[] } };
      return d.data?.shops.filter((s) => !isDemoOrTestShop(s)) ?? null;
    }
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: { shops: ShopListItem[] } };
    return d.data?.shops.filter((s) => !isDemoOrTestShop(s)) ?? null;
  }, []);

  const loadShops = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) { setLoading(true); setError(null); }
    try {
      const list = await fetchShops();
      if (list === null) {
        if (!opts?.background) setError('load-failed');
      } else {
        setShops(list);
        writeShopsCache(list);
        setError(null);
      }
    } catch {
      if (!opts?.background) setError('load-failed');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [fetchShops]);

  useEffect(() => {
    const cached = readShopsCache();
    if (cached) { setShops(cached); setLoading(false); void loadShops({ background: true }); }
    else { void loadShops(); }
  }, [loadShops]);

  const handleDetectAndFind = useCallback(async () => {
    setLocating(true); setLocError(null);
    try {
      const loc = await requestGeolocation();
      saveStoredLocation(loc);
      setSavedLocation(loc);
      router.push('/find-a-shop');
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code ?? 'unavailable';
      setLocError(geolocationErrorMessage(code));
    } finally { setLocating(false); }
  }, [router]);

  const filtered = useMemo(() => {
    let list = shops;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
    return list;
  }, [shops, query]);

  const openCount = useMemo(() => shops.filter(s => s.isOpen).length, [shops]);

  /* ── Shops card body (shared by mobile + desktop) ── */
  const shopsCard = (isDesktop = false) => {
    if (error) {
      return (
        <div className={isDesktop ? 'gg p' : 'g p'}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E' }}>Couldn&apos;t load shops</p>
          <small style={{ display: 'block', fontSize: 14, color: '#5B5F66', marginTop: 4 }}>This is usually temporary. Try again.</small>
          <button type="button" onClick={() => void loadShops()} className="btn s" style={{ flex: 'none', height: 44, fontSize: 15, marginTop: 12, padding: '0 20px' }}>Try again</button>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={isDesktop ? 'gg' : 'g'}>
          <div className="r"><span style={{ color: '#5B5F66' }}>Looking for shops nearby…</span></div>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className={isDesktop ? 'gg p' : 'g p'}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E' }}>No shops found{query ? ' for your search' : ''}</p>
          <small style={{ display: 'block', fontSize: 14, color: '#5B5F66', marginTop: 4 }}>
            Scan a shop&apos;s QR code to go straight to its page.
          </small>
        </div>
      );
    }
    return (
      <div className={isDesktop ? 'gg' : 'g'}>
        {filtered.map((s) => (
          <Link key={s.id} href={`/s/${s.slug}`} className="r" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>{s.name}<small>{s.isOpen ? `Open, ${waitText(s)}` : waitText(s)}{s.distanceLabel ? ` · ${s.distanceLabel}` : ''}</small></span>
            <span className="v"><span className={chipClass(s)}>{s.isOpen ? 'Open' : 'Closed'}</span></span>
          </Link>
        ))}
      </div>
    );
  };

  /* ── Search card body (shared) ── */
  const searchCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg p' : 'g p'}>
      <label htmlFor="q" style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>Search shops</label>
      <input
        id="q"
        className="in"
        type="text"
        placeholder="Search by shop or area"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
    </div>
  );

  /* ── "Run a print shop?" card (shared) ── */
  const runShopCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg' : 'g'}>
      <div className="r"><span>Run a print shop?<small>Get a QR code and start taking orders.</small></span></div>
      <Link href="/shop/register" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Register your shop</span><span className="v">›</span></Link>
      <Link href="/shop/login" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Shopkeeper login</span><span className="v">›</span></Link>
    </div>
  );

  /* ── Pending / recent order rows (if any) ── */
  const orderRows = () => {
    const pending = pendingOrder;
    const recent = recentOrder;
    if (!pending && !recent) return null;
    if (pending && recent && pending.token === recent.token) return null;
    return (
      <div className="g">
        {pending && (
          <Link href={`/s/${pending.shopSlug}`} className="r" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>Continue paying — Order {pending.orderNumber ?? '—'}<small>{pending.shopName ?? ''} — payment was interrupted</small></span>
            <span className="v">›</span>
          </Link>
        )}
        {recent && pending?.token !== recent.token && (
          <Link href={`/o/${recent.token}`} className="r" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>Order {recent.orderNumber ?? '—'}<small>{recent.shopName ?? ''} — track your order</small></span>
            <span className="v">›</span>
          </Link>
        )}
      </div>
    );
  };

  return (
    <>
      {/* ── Mobile layout (below 1024px) ── */}
      <div className="x m">
        <div className="top"><i className="dot" /><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Print without the queue</h1>
        <p className="sub">Find a shop near you, or scan its QR code.</p>
        {searchCard()}
        {orderRows()}
        {shopsCard()}
        <p className="cap">Scan a shop&apos;s QR code to go straight to its page.</p>
        {runShopCard()}
        <div className="cap" style={{ marginTop: 16, paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
          <Link href="/orders" style={{ color: '#0A58D6', textDecoration: 'none' }}>My orders</Link>
          <span style={{ margin: '0 6px', color: '#DADBE1' }}>·</span>
          <Link href="/track" style={{ color: '#0A58D6', textDecoration: 'none' }}>Track order</Link>
          <span style={{ margin: '0 6px', color: '#DADBE1' }}>·</span>
          <Link href="/help" style={{ color: '#0A58D6', textDecoration: 'none' }}>Help</Link>
        </div>
      </div>

      {/* ── Desktop layout (1024px+) ── */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">
            <Link href="/track" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Track order</Link>
            <Link href="/pricing" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Pricing</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Print without the queue</h1>
            <p className="s2">Find a shop near you, or scan its QR code.</p>
            {searchCard(true)}
            {orderRows()}
            {shopsCard(true)}
          </div>
          <div className="rt">
            <div className="gg p" style={{ textAlign: 'center' }}>
              <div className="v" style={{ textAlign: 'center', fontSize: 15, fontWeight: 600, color: '#1C1C1E' }}>Scan a shop QR code</div>
              <div className="qr" />
              <Link href="/scan" className="btn s" style={{ flex: 'none', height: 44, fontSize: 15, marginTop: 12, textDecoration: 'none' }}>Open scanner</Link>
            </div>
            {runShopCard(true)}
          </div>
        </div>
        <SiteFooter />
      </div>

      {/* Persistent bottom navigation (mobile only) */}
      <ConsumerTabBar />
    </>
  );
}
