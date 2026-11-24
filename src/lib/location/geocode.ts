/**
 * Server-side geocoding via Nominatim (OpenStreetMap).
 *
 * No API key. Nominatim usage policy: max 1 req/s, identify the app with a
 * User-Agent, cache results, and never bulk-geocode. This module enforces
 * the 1 req/s floor in-process (per server instance) and keeps a small
 * in-memory cache so repeated lookups of the same address/pincode do not
 * hit the service again.
 *
 * Privacy: NEVER log precise coordinates. Logs carry at most a city,
 * pincode, or a rounded (2-decimal, ~1 km) coordinate.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'Printelyx/1.0 (print shop discovery)';
const MIN_INTERVAL_MS = 1100; // Nominatim policy: max 1 request/second
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
  /** Postal code, when Nominatim returned one. */
  pincode?: string;
  city?: string;
  state?: string;
}

interface CacheEntry {
  at: number;
  value: GeocodeResult | null;
}

const cache = new Map<string, CacheEntry>();
let lastRequestAt = 0;

/** Coarse coordinate for logs only (~1 km precision — never precise). */
export function coarseForLog(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

async function nominatim<T>(path: string): Promise<T> {
  // Enforce the 1 req/s policy across concurrent callers in this process.
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(`${NOMINATIM_BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Nominatim ${res.status}`);
  }
  return (await res.json()) as T;
}

function cacheGet(key: string): GeocodeResult | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: GeocodeResult | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

interface NominatimSearchItem {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

function toResult(item: NominatimSearchItem): GeocodeResult | null {
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  if (!isValidCoordinateValue(latitude, longitude)) return null;
  return {
    latitude,
    longitude,
    displayName: item.display_name,
    pincode: item.address?.postcode,
    city:
      item.address?.city ?? item.address?.town ?? item.address?.village,
    state: item.address?.state,
  };
}

/**
 * Forward-geocode a free-text address, restricted to India. Returns the
 * best match or null when nothing is found. Throws only on transport /
 * service errors — callers should catch and fall back to manual entry.
 */
export async function geocodeAddress(
  address: string,
): Promise<GeocodeResult | null> {
  const q = address.trim();
  if (!q) return null;
  const key = `fwd:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'in',
    limit: '1',
  });
  const items = await nominatim<NominatimSearchItem[]>(
    `/search?${params.toString()}`,
  );
  const result = items.length > 0 ? toResult(items[0]!) : null;
  cacheSet(key, result);
  return result;
}

/**
 * Geocode an Indian pincode (6 digits) — the common case for shop
 * onboarding, where the shopkeeper types a pincode instead of a full
 * address. Returns null for an invalid pincode without calling Nominatim.
 */
export async function geocodePincode(
  pincode: string,
): Promise<GeocodeResult | null> {
  if (!validateIndianPincode(pincode)) return null;
  return geocodeAddress(`${pincode}, India`);
}

/** Reverse-geocode coordinates to a human-readable address (India-first). */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<GeocodeResult | null> {
  if (!isValidCoordinateValue(latitude, longitude)) return null;
  const key = `rev:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  });
  const item = await nominatim<NominatimSearchItem & { error?: string }>(
    `/reverse?${params.toString()}`,
  );
  const result =
    item.error || item.lat === undefined ? null : toResult(item);
  cacheSet(key, result);
  return result;
}

/**
 * Indian pincode: exactly 6 digits, first digit 1–9 (0 is not a valid
 * postal-circle digit). Accepts surrounding whitespace.
 */
export function validateIndianPincode(pincode: unknown): boolean {
  return typeof pincode === 'string' && /^[1-9]\d{5}$/.test(pincode.trim());
}

export function isValidCoordinateValue(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Validate a lat/lng pair, returning a human-readable reason when invalid. */
export function validateCoordinates(
  lat: unknown,
  lng: unknown,
): { valid: true } | { valid: false; error: string } {
  if (lat === undefined || lat === null || lng === undefined || lng === null) {
    return { valid: false, error: 'lat and lng are both required' };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, error: 'lat and lng must be numbers' };
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, error: 'lat must be between -90 and 90' };
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, error: 'lng must be between -180 and 180' };
  }
  return { valid: true };
}
