'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QrCode } from 'lucide-react';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { Input } from '@/components/clear/input';
import { TintedButton } from '@/components/clear/button';
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

/** White row card (Clear) — token-based, no legacy `.g` margins. */
const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

/**
 * Site home — Clear design.
 *
 * One responsive layout (no duplicated mobile/desktop markup): the hero
 * and shop list on the left, a 360px rail on desktop with the QR scanner
 * card and the "Run a print shop?" card. On mobile the rail stacks below
 * the shop list, in the same order as the old mobile canvas.
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

  /* ── Shops card body ── */
  const shopsCard = () => {
    if (error) {
      return (
        <div className={cardPadClass}>
          <p className="text-[15px] font-semibold text-[var(--label)]">Couldn&apos;t load shops</p>
          <small className="mt-1 block text-sm text-[var(--label-2)]">This is usually temporary. Try again.</small>
          <TintedButton type="button" size="compact" onClick={() => void loadShops()} className="mt-3">
            Try again
          </TintedButton>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={cardClass}>
          <div className="r"><span className="text-[var(--label-2)]">Looking for shops nearby…</span></div>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className={cardPadClass}>
          <p className="text-[15px] font-semibold text-[var(--label)]">No shops found{query ? ' for your search' : ''}</p>
          <small className="mt-1 block text-sm text-[var(--label-2)]">
            Scan a shop&apos;s QR code to go straight to its page.
          </small>
        </div>
      );
    }
    return (
      <div className={cardClass}>
        {filtered.map((s) => (
          <Link key={s.id} href={`/s/${s.slug}`} className="r">
            <span>{s.name}<small>{s.isOpen ? `Open, ${waitText(s)}` : waitText(s)}{s.distanceLabel ? ` · ${s.distanceLabel}` : ''}</small></span>
            <span className="v"><span className={chipClass(s)}>{s.isOpen ? 'Open' : 'Closed'}</span></span>
          </Link>
        ))}
      </div>
    );
  };

  /* ── Search card body ── */
  const searchCard = () => (
    <div className={cardPadClass}>
      <Input
        id="q"
        label="Search shops"
        placeholder="Search by shop or area"
        value={query}
        onChange={setQuery}
        autoComplete="off"
      />
    </div>
  );

  /* ── "Run a print shop?" card ── */
  const runShopCard = () => (
    <div className={cardClass}>
      <div className="r"><span>Run a print shop?<small>Get a QR code and start taking orders.</small></span></div>
      <Link href="/shop/register" className="r"><span>Register your shop</span><span className="v">›</span></Link>
      <Link href="/shop/login" className="r"><span>Shopkeeper login</span><span className="v">›</span></Link>
    </div>
  );

  /* ── Pending / recent order rows (if any) ── */
  const orderRows = () => {
    const pending = pendingOrder;
    const recent = recentOrder;
    if (!pending && !recent) return null;
    if (pending && recent && pending.token === recent.token) return null;
    return (
      <div className={cardClass}>
        {pending && (
          <Link href={`/s/${pending.shopSlug}`} className="r">
            <span>Continue paying — Order {pending.orderNumber ?? '—'}<small>{pending.shopName ?? ''} — payment was interrupted</small></span>
            <span className="v">›</span>
          </Link>
        )}
        {recent && pending?.token !== recent.token && (
          <Link href={`/o/${recent.token}`} className="r">
            <span>Order {recent.orderNumber ?? '—'}<small>{recent.shopName ?? ''} — track your order</small></span>
            <span className="v">›</span>
          </Link>
        )}
      </div>
    );
  };

  return (
    <ConsumerPage wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="type-hero">Print without the queue</h1>
            <p className="type-sub mt-2">Find a shop near you, or scan its QR code.</p>
          </div>
          {searchCard()}
          {orderRows()}
          {shopsCard()}
          <p className="type-caption px-2 lg:hidden">Scan a shop&apos;s QR code to go straight to its page.</p>
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Desktop-only scanner card. The box is an illustration, not a
              scannable code — the old fake QR pattern is gone. */}
          <div className={`${cardPadClass} hidden text-center lg:block`}>
            <p className="text-[15px] font-semibold text-[var(--label)]">Scan a shop QR code</p>
            <div className="mx-auto mt-3 flex size-[120px] items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--ground)]">
              <QrCode className="size-12 text-[var(--label-2)]" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-[var(--label-2)]">Point your camera at a shop&apos;s QR code to open its page.</p>
            <Link
              href="/scan"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent-tint)] px-5 text-[15px] font-semibold text-[var(--accent-tint-text)]"
            >
              Open scanner
            </Link>
          </div>
          {runShopCard()}
        </aside>
      </div>

      {/* Mobile-only footer links (desktop has the header nav + footer). */}
      <div className="mt-6 px-2 pb-2 text-sm lg:hidden">
        <Link href="/orders" className="text-[var(--accent)]">My orders</Link>
        <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
        <Link href="/track" className="text-[var(--accent)]">Track order</Link>
        <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
        <Link href="/help" className="text-[var(--accent)]">Help</Link>
      </div>
    </ConsumerPage>
  );
}
