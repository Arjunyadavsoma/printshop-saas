/**
 * Find-a-shop helpers — pure, testable logic for /find-a-shop.
 *
 * Kept free of React / fetch / DOM so the filter behaviour can be unit
 * tested on plain shop objects (see shop-filters.test.ts). The page also
 * asks the server to filter (GET /api/shops/nearby) — these client-side
 * filters are the safety net, so the list stays correct even if the server
 * ignores a parameter, and they are the ONLY filter for the
 * /api/v1/shops fallback, which has no location parameters at all.
 *
 * No fake data here: shops without coordinates keep `distanceKm: null`
 * and are never given an invented distance; shops without a real rating
 * keep `rating: null` and the card renders no stars.
 */

/** A shop as returned by GET /api/shops/nearby (worker A contract). */
export interface NearbyShop {
  id: string;
  name: string;
  slug: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Straight-line distance from the customer, km. Null = shop has no coordinates. */
  distanceKm: number | null;
  /** Pre-formatted by the API when present, e.g. "1.2 km". */
  distanceLabel?: string | null;
  /**
   * Open status. The contract names this `openStatus`; its exact shape is
   * worker A's to settle, so accept the forms a JSON API plausibly sends:
   * a boolean, a string ('open' / 'closed'), or an object with an isOpen /
   * open / status flag plus an optional closing time.
   */
  openStatus?:
    | boolean
    | string
    | {
        isOpen?: boolean;
        open?: boolean;
        status?: string;
        closesAt?: string | null;
        closingTime?: string | null;
      }
    | null;
  pricingSummary?: {
    bwA4PerPage?: number | null;
    colorA4PerPage?: number | null;
    minOrderValue?: number | null;
  } | null;
  availableServices?: string[] | null;
  acceptingOrders?: boolean | null;
  /** Shop logo URL when the shopkeeper uploaded one; null otherwise. */
  logoUrl?: string | null;
  /** Real rating ONLY when the API returns a non-null number; otherwise null (no stars rendered). */
  rating?: number | null;
}

export type ServiceFilter = 'all' | 'bw' | 'colour';

export interface ShopFilterOptions {
  /** Free text matched against name / address / slug (and PIN digits in the address). */
  search?: string;
  /** Manual location text — area / city / PIN — matched against the address only. */
  placeQuery?: string;
  /** Keep only shops that are currently open. Unknown status is kept: absence of a status is not proof a shop is closed. */
  openNowOnly?: boolean;
  /** 'bw' = offers B&W, 'colour' = offers colour. Derived from pricingSummary / availableServices. */
  service?: ServiceFilter;
  /** Max straight-line distance in km. Shops with unknown distance are kept (they cannot be proven out of range). */
  radiusKm?: number | null;
  /** When false there is no customer location, so radius / near-me sorting do not apply. */
  hasLocation?: boolean;
}

export interface ParsedOpenStatus {
  /** true = open, false = closed, null = the API did not say. */
  isOpen: boolean | null;
  /** Closing time as sent by the API (e.g. "21:00" / ISO string), or null. */
  closesAt: string | null;
}

/** Normalise the several plausible `openStatus` shapes into one. */
export function parseOpenStatus(openStatus: NearbyShop['openStatus']): ParsedOpenStatus {
  if (openStatus == null) return { isOpen: null, closesAt: null };
  if (typeof openStatus === 'boolean') return { isOpen: openStatus, closesAt: null };
  if (typeof openStatus === 'string') {
    const s = openStatus.trim().toLowerCase();
    if (s === 'open' || s === 'opened') return { isOpen: true, closesAt: null };
    if (s === 'closed' || s === 'close') return { isOpen: false, closesAt: null };
    return { isOpen: null, closesAt: null };
  }
  const flag = openStatus.isOpen ?? openStatus.open ?? null;
  if (typeof flag === 'boolean') {
    return { isOpen: flag, closesAt: openStatus.closesAt ?? openStatus.closingTime ?? null };
  }
  if (typeof openStatus.status === 'string') {
    const s = openStatus.status.trim().toLowerCase();
    if (s === 'open' || s === 'opened') {
      return { isOpen: true, closesAt: openStatus.closesAt ?? openStatus.closingTime ?? null };
    }
    if (s === 'closed' || s === 'close') {
      return { isOpen: false, closesAt: openStatus.closesAt ?? openStatus.closingTime ?? null };
    }
  }
  return { isOpen: null, closesAt: openStatus.closesAt ?? openStatus.closingTime ?? null };
}

function normalise(text: string | null | undefined): string {
  return (text ?? '').trim().toLowerCase();
}

function offersService(shop: NearbyShop, service: Exclude<ServiceFilter, 'all'>): boolean {
  const services = (shop.availableServices ?? []).map((s) => normalise(s));
  const pricing = shop.pricingSummary ?? null;
  if (service === 'bw') {
    if (services.some((s) => s === 'bw' || s.includes('black') || s.includes('b&w') || s === 'b/w')) return true;
    // A listed B&W per-page price means B&W is offered.
    return pricing?.bwA4PerPage != null && pricing.bwA4PerPage > 0;
  }
  if (services.some((s) => s === 'colour' || s === 'color' || s.includes('colour') || s.includes('color'))) return true;
  return pricing?.colorA4PerPage != null && pricing.colorA4PerPage > 0;
}

/**
 * Apply the find-page filters to a plain shop list. Pure: no I/O, no
 * mutation of the input array (returns a new, distance-sorted array).
 *
 * Sorting: by distanceKm ascending when a location is known; shops with
 * unknown distance sort last, in their original relative order.
 */
export function filterShops(shops: NearbyShop[], options: ShopFilterOptions = {}): NearbyShop[] {
  const search = normalise(options.search);
  const placeQuery = normalise(options.placeQuery);
  const hasLocation = options.hasLocation ?? false;
  const radiusKm = options.radiusKm ?? null;

  const kept = shops.filter((shop) => {
    if (search) {
      const haystack = [shop.name, shop.address, shop.slug].map(normalise).join(' ');
      if (!haystack.includes(search)) return false;
    }
    if (placeQuery) {
      // Manual location entry: area / city / PIN — address only, no geocoding.
      if (!normalise(shop.address).includes(placeQuery)) return false;
    }
    if (options.openNowOnly) {
      const { isOpen } = parseOpenStatus(shop.openStatus);
      if (isOpen === false) return false;
    }
    if (options.service && options.service !== 'all') {
      if (!offersService(shop, options.service)) return false;
    }
    if (hasLocation && radiusKm != null && shop.distanceKm != null) {
      if (shop.distanceKm > radiusKm) return false;
    }
    return true;
  });

  if (!hasLocation) return kept;
  // Stable sort by distance; unknown distance (null) sorts last.
  return [...kept].sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

// ── Geolocation + stored location (sessionStorage only) ─────────────────────
// The customer location is kept in sessionStorage, never localStorage, so
// it dies with the tab, and precise coordinates are never sent anywhere
// except the nearby-shops API call that needs them.

export interface CustomerLocation {
  lat: number;
  lng: number;
  /** Human label when known ("Your location" / the manual place text). */
  label: string;
}

export const STORED_LOCATION_KEY = 'printelyx:find-location';

export type GeolocationFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/**
 * Ask the browser for the customer's position. Called ONLY from a user
 * gesture (the "Detect my location" button) — never on page load, so the
 * permission prompt never appears uninvited.
 * timeout 10s, enableHighAccuracy false (cell/Wi-Fi fix is enough for
 * shop discovery and is faster + cheaper on battery).
 */
export function requestGeolocation(): Promise<CustomerLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by this browser.') as Error & {
        code: GeolocationFailure;
      };
      err.code = 'unsupported';
      reject(err);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your location' }),
      (err) => {
        const typed = new Error(err.message || 'Could not get your location.') as Error & {
          code: GeolocationFailure;
        };
        typed.code =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        reject(typed);
      },
      { timeout: 10_000, enableHighAccuracy: false, maximumAge: 60_000 },
    );
  });
}

export function geolocationErrorMessage(code: GeolocationFailure): string {
  switch (code) {
    case 'denied':
      return 'Location permission was denied. You can still search by area, city or PIN code below, or allow location access in your browser settings and try again.';
    case 'timeout':
      return 'Locating you timed out. Check your connection and try again, or search by area, city or PIN code instead.';
    case 'unsupported':
      return 'This browser does not support location detection. Search by area, city or PIN code instead.';
    case 'unavailable':
    default:
      return 'Your location is unavailable right now. Search by area, city or PIN code instead.';
  }
}

export function loadStoredLocation(): CustomerLocation | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(STORED_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerLocation>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    return { lat: parsed.lat, lng: parsed.lng, label: parsed.label ?? 'Your location' };
  } catch {
    return null;
  }
}

export function saveStoredLocation(loc: CustomerLocation): void {
  try {
    sessionStorage.setItem(STORED_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    // Storage full / private mode — location just won't survive a reload.
  }
}

export function clearStoredLocation(): void {
  try {
    sessionStorage.removeItem(STORED_LOCATION_KEY);
  } catch {
    /* ignore */
  }
}
