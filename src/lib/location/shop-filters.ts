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
  /** Card image alias returned by the nearby API (same as logoUrl). */
  image?: string | null;
  /** Real rating ONLY when the API returns a non-null number; otherwise null (no stars rendered). */
  rating?: number | null;
  /** Print jobs waiting in the shop's queue (live, from the nearby API). */
  queueCount?: number | null;
  /** Estimated minutes until the shop could start this customer's job; null = no online printer. */
  waitMinutes?: number | null;
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
  /** GPS accuracy in metres, when the browser reports it. */
  accuracy?: number | null;
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
  // Inside the companion app, prefer the native geolocation bridge — the
  // Capacitor plugin drives the proper Android runtime-permission dialog,
  // which is deterministic across OEMs (the WebView's own
  // navigator.geolocation prompt is inconsistent and some OEM WebViews
  // never show it at all). Browsers unaffected: NativeApp is undefined there.
  const native =
    typeof window !== 'undefined' ? window.NativeApp?.location : undefined;
  if (native?.getCurrent) {
    return native.getCurrent().then((loc) => ({
      lat: loc.lat,
      lng: loc.lng,
      label: 'Your location',
      accuracy: loc.accuracy,
    }));
  }
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by this browser.') as Error & {
        code: GeolocationFailure;
      };
      err.code = 'unsupported';
      reject(err);
      return;
    }
    let settled = false;
    // Some Android WebViews never invoke the callback even though a
    // timeout was set — this watchdog guarantees the button never spins
    // forever and the user gets a usable error instead of silence.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error('Locating you timed out.') as Error & {
        code: GeolocationFailure;
      };
      err.code = 'timeout';
      reject(err);
    }, 12_000);
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn();
    };
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        settle(() =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            label: 'Your location',
            accuracy:
              typeof pos.coords.accuracy === 'number'
                ? Math.round(pos.coords.accuracy)
                : null,
          }),
        ),
      (err) =>
        settle(() => {
          const typed = new Error(err.message || 'Could not get your location.') as Error & {
            code: GeolocationFailure;
          };
          // Numeric codes only: 1 = denied, 2 = unavailable, 3 = timeout.
          // The named constants (err.PERMISSION_DENIED etc.) are NOT
          // guaranteed on the error instance in every browser/WebView,
          // which used to misclassify denials as "unavailable".
          typed.code = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
          reject(typed);
        }),
      { timeout: 10_000, enableHighAccuracy: false, maximumAge: 60_000 },
    );
  });
}

/**
 * Device-specific guidance for turning location services back on.
 * Used when geolocation fails because the device itself has location
 * turned off — the browser permission prompt never appears in that
 * case, so the user needs to be told where the switch lives.
 * Falls back to generic wording when the platform can't be detected.
 */
export function deviceLocationGuidance(): string {
  const ua =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '';
  if (/Android/i.test(ua)) {
    return 'Turn on Location: swipe down from the top of the screen and tap Location, or open Settings → Location and switch it on. Then tap Try again.';
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'Turn on Location Services: Settings → Privacy & Security → Location Services → On, and allow this browser. Then tap Try again.';
  }
  return 'Turn on location services in your device settings, then tap Try again.';
}

export function geolocationErrorMessage(code: GeolocationFailure): string {
  // Inside the companion app the recovery path is the system app-settings
  // page (the UI shows an "Open app settings" button for this), not the
  // browser's site-permission panel.
  if (code === 'denied' && typeof window !== 'undefined' && window.NativeApp?.permissions) {
    return 'Location permission is off. Open app settings to allow it, or search by area, city or PIN code below.';
  }
  switch (code) {
    case 'denied':
      return 'Location permission was denied. You can still search by area, city or PIN code below, or allow location access in your browser settings and try again.';
    case 'timeout':
      return 'Locating you timed out. Check your connection and try again, or search by area, city or PIN code instead.';
    case 'unsupported':
      return 'This browser does not support location detection. Search by area, city or PIN code instead.';
    case 'unavailable':
    default:
      // Most often this means device location services are switched off:
      // the browser never even shows its permission prompt then, so tell
      // the user where the switch lives instead of a bare error.
      return `Your location is unavailable right now — your device location may be turned off. ${deviceLocationGuidance()}`;
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
