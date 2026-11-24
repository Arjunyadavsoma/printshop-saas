'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CustomerShell } from '@/components/clear/customer-shell';
import { Input } from '@/components/clear/input';
import { StatusPill } from '@/components/clear/status-pill';
import { readRecentOrders, type RecentOrderSummary } from '@/lib/customer/recent-orders';
import { readPendingOrder, type PendingOrder } from '@/lib/customer/order-restore';
import { formatRupees } from '@/components/clear/price-breakdown';
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
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
  }, [shops, query]);

  const sidebar = (
    <div className="flex flex-col gap-4">
      <section
        className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
        aria-labelledby="qr-heading"
      >
        <h2 id="qr-heading" className="text-sm font-semibold text-[var(--label)] text-center">
          Scan a shop QR code
        </h2>
        {/* Placeholder, not a QR code: the QR payload/URL format is
            unspecified in the spec (§D.5), so no fake scannable code is
            rendered. Point the camera at the QR code at the shop counter. */}
        <div
          className="mt-3 flex min-h-[120px] items-center justify-center rounded-[var(--radius-default)] border-2 border-dashed border-[var(--hairline)] bg-[var(--fill)] px-4 text-center text-sm text-[var(--label-2)]"
          aria-hidden="true"
        >
          Point your camera at a shop&apos;s QR code to go straight to its page.
        </div>
      </section>

      <section
        className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
        aria-labelledby="run-shop-heading"
      >
        <h2 id="run-shop-heading" className="text-base font-semibold text-[var(--label)]">
          Run a print shop?
        </h2>
        <p className="mt-0.5 text-sm text-[var(--label-2)]">Get a QR code and start taking orders.</p>
        <div className="mt-3 divide-y divide-[var(--hairline)]">
          <Link href="/shop/register" className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm font-medium text-[var(--label)]">
            Register your shop <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
          </Link>
          <Link href="/shop/login" className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm font-medium text-[var(--label)]">
            Shopkeeper login <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
          </Link>
        </div>
      </section>
    </div>
  );

  return (
    <CustomerShell shopName="Printelyx" sidebar={sidebar}>
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">Print without the queue</h1>
      <p className="mt-1 text-base text-[var(--label-2)]">Find a shop near you, or scan its QR code.</p>

      {/* Find a shop near me — map + distance search on /find-a-shop. */}
      <div className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <Link href="/find-a-shop" className="flex min-h-[48px] items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-base font-semibold text-[var(--label)]">Find a shop near me</span>
            <span className="block text-[13px] text-[var(--label-2)]">
              {savedLocation
                ? 'Your location is saved for this tab — see shops by distance.'
                : 'See shops on a map, sorted by distance.'}
            </span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-[var(--label-3)]">›</span>
        </Link>
        <button
          type="button"
          onClick={() => void handleDetectAndFind()}
          disabled={locating}
          className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
        >
          {locating ? 'Detecting your location…' : 'Detect my location'}
        </button>
        {locError && (
          <p className="mt-2 text-[13px] text-[var(--label-2)]" role="alert">
            {locError}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <Input
          id="shop-search"
          label="Search shops"
          value={query}
          onChange={setQuery}
          placeholder="Search by shop name or area"
          autoComplete="off"
        />
      </div>

      {pendingOrder && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]">
          <Link href={`/s/${pendingOrder.shopSlug}`} className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--label)]">
                Continue paying — Order {pendingOrder.orderNumber ?? '—'} · {formatRupees(pendingOrder.totalPaise)}
              </span>
              <span className="block truncate text-[13px] text-[var(--label-2)]">
                {pendingOrder.shopName ?? ''} — your payment was interrupted
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-[var(--label-3)]">›</span>
          </Link>
        </div>
      )}

      {recentOrder && pendingOrder?.token !== recentOrder.token && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]">
          <Link href={`/o/${recentOrder.token}`} className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--label)]">
                Order {recentOrder.orderNumber ?? '—'}
              </span>
              <span className="block truncate text-[13px] text-[var(--label-2)]">
                {recentOrder.shopName ?? ''} — track your order
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-[var(--label-3)]">›</span>
          </Link>
        </div>
      )}

      <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]" aria-label="Shops">
        {error ? (
          <div className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3" role="alert">
            <span className="text-sm text-[var(--label)]">
              Couldn&apos;t load shops
              <span className="block text-[13px] text-[var(--label-2)]">This is usually temporary. Try again.</span>
            </span>
            <button
              type="button"
              onClick={() => void loadShops()}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-medium text-[var(--accent-tint-text)]"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="px-4 py-3 text-sm text-[var(--label-2)]" aria-busy="true">Looking for shops nearby…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-3 text-sm text-[var(--label)]">
            No shops found{query ? ' for your search' : ''}
            <span className="block text-[13px] text-[var(--label-2)]">Scan a shop&apos;s QR code to go straight to its page.</span>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {filtered.map((s) => {
              // Reference card: image left, info right; the actions row
              // (Upload File / View Shop) appears ONLY when the shop is
              // tapped — one card expanded at a time. The queue line is
              // honest: only shown when the shop is open, with the wait
              // estimate only when a printer is actually online.
              const expanded = expandedShopId === s.id;
              const queueLine = !s.isOpen
                ? 'Closed — opens at the next opening time.'
                : s.waitMinutes != null
                  ? `Queue: ${s.queueCount ?? 0} waiting · Ready in ~${s.waitMinutes} mins`
                  : (s.queueCount ?? 0) > 0
                    ? `Queue: ${s.queueCount} waiting`
                    : 'No queue right now';
              const initial = s.name.trim().charAt(0).toUpperCase() || 'S';
              return (
                <li key={s.id} className={expanded ? 'bg-[var(--fill)]' : ''}>
                  <button
                    type="button"
                    onClick={() => setExpandedShopId(expanded ? null : s.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    {s.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- shop logo URLs are operator-provided; next/image config churn not worth it here
                      <img
                        src={s.image}
                        alt=""
                        className="size-14 shrink-0 rounded-[var(--radius-card)] border border-[var(--hairline)] object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--accent-tint)] text-lg font-extrabold text-[var(--accent-tint-text)]"
                      >
                        {initial}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--label)]">{s.name}</span>
                        {s.isOpen ? (
                          <StatusPill status="ready" label="Open" />
                        ) : (
                          <StatusPill status="error" label="Closed" />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-[var(--label-2)]">
                        {[s.distanceLabel, s.address].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className={`mt-0.5 block truncate text-[13px] ${s.isOpen ? 'text-[var(--label-2)]' : 'text-[var(--label-3)]'}`}>
                        {queueLine}
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="flex gap-2 px-4 pb-3 pl-[76px]">
                      <Link
                        href={`/s/${s.slug}`}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--on-accent)]"
                      >
                        Upload File
                      </Link>
                      <Link
                        href={`/s/${s.slug}`}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[13px] font-medium text-[var(--label)]"
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
      </section>

      <p className="mt-3 text-[13px] text-[var(--label-2)]">Scan a shop&apos;s QR code to go straight to its page.</p>

      <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--label-2)]" aria-label="Site">
        <Link href="/orders" className="underline hover:text-[var(--label)]">My orders</Link>
        <span aria-hidden="true">·</span>
        <Link href="/track" className="underline hover:text-[var(--label)]">Track your order</Link>
        <span aria-hidden="true">·</span>
        <Link href="/help" className="underline hover:text-[var(--label)]">Help</Link>
        <span aria-hidden="true">·</span>
        <Link href="/about" className="underline hover:text-[var(--label)]">About</Link>
      </nav>
    </CustomerShell>
  );
}
