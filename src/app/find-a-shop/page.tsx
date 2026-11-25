'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SiteHeader } from '@/components/clear/site-header';
import { SiteFooter } from '@/components/clear/site-footer';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { Input } from '@/components/clear/input';
import { StatusPill } from '@/components/clear/status-pill';
import { SkeletonCard } from '@/components/clear/skeleton';
import {
  clearStoredLocation,
  filterShops,
  geolocationErrorMessage,
  loadStoredLocation,
  parseOpenStatus,
  requestGeolocation,
  saveStoredLocation,
  type CustomerLocation,
  type GeolocationFailure,
  type NearbyShop,
  type ServiceFilter,
} from '@/lib/location/shop-filters';

/**
 * /find-a-shop — mobile-first shop discovery.
 *
 * Header: SiteHeader (Printelyx). Footer: SiteFooter.
 *
 * Data contract (GET /api/shops/nearby, built in parallel by worker A):
 *   ?lat&lng&radius&search&openNow&service&page&limit
 *   → { data: { shops: [{ id, name, slug, address, latitude, longitude,
 *       distanceKm, distanceLabel, openStatus, pricingSummary,
 *       availableServices, acceptingOrders }], page, total } }
 * Shops without coordinates have distanceKm null — shown without a
 * distance, never with an invented one. Rating is rendered ONLY when the
 * API returns a real non-null number (it currently does not, so no stars
 * appear); no fake 4.5★, no stock photos, no hardcoded shops.
 *
 * No location → falls back to GET /api/v1/shops?limit=50 (existing
 * endpoint: { data: { shops: [{ id, name, slug, address, isOpen,
 * pricingSummary, ... }], pagination: { total, hasNext } } }), which has
 * no coordinates, so the map shows its "no located shops yet" state and
 * the list still works. Client-side filterShops() re-applies every filter
 * locally, so the list stays correct even if the server ignores a param.
 *
 * Location lives in sessionStorage only (never localStorage) and precise
 * coordinates are sent only to /api/shops/nearby — never to analytics.
 * Geolocation is requested ONLY from the "Detect my location" tap.
 */

// Leaflet touches `window` at import time — dynamic import, no SSR.
const ShopMap = dynamic(() => import('@/components/clear/shop-map').then((m) => m.ShopMap), {
  ssr: false,
  loading: () => (
    <div
      className="flex min-h-[320px] items-center justify-center rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] text-sm text-[var(--label-2)]"
      role="status"
    >
      Loading map…
    </div>
  ),
});

const PAGE_SIZE = 20;

/** Fallback /api/v1/shops shop shape (no coordinates, no openStatus). */
interface FallbackShop {
  id: string;
  name: string;
  slug: string;
  address: string;
  isOpen: boolean;
  pricingSummary?: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number } | null;
  logoUrl?: string | null;
}

function toNearbyShop(s: FallbackShop): NearbyShop {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    address: s.address,
    latitude: null,
    longitude: null,
    distanceKm: null,
    openStatus: s.isOpen ? 'open' : 'closed',
    pricingSummary: s.pricingSummary ?? null,
    availableServices: null,
    acceptingOrders: null,
    logoUrl: s.logoUrl ?? null,
    rating: null,
  };
}

function formatPaise(paise: number | null | undefined): string | null {
  if (paise == null) return null;
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}

/** Neutral logo block: the shop's own logo, or its initial — never a stock photo. */
function ShopLogo({ shop }: { shop: NearbyShop }) {
  const [failed, setFailed] = useState(false);
  const initial = (shop.name.trim()[0] ?? '?').toUpperCase();
  if (shop.logoUrl && !failed) {
    return (
      <img
        src={shop.logoUrl}
        alt=""
        className="size-12 shrink-0 rounded-[var(--radius-input)] object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-[var(--fill)] text-lg font-bold text-[var(--label-2)]"
    >
      {initial}
    </span>
  );
}

export default function FindAShopPage() {
  const [location, setLocation] = useState<CustomerLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locErrorCode, setLocErrorCode] = useState<GeolocationFailure | null>(null);
  const [query, setQuery] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [debouncedPlace, setDebouncedPlace] = useState('');
  // Filter pickers were removed per the reference redesign: this tab IS
  // "Near me" — the list is location-sorted whenever a location is known,
  // no open/service/radius pickers. The values remain constants so the
  // nearby fetch + client-side filter contracts are unchanged.
  const openNow = false;
  const nearMe = true;
  const service: ServiceFilter = 'all';
  const radiusKm = 10;
  const [view, setView] = useState<'list' | 'map'>('list');
  const [shops, setShops] = useState<NearbyShop[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const abortRef = useRef<AbortController | null>(null);

  // Restore a location granted earlier in this tab (sessionStorage only).
  useEffect(() => {
    setLocation(loadStoredLocation());
  }, []);

  // Auto-detect on first visit — this tab is "Near me", so the location
  // prompt fires once automatically instead of waiting for the button.
  // Failures are silent here: the detect button + error copy below stay
  // as the explicit path (no loop of repeated permission prompts).
  const autoDetectRef = useRef(false);
  useEffect(() => {
    if (autoDetectRef.current) return;
    autoDetectRef.current = true;
    if (loadStoredLocation()) return;
    void (async () => {
      try {
        const loc = await requestGeolocation();
        saveStoredLocation(loc);
        setLocation(loc);
      } catch {
        // No permission / unavailable — the UI below explains the fallback.
      }
    })();
  }, []);

  // Debounce the two search fields so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setDebouncedPlace(placeQuery);
    }, 300);
    return () => clearTimeout(t);
  }, [query, placeQuery]);

  const fetchShops = useCallback(
    async (pageToLoad: number, append: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        if (location) {
          const params = new URLSearchParams({
            lat: String(location.lat),
            lng: String(location.lng),
            radius: String(radiusKm),
            page: String(pageToLoad),
            limit: String(PAGE_SIZE),
          });
          if (debouncedQuery.trim()) params.set('search', debouncedQuery.trim());
          if (openNow) params.set('openNow', 'true');
          if (service !== 'all') params.set('service', service);
          const res = await fetch(`/api/shops/nearby?${params}`, { signal: ctrl.signal });
          if (res.status === 404) {
            // Nearby endpoint not deployed yet — fall through to the
            // existing list endpoint instead of showing an error.
            throw Object.assign(new Error('nearby-missing'), { fallback: true });
          }
          if (!res.ok) throw new Error(`nearby-${res.status}`);
          const body = (await res.json()) as {
            data?: { shops?: NearbyShop[]; page?: number; total?: number };
          };
          const list = body.data?.shops ?? [];
          setUsedFallback(false);
          setShops((prev) => (append ? [...prev, ...list] : list));
          setTotal(body.data?.total ?? list.length);
        } else {
          const params = new URLSearchParams({ limit: '50' });
          if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
          const res = await fetch(`/api/v1/shops?${params}`, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`shops-${res.status}`);
          const body = (await res.json()) as {
            data?: { shops?: FallbackShop[]; pagination?: { total?: number } };
          };
          const list = (body.data?.shops ?? []).map(toNearbyShop);
          setUsedFallback(true);
          setShops(list);
          setTotal(body.data?.pagination?.total ?? list.length);
        }
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') return;
        if ((cause as { fallback?: boolean })?.fallback) {
          // Retry once against the existing endpoint.
          try {
            const res = await fetch('/api/v1/shops?limit=50', { signal: ctrl.signal });
            if (!res.ok) throw new Error(`shops-${res.status}`);
            const body = (await res.json()) as {
              data?: { shops?: FallbackShop[]; pagination?: { total?: number } };
            };
            const list = (body.data?.shops ?? []).map(toNearbyShop);
            setUsedFallback(true);
            setShops(list);
            setTotal(body.data?.pagination?.total ?? list.length);
            return;
          } catch {
            /* fall through to the error state below */
          }
        }
        setError('load-failed');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [location, radiusKm, debouncedQuery, openNow, service],
  );

  // Refetch whenever location / radius / search / filters change (page resets to 1).
  useEffect(() => {
    setPage(1);
    void fetchShops(1, false);
    return () => abortRef.current?.abort();
  }, [fetchShops]);

  const handleDetectLocation = useCallback(async () => {
    setLocating(true);
    setLocError(null);
    setLocErrorCode(null);
    try {
      const loc = await requestGeolocation();
      saveStoredLocation(loc);
      setLocation(loc);
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code ?? 'unavailable';
      setLocErrorCode(code);
      setLocError(geolocationErrorMessage(code));
    } finally {
      setLocating(false);
    }
  }, []);

  const handleChangeLocation = useCallback(() => {
    clearStoredLocation();
    setLocation(null);
    setLocError(null);
    setLocErrorCode(null);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Client-side safety net over whatever the server returned.
  const visible = useMemo(
    () =>
      filterShops(shops, {
        search: debouncedQuery,
        placeQuery: debouncedPlace,
        openNowOnly: openNow,
        service,
        radiusKm,
        hasLocation: nearMe && location != null,
      }),
    [shops, debouncedQuery, debouncedPlace, openNow, service, radiusKm, nearMe, location],
  );

  const locatedCount = useMemo(
    () => shops.filter((s) => s.latitude != null && s.longitude != null).length,
    [shops],
  );
  const hasMore = !usedFallback && location != null && shops.length < total;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--ground)]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-[calc(76px+env(safe-area-inset-bottom))] py-6 lg:px-8 lg:pb-6">
        <h1 className="type-page">
          Find a shop near you
        </h1>
        <p className="mt-1 text-base text-[var(--label-2)]">
          Print shops around you — open hours, prices and distance, no account needed.
        </p>

        {/* Filter pickers removed per the reference redesign — results
            only, location auto-detected above. */}
        <div className="mt-6 flex flex-col gap-6">
          {/* Results column. */}
          <div className="min-w-0">
            {/* Location */}
            <section
              className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
              aria-label="Your location"
            >
              {location ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-[var(--label)]">
                    <span className="font-medium">{location.label}</span>
                    <span className="block text-[13px] text-[var(--label-2)]">
                      Showing shops within {radiusKm} km of you.
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={handleChangeLocation}
                    className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-medium text-[var(--accent-tint-text)]"
                  >
                    Change location
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => void handleDetectLocation()}
                    disabled={locating}
                    className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
                  >
                    {locating ? 'Detecting your location…' : 'Detect my location'}
                  </button>
                  {locError && (
                    <p className="text-[13px] text-[var(--label-2)]" role="alert">
                      {locError}
                    </p>
                  )}
                  {locError && (locErrorCode === 'unavailable' || locErrorCode === 'timeout') && (
                    <span>
                      <button
                        type="button"
                        onClick={() => void handleDetectLocation()}
                        disabled={locating}
                        className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
                      >
                        {locating ? 'Detecting…' : 'Try again'}
                      </button>
                    </span>
                  )}
                  <p className="text-[13px] text-[var(--label-2)]">
                    Or enter an area, city or PIN code below — no location permission needed.
                  </p>
                </div>
              )}
            </section>

            {/* Search */}
            <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4">
              <Input
                id="shop-search"
                label="Search shops"
                value={query}
                onChange={setQuery}
                placeholder="Search by shop name or address"
                autoComplete="off"
              />
              <div className="mt-3">
                <Input
                  id="place-search"
                  label="Area, city or PIN code"
                  value={placeQuery}
                  onChange={setPlaceQuery}
                  placeholder="e.g. Jubilee Hills, Hyderabad, 500033"
                  autoComplete="off"
                  hint="Matched against shop addresses only — no map lookup, no location needed."
                />
              </div>
            </div>

            {/* Map / list toggle */}
            <div
              className="mt-4 inline-flex rounded-full bg-[var(--fill)] p-1"
              role="group"
              aria-label="View"
            >
              {(['list', 'map'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`min-h-[44px] rounded-full px-5 text-sm font-medium ${
                    view === v
                      ? 'bg-[var(--surface)] text-[var(--label)] shadow-sm'
                      : 'text-[var(--label-2)]'
                  }`}
                >
                  {v === 'list' ? 'List' : 'Map'}
                </button>
              ))}
            </div>

            {/* Map */}
            <div className={`mt-4 ${view === 'list' ? 'hidden lg:block' : 'block'}`}>
              <ShopMap
                shops={visible}
                userLocation={location}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </div>

            {/* Results */}
            <section className={`mt-4 ${view === 'map' ? 'hidden lg:block' : 'block'}`} aria-label="Shops">
              {error ? (
                <div
                  className="flex min-h-[60px] items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3"
                  role="alert"
                >
                  <span className="text-sm text-[var(--label)]">
                    Couldn&apos;t load shops
                    <span className="block text-[13px] text-[var(--label-2)]">
                      This is usually temporary. Try again.
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPage(1);
                      void fetchShops(1, false);
                    }}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-medium text-[var(--accent-tint-text)]"
                  >
                    Try again
                  </button>
                </div>
              ) : loading ? (
                <div className="flex flex-col gap-3" aria-busy="true">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : visible.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-6 text-center">
                  <p className="text-sm font-medium text-[var(--label)]">
                    {location
                      ? `No shops within ${radiusKm} km of you yet`
                      : 'No shops found'}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--label-2)]">
                    {location
                      ? 'New shops appear here as they register — try a search or scan a shop QR code.'
                      : 'Try a different search, or scan a shop QR code.'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[13px] text-[var(--label-2)]" role="status">
                    {visible.length} {visible.length === 1 ? 'shop' : 'shops'}
                    {location ? ` within ${radiusKm} km` : ''}
                    {usedFallback ? ' — distances unavailable' : ''}
                  </p>
                  {location && locatedCount === 0 && (
                    <p className="mb-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--label-2)]" role="status">
                      No shops near you have shared a map location yet — showing all shops below
                      without distances. Ask a shop to add its location, or search by area instead.
                    </p>
                  )}
                  <ul className="flex flex-col gap-3">
                    {visible.map((shop) => {
                      const { isOpen, closesAt } = parseOpenStatus(shop.openStatus);
                      const bw = formatPaise(shop.pricingSummary?.bwA4PerPage);
                      const colour = formatPaise(shop.pricingSummary?.colorA4PerPage);
                      const distance =
                        shop.distanceLabel ??
                        (shop.distanceKm != null ? `≈ ${shop.distanceKm} km away` : null);
                      const statusLine =
                        isOpen === true
                          ? closesAt
                            ? `Open · Closes at ${closesAt}`
                            : 'Open'
                          : isOpen === false
                            ? 'Closed'
                            : 'Hours not listed';
                      return (
                        <li
                          key={shop.id}
                          ref={(el) => {
                            if (el) cardRefs.current.set(shop.id, el);
                            else cardRefs.current.delete(shop.id);
                          }}
                          className={`rounded-[var(--radius-card)] border bg-[var(--surface)] ${
                            selectedId === shop.id
                              ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                              : 'border-[var(--hairline)]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelect(shop.id)}
                            className="block w-full p-4 text-left"
                            aria-label={`${shop.name}, ${statusLine}`}
                          >
                            <span className="flex items-start gap-3">
                              <ShopLogo shop={shop} />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-base font-semibold text-[var(--label)]">
                                    {shop.name}
                                  </span>
                                  {isOpen === true ? (
                                    <StatusPill status="ready" label="Open" />
                                  ) : isOpen === false ? (
                                    <StatusPill status="error" label="Closed" />
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block text-[13px] text-[var(--label-2)]">
                                  {statusLine}
                                  {distance ? ` · ${distance}` : ''}
                                </span>
                                <span className="mt-0.5 block truncate text-[13px] text-[var(--label-2)]">
                                  {shop.address}
                                </span>
                                {/* Rating: only a real non-null value from the API. */}
                                {typeof shop.rating === 'number' && shop.rating > 0 && (
                                  <span className="mt-0.5 block text-[13px] text-[var(--label-2)]">
                                    ★ {shop.rating.toFixed(1)} / 5
                                  </span>
                                )}
                                {(bw || colour) && (
                                  <span className="mt-0.5 block text-[13px] text-[var(--label-2)]">
                                    {bw ? `B&W ${bw}/page` : ''}
                                    {bw && colour ? ' · ' : ''}
                                    {colour ? `Colour ${colour}/page` : ''}
                                  </span>
                                )}
                                {shop.acceptingOrders === false && (
                                  <span className="mt-0.5 block text-[13px] text-[var(--label-2)]">
                                    Not accepting orders right now
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                          <span className="block border-t border-[var(--hairline)] px-4 py-2">
                            <Link
                              href={`/s/${shop.slug}`}
                              className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--accent)]"
                            >
                              View shop →
                            </Link>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {hasMore && (
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => {
                        const next = page + 1;
                        setPage(next);
                        void fetchShops(next, true);
                      }}
                      className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-[var(--accent-tint)] px-5 text-sm font-medium text-[var(--accent-tint-text)] disabled:opacity-60"
                    >
                      {loadingMore ? 'Loading…' : 'Load more shops'}
                    </button>
                  )}
                </>
              )}
            </section>

            <p className="mt-3 text-[13px] text-[var(--label-2)]">
              Distances are approximate straight-line distances. Shop hours and prices are as
              listed by the shop.
            </p>
            <nav
              className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--label-2)]"
              aria-label="Site"
            >
              <Link href="/orders" className="underline hover:text-[var(--label)]">
                My orders
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/track" className="underline hover:text-[var(--label)]">
                Track your order
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/help" className="underline hover:text-[var(--label)]">
                Help
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/about" className="underline hover:text-[var(--label)]">
                About
              </Link>
            </nav>
          </div>
        </div>
      </main>
      <SiteFooter />
      {/* Persistent consumer tab bar — same navigation model as every
          other consumer screen (mobile only; lg handled by SiteHeader). */}
      <ConsumerTabBar />
    </div>
  );
}
