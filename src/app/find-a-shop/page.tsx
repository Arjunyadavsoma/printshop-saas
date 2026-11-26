'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { List, LocateFixed, Map as MapIcon, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { SiteHeader } from '@/components/clear/site-header';
import { SiteFooter } from '@/components/clear/site-footer';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { Input } from '@/components/clear/input';
import { Sheet } from '@/components/clear/sheet';
import { Chip } from '@/components/clear/chip';
import { Switch } from '@/components/clear/switch';
import { SegmentedControl } from '@/components/clear/segmented-control';
import { SkeletonBox } from '@/components/clear/skeleton';
import { ShopCard, serviceLabel } from '@/components/discovery/ShopCard';
import { formatRupeesFromPaise } from '@/components/discovery/format';
import {
  clearStoredLocation,
  geolocationErrorMessage,
  loadStoredLocation,
  parseOpenStatus,
  requestGeolocation,
  saveStoredLocation,
  type CustomerLocation,
  type GeolocationFailure,
  type NearbyShop,
} from '@/lib/location/shop-filters';
import { readRecentShops, type RecentShop } from '@/lib/customer/recent-shops';

/**
 * /find-a-shop — premium shop discovery.
 *
 * Header: SiteHeader (Printelyx). Footer: SiteFooter. Mobile: ConsumerTabBar.
 *
 * Data — exactly two endpoints, nothing invented:
 *
 *  1. GET /api/shops/nearby (when a location is known)
 *       ?lat&lng&radius&search&openNow&service&sort&page&limit
 *       radius ∈ {1,3,5,10,25} (anything else 400s — the segmented control
 *       only ever sends those five), service is an exact servicesJson key,
 *       sort=nearest needs lat/lng. Response
 *       { data: { locatedCount, shops: NearbyShop[], pagination, query } }.
 *       `openStatus` arrives as a human label ("Open now", "Closed",
 *       "Closes at 9:00 PM", "Opens today at 9:00 AM",
 *       "Temporarily unavailable"). ShopCard's parseOpenStatus only matches
 *       bare "open"/"closed", so the label is NORMALISED into
 *       { isOpen: boolean } below — a pure reading of the server's own
 *       label, not a fabricated status.
 *
 *  2. GET /api/v1/shops?limit=50&q=<search> (fallback when location is
 *     unknown, or when the nearby call 404/400s). These shops carry NO
 *     distance / openStatus / services, so the page renders them without
 *     distance chips and with an honest "Hours not listed" chip — never a
 *     status guessed from thin air — and shows a "distances unavailable"
 *     note.
 *
 * rating is ALWAYS null and reviewCount ALWAYS 0 in the API (no review
 * model exists), so no stars or review counts are rendered anywhere.
 * No "Popular" / "Recommended" rails — there is no popularity data.
 *
 * Filters are real backend params (openNow, service, radius) + client-side
 * sorting (price/name — both sort on REAL fields already in the payload).
 * Filter state lives in the URL (?q=&open=1&service=&radius=&sort=) via
 * router.replace and is hydrated from it on mount, so reload / share /
 * back-into-the-page restores exactly what was on screen.
 *
 * Location lives in sessionStorage only (never localStorage) and precise
 * coordinates are sent only to /api/shops/nearby. Geolocation is requested
 * ONLY from the "Detect location" tap — never on page load.
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
const DEFAULT_RADIUS = 10;
const RADII: number[] = [1, 3, 5, 10, 25];

type SortKey = 'nearest' | 'price' | 'name';

/** Single-select service filter — values are exact servicesJson keys. */
const SERVICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All services' },
  { value: 'bw_print', label: 'B&W' },
  { value: 'color_print', label: 'Colour' },
  { value: 'scan', label: 'Scanning' },
  { value: 'binding', label: 'Binding' },
  { value: 'laminate', label: 'Lamination' },
  { value: 'a3_print', label: 'A3' },
  { value: 'photo_print', label: 'Photos' },
  { value: 'document_print', label: 'Documents' },
];
const QUICK_SERVICE_VALUES: string[] = ['color_print', 'bw_print', 'scan'];

/** GET /api/shops/nearby response envelope. */
interface NearbyResponse {
  data?: {
    locatedCount?: number;
    shops?: NearbyShop[];
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      truncated: boolean;
    };
  };
}

/** GET /api/v1/shops (fallback) shop shape — no coordinates / openStatus / services. */
interface FallbackShop {
  id: string;
  name: string;
  slug: string;
  address: string;
  isOpen: boolean;
  waitMinutes?: number | null;
  pricingSummary?: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number } | null;
  logoUrl?: string | null;
}

interface ListResponse {
  data?: { shops?: FallbackShop[]; pagination?: { total?: number; hasNext?: boolean } };
}

/**
 * The nearby API sends openStatus as a display label. Map the label back to
 * the boolean ShopCard's chip logic understands — the label is the server's
 * own status computation, so this is interpretation, not invention.
 * Unrecognised → null → the card shows the honest "Hours not listed" chip.
 */
function normalizeOpenStatus(raw: NearbyShop['openStatus']): NearbyShop['openStatus'] {
  if (typeof raw !== 'string') return raw ?? null;
  const s = raw.trim().toLowerCase();
  if (s.startsWith('open') || s.startsWith('closes at')) return { isOpen: true };
  if (s.startsWith('closed') || s.startsWith('opens ') || s.startsWith('temporarily')) {
    return { isOpen: false };
  }
  return null;
}

function withNormalizedStatus(shop: NearbyShop): NearbyShop {
  return { ...shop, openStatus: normalizeOpenStatus(shop.openStatus) };
}

/** Fallback shop → NearbyShop with EVERY unknown field left honestly null. */
function toNearbyShop(s: FallbackShop): NearbyShop {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    address: s.address,
    latitude: null,
    longitude: null,
    distanceKm: null,
    distanceLabel: null,
    openStatus: null, // no schedule data → ShopCard renders "Hours not listed"
    pricingSummary: s.pricingSummary ?? null,
    availableServices: null,
    acceptingOrders: null,
    logoUrl: s.logoUrl ?? null,
    image: null,
    rating: null,
    waitMinutes: s.waitMinutes ?? null,
  };
}

/** Shared controls for the desktop sidebar AND the mobile filter sheet. */
interface FilterControlsProps {
  hasLocation: boolean;
  openNow: boolean;
  onOpenNowChange: (v: boolean) => void;
  radiusKm: number;
  onRadiusChange: (v: number) => void;
  service: string;
  onServiceChange: (v: string) => void;
  effectiveSort: SortKey;
  onSortChange: (v: SortKey) => void;
  activeCount: number;
  onClearAll: () => void;
}

const EYEBROW = 'text-xs font-medium text-[var(--label-3)]';

function FilterControls({
  hasLocation,
  openNow,
  onOpenNowChange,
  radiusKm,
  onRadiusChange,
  service,
  onServiceChange,
  effectiveSort,
  onSortChange,
  activeCount,
  onClearAll,
}: FilterControlsProps) {
  const openNowLabelId = useId();
  return (
    <div className="flex flex-col gap-6">
      {/* Sort */}
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Sort by</span>
        <select
          value={effectiveSort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="min-h-[44px] rounded-[var(--radius-input)] border border-[var(--hairline)] bg-[var(--fill)] px-3 text-base text-[var(--label)] focus:outline-none"
        >
          {hasLocation && <option value="nearest">Nearest first</option>}
          <option value="price">Lowest B&amp;W price</option>
          <option value="name">Name A–Z</option>
        </select>
        {!hasLocation && (
          <span className="text-[12px] text-[var(--label-3)]">
            Nearest needs your location — detect it to sort by distance.
          </span>
        )}
      </label>

      {/* Open now */}
      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>Availability</span>
        <Switch checked={openNow} onChange={onOpenNowChange} aria-labelledby={openNowLabelId}>
          <span id={openNowLabelId} className="text-sm font-medium text-[var(--label)]">
            Open now
          </span>
        </Switch>
      </div>

      {/* Radius — the API only accepts 1 | 3 | 5 | 10 | 25 km. */}
      <fieldset disabled={!hasLocation} aria-label="Search radius" className="flex flex-col gap-2 disabled:opacity-50">
        <span className={EYEBROW}>Within</span>
        <SegmentedControl
          ariaLabel="Search radius in kilometres"
          options={RADII.map((r) => ({ value: String(r), label: `${r} km` }))}
          value={String(radiusKm)}
          onChange={(v) => onRadiusChange(Number(v))}
        />
        {!hasLocation && (
          <p className="text-[12px] text-[var(--label-3)]">Detect location to filter by distance.</p>
        )}
      </fieldset>

      {/* Service — single select, exact servicesJson keys. */}
      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>Service</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Service">
          {SERVICE_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={service === o.value}
              onClick={() => onServiceChange(o.value === 'all' || service === o.value ? 'all' : o.value)}
              className="px-3 py-2"
            />
          ))}
        </div>
      </div>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--fill)] px-4 text-sm font-medium text-[var(--label-2)] transition-colors hover:text-[var(--label)]"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

/** Skeleton result card — shimmering boxes that mirror a ShopCard. */
function SkeletonShopCard() {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <SkeletonBox width={48} height={48} radius="10px" />
        <div className="min-w-0 flex-1">
          <SkeletonBox height={16} width="55%" />
          <SkeletonBox height={12} width="82%" className="mt-2" />
          <SkeletonBox height={12} width="45%" className="mt-1.5" />
        </div>
      </div>
    </div>
  );
}

function SkeletonShopGrid({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading shops" className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonShopCard key={i} />
      ))}
    </div>
  );
}

/** Compact horizontal-scroll card for the discovery rails. */
function MiniShopCard({ shop, showDistance }: { shop: NearbyShop; showDistance: boolean }) {
  const bw = shop.pricingSummary?.bwA4PerPage;
  const initial = (shop.name.trim()[0] ?? '?').toUpperCase();
  return (
    <Link
      href={`/s/${shop.slug}`}
      className="w-[200px] shrink-0 snap-start rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--accent)]/40 focus-visible:outline-none"
    >
      <div className="flex items-center gap-2">
        {shop.image || shop.logoUrl ? (
          <img
            src={(shop.image ?? shop.logoUrl) as string}
            alt=""
            className="size-8 shrink-0 rounded-[8px] border border-[var(--hairline)] object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent-tint)] text-[13px] font-bold text-[var(--accent-tint-text)]"
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[var(--label)]">{shop.name}</p>
          {showDistance && shop.distanceLabel ? (
            <p className="text-[12px] font-medium text-[var(--accent-tint-text)]">{shop.distanceLabel}</p>
          ) : (
            <p className="truncate text-[12px] text-[var(--label-2)]">{shop.address || 'Address not listed'}</p>
          )}
        </div>
      </div>
      <p className="mt-2 truncate text-[12px] text-[var(--label-2)]">
        {bw != null && bw > 0
          ? `From ${formatRupeesFromPaise(bw)} B&W per page`
          : 'Pricing on request'}
      </p>
    </Link>
  );
}

/** Recently viewed pill — name + logo initial, straight to /s/[slug]. */
function RecentShopChip({ shop }: { shop: RecentShop }) {
  const initial = (shop.name.trim()[0] ?? '?').toUpperCase();
  return (
    <Link
      href={`/s/${shop.slug}`}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] py-1.5 pl-1.5 pr-3.5 transition-colors hover:border-[var(--accent)]/40 focus-visible:outline-none"
    >
      {shop.image ? (
        <img
          src={shop.image}
          alt=""
          className="size-7 rounded-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-[var(--accent-tint)] text-[12px] font-bold text-[var(--accent-tint-text)]"
        >
          {initial}
        </span>
      )}
      <span className="max-w-[160px] truncate text-[13px] font-medium text-[var(--label)]">{shop.name}</span>
    </Link>
  );
}

/** Horizontal discovery rail: title + snap-scrolling row (no page overflow). */
function DiscoveryRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-[15px] font-semibold text-[var(--label)]">{title}</h2>
      <div className="-mx-4 mt-2.5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:-mx-8 lg:px-8">
        {children}
      </div>
    </div>
  );
}

function DiscoveryRowSkeleton() {
  return (
    <div className="flex gap-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonBox key={i} width={200} height={92} radius="var(--radius-card)" />
      ))}
    </div>
  );
}

export default function FindAShopPage() {
  // ── Filter state (hydrated from the URL on mount) ──────────────────────
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [openNow, setOpenNow] = useState(false);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS);
  const [service, setService] = useState('all');
  const [sort, setSort] = useState<SortKey>('nearest');

  // ── Location ────────────────────────────────────────────────────────────
  const [location, setLocation] = useState<CustomerLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locErrorCode, setLocErrorCode] = useState<GeolocationFailure | null>(null);

  // ── View + results ──────────────────────────────────────────────────────
  const [view, setView] = useState<'list' | 'map'>('list');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shops, setShops] = useState<NearbyShop[]>([]);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Discovery sections ──────────────────────────────────────────────────
  const [recents, setRecents] = useState<RecentShop[]>([]);
  const [colourShops, setColourShops] = useState<NearbyShop[]>([]);
  const [openShops, setOpenShops] = useState<NearbyShop[]>([]);
  const [discoLoading, setDiscoLoading] = useState(false);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const belowCardRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  // Mount: restore the session location, hydrate filters from the URL
  // query string (?q=&open=1&service=&radius=&sort=), then mark hydrated
  // so the fetch + URL-sync effects run once, on real values.
  useEffect(() => {
    setLocation(loadStoredLocation());
    setRecents(readRecentShops());
    const sp = new URLSearchParams(window.location.search);
    const q = (sp.get('q') ?? '').trim();
    if (q) {
      setQuery(q);
      setDebouncedQuery(q);
    }
    if (sp.get('open') === '1') setOpenNow(true);
    const svc = sp.get('service');
    if (svc && SERVICE_OPTIONS.some((o) => o.value === svc)) setService(svc);
    const rad = Number(sp.get('radius'));
    if (RADII.includes(rad)) setRadiusKm(rad);
    const srt = sp.get('sort');
    if (srt === 'nearest' || srt === 'price' || srt === 'name') setSort(srt);
    setHydrated(true);
  }, []);

  // Debounce search (300ms) so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Mirror filter state into the URL (replace — no history spam). Defaults
  // are omitted so a clean /find-a-shop stays clean.
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (openNow) params.set('open', '1');
    if (service !== 'all') params.set('service', service);
    if (radiusKm !== DEFAULT_RADIUS) params.set('radius', String(radiusKm));
    const sortIsDefault = location ? sort === 'nearest' : sort === 'name' || sort === 'nearest';
    if (!sortIsDefault) params.set('sort', sort);
    const qs = params.toString();
    router.replace(qs ? `/find-a-shop?${qs}` : '/find-a-shop', { scroll: false });
  }, [hydrated, debouncedQuery, openNow, service, radiusKm, sort, location, router]);

  // ── Data loading ────────────────────────────────────────────────────────
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
            radius: String(radiusKm), // validated: always one of 1|3|5|10|25
            page: String(pageToLoad),
            limit: String(PAGE_SIZE),
          });
          if (debouncedQuery.trim()) params.set('search', debouncedQuery.trim());
          if (openNow) params.set('openNow', 'true');
          if (service !== 'all') params.set('service', service);
          if (sort === 'nearest') params.set('sort', 'nearest');
          const res = await fetch(`/api/shops/nearby?${params.toString()}`, { signal: ctrl.signal });
          if (res.status === 404 || res.status === 400) {
            // Nearby endpoint missing/rejecting — fall through to the
            // existing list endpoint instead of showing an error.
            throw Object.assign(new Error('nearby-unavailable'), { fallback: true });
          }
          if (!res.ok) throw new Error(`nearby-${res.status}`);
          const body = (await res.json()) as NearbyResponse;
          const list = (body.data?.shops ?? []).map(withNormalizedStatus);
          if (ctrl.signal.aborted) return;
          setUsedFallback(false);
          setShops((prev) => (append ? [...prev, ...list] : list));
          setTotal(body.data?.pagination?.total ?? list.length);
          setHasNext(body.data?.pagination?.hasNext === true);
        } else {
          // No location: the list endpoint has no distance/openStatus data.
          const params = new URLSearchParams({ limit: '50' });
          if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
          const res = await fetch(`/api/v1/shops?${params.toString()}`, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`shops-${res.status}`);
          const body = (await res.json()) as ListResponse;
          const list = (body.data?.shops ?? []).map(toNearbyShop);
          if (ctrl.signal.aborted) return;
          setUsedFallback(true);
          setShops(list);
          setTotal(body.data?.pagination?.total ?? list.length);
          setHasNext(false); // directory is capped at 50 — no distance-sorted pages
        }
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') return;
        if ((cause as { fallback?: boolean })?.fallback) {
          try {
            const q = debouncedQuery.trim();
            const res = await fetch(
              `/api/v1/shops?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
              { signal: ctrl.signal },
            );
            if (!res.ok) throw new Error(`shops-${res.status}`);
            const body = (await res.json()) as ListResponse;
            const list = (body.data?.shops ?? []).map(toNearbyShop);
            if (ctrl.signal.aborted) return;
            setUsedFallback(true);
            setShops(list);
            setTotal(body.data?.pagination?.total ?? list.length);
            setHasNext(false);
            return;
          } catch {
            /* fall through to the error state below */
          }
        }
        if (!ctrl.signal.aborted) setError('load-failed');
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [location, radiusKm, debouncedQuery, openNow, service, sort],
  );

  // Refetch (page resets to 1) whenever location / filters change — only
  // after hydration so the first request already carries the URL state.
  useEffect(() => {
    if (!hydrated) return;
    setPage(1);
    void fetchShops(1, false);
    return () => abortRef.current?.abort();
  }, [hydrated, fetchShops]);

  // ── Discovery rails (colour printing / open now) ────────────────────────
  // Shown only when the customer is just browsing: no search text and no
  // active filters. Both rails need a location (they call the nearby API).
  const showDiscovery =
    hydrated &&
    location != null &&
    !usedFallback &&
    debouncedQuery.trim() === '' &&
    !openNow &&
    service === 'all' &&
    radiusKm === DEFAULT_RADIUS;

  useEffect(() => {
    if (!showDiscovery || !location) {
      setColourShops([]);
      setOpenShops([]);
      return;
    }
    const ctrl = new AbortController();
    setDiscoLoading(true);
    const base = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      radius: String(radiusKm),
      limit: '10',
    });
    const loadRail = (
      suffix: string,
      apply: (list: NearbyShop[]) => void,
    ): Promise<void> =>
      fetch(`/api/shops/nearby?${base.toString()}${suffix}`, { signal: ctrl.signal })
        .then((r) =>
          r.ok
            ? (r.json() as Promise<NearbyResponse>)
            : Promise.reject(new Error(`nearby-${r.status}`)),
        )
        .then((b) => {
          if (!ctrl.signal.aborted) apply((b.data?.shops ?? []).map(withNormalizedStatus));
        })
        .catch(() => {
          // A failed rail is supplementary — hide it, never block the page.
          if (!ctrl.signal.aborted) apply([]);
        });
    const colour = loadRail('&service=color_print', setColourShops);
    const open = loadRail('&openNow=true', setOpenShops);
    void Promise.all([colour, open]).finally(() => {
      if (!ctrl.signal.aborted) setDiscoLoading(false);
    });
    return () => ctrl.abort();
  }, [showDiscovery, location, radiusKm]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const effectiveSort: SortKey = location ? sort : sort === 'nearest' ? 'name' : sort;

  // Client-side pass: an openNow safety net (never drops unknown status)
  // and the two purely-client sorts on REAL payload fields.
  const visible = useMemo(() => {
    let list = shops;
    if (openNow) {
      list = list.filter((s) => parseOpenStatus(s.openStatus).isOpen !== false);
    }
    if (effectiveSort === 'price') {
      list = [...list].sort(
        (a, b) =>
          (a.pricingSummary?.bwA4PerPage ?? Number.POSITIVE_INFINITY) -
          (b.pricingSummary?.bwA4PerPage ?? Number.POSITIVE_INFINITY),
      );
    } else if (effectiveSort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [shops, openNow, effectiveSort]);

  const selectedShop = useMemo(
    () => shops.find((s) => s.id === selectedId) ?? null,
    [shops, selectedId],
  );

  const activeCount =
    (openNow ? 1 : 0) + (service !== 'all' ? 1 : 0) + (radiusKm !== DEFAULT_RADIUS ? 1 : 0);
  const hasQuery = debouncedQuery.trim() !== '';

  const filterSummary = useMemo(
    () =>
      [
        hasQuery ? `“${debouncedQuery.trim()}”` : null,
        openNow ? 'Open now' : null,
        service !== 'all' ? serviceLabel(service) : null,
        location && radiusKm !== DEFAULT_RADIUS ? `within ${radiusKm} km` : null,
      ].filter((x): x is string => x != null),
    [hasQuery, debouncedQuery, openNow, service, location, radiusKm],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
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

  const handleClearLocation = useCallback(() => {
    clearStoredLocation();
    setLocation(null);
    setLocError(null);
    setLocErrorCode(null);
    setSelectedId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setOpenNow(false);
    setService('all');
    setRadiusKm(DEFAULT_RADIUS);
  }, []);

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setOpenNow(false);
    setService('all');
    setRadiusKm(DEFAULT_RADIUS);
  }, []);

  // Card hover/tap → resolve the card's slug to its id → map highlight.
  const handleCardFocusShop = useCallback(
    (slug: string | null) => {
      if (!slug) {
        setSelectedId(null);
        return;
      }
      const shop = shops.find((s) => s.slug === slug);
      setSelectedId(shop?.id ?? null);
    },
    [shops],
  );

  // Map marker tap → highlight + scroll the matching card into view.
  const handleMapSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      window.setTimeout(() => {
        const el = view === 'map' ? belowCardRef.current : cardRefs.current.get(id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    },
    [view],
  );

  const handleLoadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    void fetchShops(next, true);
  }, [page, fetchShops]);

  const filterControls = (
    <FilterControls
      hasLocation={location != null}
      openNow={openNow}
      onOpenNowChange={setOpenNow}
      radiusKm={radiusKm}
      onRadiusChange={setRadiusKm}
      service={service}
      onServiceChange={setService}
      effectiveSort={effectiveSort}
      onSortChange={setSort}
      activeCount={activeCount}
      onClearAll={clearFilters}
    />
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--ground)]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-6 lg:px-8 lg:pb-10">
        {/* Heading */}
        <h1 className="type-page">Find a print shop</h1>
        <p className="mt-1 max-w-[560px] text-[15px] text-[var(--label-2)]">
          Real shops near you — live hours, queue and per-page pricing. Search, filter and compare
          without an account.
        </p>

        {/* Search — debounced 300ms, clearable */}
        <div className="relative mt-5 max-w-[560px]">
          <Input
            id="shop-search"
            label="Search"
            value={query}
            onChange={setQuery}
            placeholder="Search by shop name or area"
            autoComplete="off"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute bottom-[8px] right-2 inline-flex size-8 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] hover:text-[var(--label)] focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Location row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {location ? (
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] pl-3.5 pr-1.5 text-sm font-medium text-[var(--label)]">
              <MapPin className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              <span className="max-w-[220px] truncate">{location.label}</span>
              <button
                type="button"
                onClick={handleClearLocation}
                aria-label="Clear saved location"
                className="inline-flex size-9 items-center justify-center rounded-full text-[var(--label-2)] transition-colors hover:bg-[var(--fill)] hover:text-[var(--label)] focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </span>
          ) : (
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-dashed border-[var(--hairline)] bg-[var(--surface)] px-3.5 text-sm text-[var(--label-2)]">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              Set location
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleDetectLocation()}
            disabled={locating}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-press)] disabled:opacity-60 focus-visible:outline-none"
          >
            <LocateFixed className="size-4" aria-hidden="true" />
            {locating ? 'Detecting…' : 'Detect location'}
          </button>
        </div>
        {locError && (
          <div className="mt-2 max-w-[560px]" role="alert">
            <p className="text-[13px] text-[var(--label-2)]">{locError}</p>
            {locErrorCode === 'denied' && (
              <p className="mt-1 text-[13px] text-[var(--label-3)]">
                Use area instead: type an area, city or PIN code in the search box — matching shops
                load without distances.
              </p>
            )}
            {(locErrorCode === 'unavailable' || locErrorCode === 'timeout') && (
              <button
                type="button"
                onClick={() => void handleDetectLocation()}
                disabled={locating}
                className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-semibold text-[var(--accent-tint-text)] disabled:opacity-60 focus-visible:outline-none"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Mobile quick chips + Filters button (desktop uses the sidebar) */}
        <div
          className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 lg:hidden"
          role="group"
          aria-label="Quick filters"
        >
          <Chip
            label="Open now"
            selected={openNow}
            onClick={() => setOpenNow((v) => !v)}
            className="shrink-0 px-3.5 py-2"
          />
          {SERVICE_OPTIONS.filter((o) => QUICK_SERVICE_VALUES.includes(o.value)).map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={service === o.value}
              onClick={() => setService(service === o.value ? 'all' : o.value)}
              className="shrink-0 px-3.5 py-2"
            />
          ))}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--label)] focus-visible:outline-none"
            aria-haspopup="dialog"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-[var(--on-accent)]">
                {activeCount}
              </span>
            )}
          </button>
        </div>

        {/* Desktop sidebar + results */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
          {/* Sidebar — ≥1024px */}
          <aside className="hidden lg:block">
            <div
              className="sticky top-6 flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
              aria-label="Filter shops"
            >
              <h2 className="text-[15px] font-semibold text-[var(--label)]">Filters</h2>
              {filterControls}
            </div>
          </aside>

          {/* Results column */}
          <div className="min-w-0">
            {/* View toggle + result count */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-full bg-[var(--fill)] p-1" role="group" aria-label="View">
                {(['list', 'map'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none ${
                      view === v
                        ? 'bg-[var(--surface)] text-[var(--label)] shadow-sm'
                        : 'text-[var(--label-2)]'
                    }`}
                  >
                    {v === 'list' ? (
                      <List className="size-4" aria-hidden="true" />
                    ) : (
                      <MapIcon className="size-4" aria-hidden="true" />
                    )}
                    {v === 'list' ? 'List' : 'Map'}
                  </button>
                ))}
              </div>
              {!loading && !error && visible.length > 0 && (
                <p className="text-[13px] text-[var(--label-2)]" role="status">
                  {usedFallback
                    ? `${visible.length} ${visible.length === 1 ? 'shop' : 'shops'} — distances unavailable`
                    : `Showing ${visible.length} of ${total} ${total === 1 ? 'shop' : 'shops'}`}
                </p>
              )}
            </div>

            {view === 'map' ? (
              /* ── Map view ── */
              <div className="mt-4">
                <ShopMap
                  shops={visible}
                  userLocation={location}
                  selectedId={selectedId}
                  onSelect={handleMapSelect}
                />
                {selectedShop && (
                  <div ref={belowCardRef} className="mt-3">
                    <ShopCard shop={selectedShop} showDistance={location != null} selected />
                  </div>
                )}
              </div>
            ) : (
              /* ── List view ── */
              <div className="mt-4" aria-label="Shops">
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
                      className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-medium text-[var(--accent-tint-text)] focus-visible:outline-none"
                    >
                      Try again
                    </button>
                  </div>
                ) : loading ? (
                  <SkeletonShopGrid count={6} />
                ) : visible.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-8 text-center">
                    <p className="text-sm font-semibold text-[var(--label)]">No shops found</p>
                    {filterSummary.length > 0 ? (
                      <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[var(--label-2)]">
                        Nothing matched {filterSummary.join(' · ')}.
                      </p>
                    ) : (
                      <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[var(--label-2)]">
                        {location
                          ? `No shops within ${radiusKm} km yet — new shops appear here as they register.`
                          : 'Try a different search, or detect your location to see shops near you.'}
                      </p>
                    )}
                    {filterSummary.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent-tint)] px-5 text-sm font-semibold text-[var(--accent-tint-text)] focus-visible:outline-none"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {usedFallback && (
                      <p
                        className="mb-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--label-2)]"
                        role="status"
                      >
                        Distances and open hours are unavailable right now — showing all matching
                        shops. Detect your location for distance-sorted results.
                      </p>
                    )}
                    <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:gap-4">
                      {visible.map((shop) => (
                        <li
                          key={shop.id}
                          ref={(el) => {
                            if (el) cardRefs.current.set(shop.id, el);
                            else cardRefs.current.delete(shop.id);
                          }}
                          className="min-w-0"
                        >
                          <ShopCard
                            shop={shop}
                            showDistance={location != null}
                            selected={selectedId === shop.id}
                            onHover={handleCardFocusShop}
                            onSelect={handleCardFocusShop}
                          />
                        </li>
                      ))}
                    </ul>
                    {!usedFallback && hasNext && (
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={handleLoadMore}
                        className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-[var(--accent-tint)] px-5 text-sm font-medium text-[var(--accent-tint-text)] disabled:opacity-60 focus-visible:outline-none"
                      >
                        {loadingMore ? 'Loading…' : 'Load more shops'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Discovery rails — real data, hidden while searching/filtering ── */}
            {showDiscovery && (
              <section aria-label="More ways to find a shop">
                {recents.length > 0 && (
                  <DiscoveryRow title="Recently viewed">
                    {recents.map((r) => (
                      <RecentShopChip key={r.slug} shop={r} />
                    ))}
                  </DiscoveryRow>
                )}
                {discoLoading && colourShops.length === 0 && openShops.length === 0 ? (
                  <div className="mt-8">
                    <DiscoveryRowSkeleton />
                  </div>
                ) : (
                  <>
                    {colourShops.length > 0 && (
                      <DiscoveryRow title="Colour printing nearby">
                        {colourShops.map((s) => (
                          <MiniShopCard key={s.id} shop={s} showDistance={location != null} />
                        ))}
                      </DiscoveryRow>
                    )}
                    {openShops.length > 0 && (
                      <DiscoveryRow title="Open now">
                        {openShops.map((s) => (
                          <MiniShopCard key={s.id} shop={s} showDistance={location != null} />
                        ))}
                      </DiscoveryRow>
                    )}
                  </>
                )}
              </section>
            )}

            <p className="mt-4 text-[13px] text-[var(--label-2)]">
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

      {/* Mobile filter sheet — same controls as the desktop sidebar */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        footer={
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-[48px] items-center rounded-full px-4 text-sm font-medium text-[var(--label-2)] focus-visible:outline-none"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] focus-visible:outline-none"
            >
              Show results
            </button>
          </div>
        }
      >
        {filterControls}
      </Sheet>

      <SiteFooter />
      {/* Persistent consumer tab bar — same navigation model as every
          other consumer screen (mobile only; lg handled by SiteHeader). */}
      <ConsumerTabBar />
    </div>
  );
}
