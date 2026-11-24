'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CustomerShell } from '@/components/clear/customer-shell';
import { readRecentOrders, type RecentOrderSummary } from '@/lib/customer/recent-orders';
import { readPendingOrder, type PendingOrder } from '@/lib/customer/order-restore';
import { formatRupees } from '@/components/clear/price-breakdown';
import { Search, ScanLine, Printer } from 'lucide-react';
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
  /** Live queue (orders waiting to print) — from the nearby endpoint. */
  queueCount?: number | null;
  /** Pre-formatted distance ("1.2 km") when the customer's location is known. */
  distanceLabel?: string | null;
  /** Raw distance (km) — used by the Nearest chip to sort. */
  distanceKm?: number | null;
  image?: string | null;
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

/**
 * The shops list API has no test/QA flag — `searchActive` filters on
 * `isActive` only — so the dev-seeded demo shops (see
 * src/lib/services/seed.service.ts, gated to dev by requireDev) are
 * filtered out here by their known slugs/names. A real shop that took
 * one of these slugs would be hidden too; the proper fix is an
 * `isTest`/`isDemo` flag on the Shop model + API filter (backend work,
 * out of scope for this consumer-flow rebuild).
 */
const DEMO_SHOP_SLUGS = new Set(['quickprint', 'copycenter', 'prinithub']);
function isDemoOrTestShop(s: ShopListItem): boolean {
  if (DEMO_SHOP_SLUGS.has(s.slug.toLowerCase())) return true;
  if (s.slug.toLowerCase().startsWith('test-')) return true;
  if (/demo shop/i.test(s.name)) return true;
  return false;
}

/**
 * Short client cache for the public shops list: back-navigation (e.g. a
 * customer returning from a shop page) re-renders the cached list
 * immediately instead of staring at the skeleton while the network
 * round-trips again. 60s TTL — shop open/closed + wait times go stale
 * fast, so this is a navigation cache, not an offline store (offline
 * still shows the retry card; see /offline).
 */
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
  } catch {
    return null;
  }
}

function writeShopsCache(shops: ShopListItem[]): void {
  try {
    sessionStorage.setItem(SHOPS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), shops }));
  } catch {
    // sessionStorage unavailable — the list still loads from the network.
  }
}
/**
 * Site home — spec screen 1 ("Find a shop").
 * Real shop data from GET /api/v1/shops only; no hardcoded shops.
 * Layout is CustomerShell: max-w-[640px] single column on mobile,
 * max-w-[1120px] two-pane (search + results left, QR + register right)
 * on desktop. No 390px mockup column.
 */
export default function HomePage() {
  const router = useRouter();
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Tap-to-expand shop cards: the actions row (Upload File / View Shop)
  // appears only for the tapped shop — one expanded at a time.
  const [expandedShopId, setExpandedShopId] = useState<string | null>(null);
  // Discover chips (Consumer Flow Revamp board 1). "Open now" is ON in the
  // reference; all three are real filters/sorts backed by live data.
  const [openNowChip, setOpenNowChip] = useState(true);
  const [nearestChip, setNearestChip] = useState(false);
  const [colourChip, setColourChip] = useState(false);
  // Location granted earlier on /find-a-shop (sessionStorage only) — if
  // present, the list is fetched distance-sorted from /api/shops/nearby
  // instead of the plain list endpoint.
  const [savedLocation, setSavedLocation] = useState<CustomerLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  // Most recent order on this device — read client-side only (localStorage),
  // surfaced as a "Your recent order" shortcut so returning customers don't
  // have to dig through /orders.
  const [recentOrder, setRecentOrder] = useState<RecentOrderSummary | null>(null);
  // In-progress (unpaid) order — the UPI-return safety net. If the
  // customer was killed out of the payment screen (or the PWA relaunched
  // at `/`), this card takes them straight back to the payment screen
  // instead of stranding them on the homepage. See order-restore.ts.
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);

  useEffect(() => {
    const list = readRecentOrders();
    setRecentOrder(list.length > 0 ? list[0] : null);
    setPendingOrder(readPendingOrder());
    setSavedLocation(loadStoredLocation());
  }, []);

  const fetchShops = useCallback(async (): Promise<ShopListItem[] | null> => {
    // Location known (granted on /find-a-shop): prefer the nearby
    // endpoint so the homepage list is distance-sorted. Any failure —
    // including 404 while that endpoint is still being built — falls
    // through to the existing list endpoint below.
    const loc = loadStoredLocation();
    if (loc) {
      try {
        const res = await fetch(
          `/api/shops/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=10&limit=50`,
        );
        if (res.ok) {
          const body = (await res.json()) as { data?: { shops?: NearbyShop[] } };
          const nearby = (body.data?.shops ?? []).map(
            (s): ShopListItem => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
              address: s.address,
              phone: '',
              upiId: '',
              subscriptionTier: '',
              isActive: true,
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
            }),
          );
          return nearby.filter((s) => !isDemoOrTestShop(s));
        }
      } catch {
        // Nearby fetch failed — fall through to the plain list endpoint.
      }
    }
    const res = await fetch('/api/v1/shops?limit=50', { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      // Rate-limited (shared bucket) — one retry after a short delay
      // instead of immediately showing the "Couldn't load shops" card.
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
    if (!opts?.background) {
      setLoading(true);
      setError(null);
    }
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
      // network failure / offline — show the retry card instead of hanging
      // on the skeleton forever.
      if (!opts?.background) setError('load-failed');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [fetchShops]);

  useEffect(() => {
    // The shops endpoint is PUBLIC (no auth — src/app/api/v1/shops/route.ts
    // is only rate-limited), so there is no reason to wait for the auth
    // client's `ready` flag before fetching: that gate cost a full render
    // cycle + the (async, native-bridge) auth read on every homepage load.
    // Render a fresh cache immediately, then revalidate in the background.
    const cached = readShopsCache();
    if (cached) {
      setShops(cached);
      setLoading(false);
      void loadShops({ background: true });
    } else {
      void loadShops();
    }
  }, [loadShops]);

  /** "Detect my location" shortcut: geolocate once, remember it for this
      tab only (sessionStorage), then hand off to /find-a-shop. */
  const handleDetectAndFind = useCallback(async () => {
    setLocating(true);
    setLocError(null);
    try {
      const loc = await requestGeolocation();
      saveStoredLocation(loc);
      setSavedLocation(loc);
      router.push('/find-a-shop');
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code ?? 'unavailable';
      setLocError(geolocationErrorMessage(code));
    } finally {
      setLocating(false);
    }
  }, [router]);

  const filtered = useMemo(() => {
    let list = shops;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
    if (openNowChip) list = list.filter(s => s.isOpen);
    if (colourChip) list = list.filter(s => s.pricingSummary.colorA4PerPage > 0);
    if (nearestChip) {
      // Nearest first — only meaningful with a known location; without one
      // the server order (name) is kept.
      list = [...list].sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    }
    return list;
  }, [shops, query, openNowChip, colourChip, nearestChip]);

  const openCount = useMemo(() => shops.filter(s => s.isOpen).length, [shops]);

  const sidebar = (
    <div className="rv flex flex-col gap-4" style={{ display: 'block' }}>
      <section className="rv-card" aria-labelledby="qr-heading">
        <h2 id="qr-heading" className="text-center">Scan a shop QR code</h2>
        <p className="rv-t mt-1 text-center">
          Point your camera at a shop&apos;s QR code to go straight to its page.
        </p>
        <Link
          href="/scan"
          className="rv-btn mt-4"
          style={{ width: '100%' }}
        >
          Open Scanner
        </Link>
      </section>

      <section className="rv-card" aria-labelledby="run-shop-heading">
        <h2 id="run-shop-heading">Run a print shop?</h2>
        <p className="rv-t mt-0.5">Get a QR code and start taking orders.</p>
        <div className="mt-3 divide-y divide-[var(--rv-hairline)]">
          <Link href="/shop/register" className="rv-row">
            Register your shop <span className="rv-t" aria-hidden="true">›</span>
          </Link>
          <Link href="/shop/login" className="rv-row">
            Shopkeeper login <span className="rv-t" aria-hidden="true">›</span>
          </Link>
        </div>
      </section>
    </div>
  );

  return (
    <CustomerShell shopName="Printelyx" sidebar={sidebar}>
      <div className="rv-g" style={{ gap: 14 }}>
        <div>
          <h1 className="text-[27px]">Find a print shop</h1>
          <p className="rv-t" style={{ margin: '6px 0 0' }}>
            {openCount === 0
              ? 'No shops open right now'
              : `${openCount} ${openCount === 1 ? 'shop' : 'shops'} open near you`}
          </p>
        </div>

        {/* Search — icon-left input per the board. */}
        <div style={{ position: 'relative' }}>
          <span
            aria-hidden="true"
            style={{ position: 'absolute', left: 13, top: 13, color: 'var(--rv-muted,#566274)' }}
          >
            <Search className="size-[22px]" strokeWidth={2} />
          </span>
          <label className="rv-t" htmlFor="shop-search" style={{ position: 'absolute', left: -9999 }}>
            Search shops
          </label>
          <input
            id="shop-search"
            className="rv-input"
            placeholder="Search by shop or area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Scan the shop QR — hero card (board 1). */}
        <div className="rv-card rv-hero rv-r" style={{ padding: 18 }}>
          <div className="rv-g" style={{ gap: 4 }}>
            <h2 style={{ fontSize: 18 }}>Scan the shop QR</h2>
            <span style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
              Start an order in seconds, no searching.
            </span>
          </div>
          <Link
            href="/scan"
            aria-label="Open scanner"
            className="sp ml-auto flex items-center justify-center"
            style={{ width: 52, height: 52, borderRadius: 16, background: '#fff', color: 'var(--rv-accent,#2447F5)' }}
          >
            <ScanLine className="size-[26px]" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>

        {/* Filter chips — Open now · Nearest · Colour. */}
        <div className="rv-r" style={{ gap: 8, overflowX: 'auto' }}>
          <button type="button" className={`rv-chip${openNowChip ? ' on' : ''}`} aria-pressed={openNowChip} onClick={() => setOpenNowChip(v => !v)}>
            Open now
          </button>
          <button type="button" className={`rv-chip${nearestChip ? ' on' : ''}`} aria-pressed={nearestChip} onClick={() => setNearestChip(v => !v)}>
            Nearest
          </button>
          <button type="button" className={`rv-chip${colourChip ? ' on' : ''}`} aria-pressed={colourChip} onClick={() => setColourChip(v => !v)}>
            Colour
          </button>
        </div>

        {pendingOrder && (
          <Link href={`/s/${pendingOrder.shopSlug}`} className="rv-card rv-row">
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-[var(--rv-ink,#0F172A)]">
                Continue paying — Order {pendingOrder.orderNumber ?? '—'} · {formatRupees(pendingOrder.totalPaise)}
              </span>
              <span className="block truncate text-[13px] text-[var(--rv-muted,#566274)]">
                {pendingOrder.shopName ?? ''} — your payment was interrupted
              </span>
            </span>
            <span className="rv-t" aria-hidden="true">›</span>
          </Link>
        )}

        {recentOrder && pendingOrder?.token !== recentOrder.token && (
          <Link href={`/o/${recentOrder.token}`} className="rv-card rv-row">
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-[var(--rv-ink,#0F172A)]">
                Order {recentOrder.orderNumber ?? '—'}
              </span>
              <span className="block truncate text-[13px] text-[var(--rv-muted,#566274)]">
                {recentOrder.shopName ?? ''} — track your order
              </span>
            </span>
            <span className="rv-t" aria-hidden="true">›</span>
          </Link>
        )}

        {error ? (
          <div className="rv-card rv-r" role="alert">
            <span className="text-sm text-[var(--rv-ink,#0F172A)]">
              Couldn&apos;t load shops
              <span className="block text-[13px] text-[var(--rv-muted,#566274)]">This is usually temporary. Try again.</span>
            </span>
            <button
              type="button"
              onClick={() => void loadShops()}
              className="rv-chip ml-auto"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="rv-t px-1 py-3" aria-busy="true">Looking for shops nearby…</div>
        ) : filtered.length === 0 ? (
          <div className="rv-card px-4 py-4">
            <p className="text-sm font-bold text-[var(--rv-ink,#0F172A)]">
              No shops found{query ? ' for your search' : ''}
            </p>
            <p className="rv-t mt-0.5">
              Scan a shop&apos;s QR code to go straight to its page, or turn off the Open now filter.
            </p>
          </div>
        ) : (
          <ul className="rv-g" style={{ gap: 12 }}>
            {filtered.map((s) => {
              // Board 1 card: logo tile left, name + status pill, area ·
              // distance, rates line; right column = pill + live wait.
              // Actions appear only when the card is tapped (kept from the
              // previous iteration).
              const expanded = expandedShopId === s.id;
              const initial = s.name.trim().charAt(0).toUpperCase() || 'S';
              const bw = formatRupees(s.pricingSummary.bwA4PerPage);
              const colour = formatRupees(s.pricingSummary.colorA4PerPage);
              const statusPill = !s.isOpen ? (
                <span className="rv-pill gy">Closed</span>
              ) : (s.waitMinutes ?? 0) > 8 ? (
                <span className="rv-pill am">Busy</span>
              ) : (
                <span className="rv-pill">Open</span>
              );
              const waitText = !s.isOpen
                ? 'Opens at the next opening time'
                : s.waitMinutes != null
                  ? `~${s.waitMinutes} min wait`
                  : (s.queueCount ?? 0) > 0
                    ? `${s.queueCount} in queue`
                    : 'No wait';
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedShopId(expanded ? null : s.id)}
                    aria-expanded={expanded}
                    className="rv-card rv-r w-full text-left"
                    style={{ alignItems: 'flex-start' }}
                  >
                    <span className="rv-ic">
                      {s.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- operator-provided logo URLs
                        <img src={s.image} alt="" loading="lazy" />
                      ) : (
                        <Printer className="size-[22px]" strokeWidth={2} aria-hidden="true" />
                      )}
                    </span>
                    <span className="rv-g" style={{ gap: 3, minWidth: 0, flex: 1 }}>
                      <span className="rv-r" style={{ gap: 8 }}>
                        <h2 className="truncate">{s.name}</h2>
                      </span>
                      <span className="rv-t truncate">
                        {[s.address.split(',')[0]?.trim(), s.distanceLabel].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="rv-t truncate">
                        B/W {bw} · Colour {colour} per page
                      </span>
                    </span>
                    <span className="rv-g ml-auto" style={{ alignItems: 'flex-end', gap: 6, flex: 'none' }}>
                      {statusPill}
                      <span className="rv-t" style={{ whiteSpace: 'nowrap' }}>{waitText}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="flex gap-2 px-4 pb-3 pl-[68px]">
                      <Link
                        href={`/s/${s.slug}`}
                        className="rv-btn"
                        style={{ height: 44, flex: 1, borderRadius: 22 }}
                      >
                        Upload File
                      </Link>
                      <Link
                        href={`/s/${s.slug}`}
                        className="rv-chip"
                        style={{ height: 44, flex: 'none' }}
                      >
                        View Shop
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-2 text-xs text-[var(--rv-muted,#566274)]" aria-label="Site">
          <Link href="/orders" className="underline hover:text-[var(--rv-ink,#0F172A)]">My orders</Link>
          <span aria-hidden="true">·</span>
          <Link href="/track" className="underline hover:text-[var(--rv-ink,#0F172A)]">Track your order</Link>
          <span aria-hidden="true">·</span>
          <Link href="/help" className="underline hover:text-[var(--rv-ink,#0F172A)]">Help</Link>
          <span aria-hidden="true">·</span>
          <Link href="/about" className="underline hover:text-[var(--rv-ink,#0F172A)]">About</Link>
        </nav>
      </div>
    </CustomerShell>
  );
}
