/**
 * Pure validators for shop location fields — Indian PIN codes and
 * geographic coordinates.
 *
 * Rules (never silently accept or "fix" bad input):
 *   - PIN: exactly 6 digits, first digit 1-9 (Indian PIN codes never
 *     start with 0). Anything else is invalid, not truncated/padded.
 *   - Latitude: -90..90 inclusive. Longitude: -180..180 inclusive.
 *     Out-of-range values are rejected, never clamped to the boundary.
 *   - Empty / missing values mean "not provided" (location is optional)
 *     and are NOT errors — callers check emptiness separately.
 */

export const INDIAN_PINCODE_RE = /^[1-9][0-9]{5}$/;

/** True only for a 6-digit Indian PIN code whose first digit is 1-9. */
export function isValidIndianPincode(value: unknown): value is string {
  return typeof value === 'string' && INDIAN_PINCODE_RE.test(value.trim());
}

/**
 * Parse a latitude from a number or numeric string. Returns the number
 * when it is finite and within -90..90, otherwise null. Never clamps,
 * never returns NaN.
 */
export function parseLatitude(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n < -90 || n > 90) return null;
  return n;
}

/**
 * Parse a longitude from a number or numeric string. Returns the number
 * when it is finite and within -180..180, otherwise null. Never clamps,
 * never returns NaN.
 */
export function parseLongitude(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n < -180 || n > 180) return null;
  return n;
}

/** True when `value` is a usable latitude (number or numeric string). */
export function isValidLatitude(value: unknown): boolean {
  return parseLatitude(value) !== null;
}

/** True when `value` is a usable longitude (number or numeric string). */
export function isValidLongitude(value: unknown): boolean {
  return parseLongitude(value) !== null;
}

export interface ShopLocationInput {
  pincode?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
}

export type ShopLocationErrors = Partial<
  Record<'pincode' | 'latitude' | 'longitude', string>
>;

/**
 * Validate the optional location fields as a group. Empty values are
 * skipped (location is optional); non-empty invalid values each get a
 * human-readable error. A latitude without a longitude (or vice versa)
 * is an error — a half-filled coordinate pair is not a location.
 */
export function validateShopLocation(input: ShopLocationInput): ShopLocationErrors {
  const errors: ShopLocationErrors = {};
  const pin = (input.pincode ?? '').trim();
  if (pin && !isValidIndianPincode(pin)) {
    errors.pincode = 'Enter a 6-digit PIN code starting with 1–9.';
  }
  const latRaw = input.latitude;
  const lngRaw = input.longitude;
  const latEmpty = latRaw === undefined || latRaw === null || String(latRaw).trim() === '';
  const lngEmpty = lngRaw === undefined || lngRaw === null || String(lngRaw).trim() === '';
  if (!latEmpty && parseLatitude(latRaw) === null) {
    errors.latitude = 'Latitude must be a number between -90 and 90.';
  }
  if (!lngEmpty && parseLongitude(lngRaw) === null) {
    errors.longitude = 'Longitude must be a number between -180 and 180.';
  }
  if (!latEmpty && lngEmpty && !errors.latitude) {
    errors.longitude = 'Enter the longitude to go with the latitude.';
  }
  if (latEmpty && !lngEmpty && !errors.longitude) {
    errors.latitude = 'Enter the latitude to go with the longitude.';
  }
  return errors;
}

/** OpenStreetMap link for a coordinate pair (no map library needed). */
export function openStreetMapUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

/** OpenStreetMap embed URL for a small preview iframe (no JS library). */
export function openStreetMapEmbedUrl(latitude: number, longitude: number): string {
  const d = 0.01;
  const bbox = `${longitude - d},${latitude - d},${longitude + d},${latitude + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
