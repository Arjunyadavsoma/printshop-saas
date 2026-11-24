/**
 * Pure distance helpers for location-aware shop discovery.
 *
 * No imports from app code — safe to use in routes, server components,
 * and tests. All distances are in kilometres; Earth radius 6371 km.
 */

/** A point on Earth, in decimal degrees. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points (Haversine formula).
 * Returns 0 for identical coordinates. Never returns NaN for valid input —
 * the intermediate value is clamped to [0, 1] against float error.
 */
export function haversineKm(
  a: Coordinates,
  b: Coordinates,
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Human-readable distance: "850 m" below 1 km, "1.2 km" (1 decimal)
 * at or above 1 km. Rounds metres to the nearest 10 m to avoid false
 * precision ("847 m" implies accuracy we do not have).
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10} m`;
  return `${km.toFixed(1)} km`;
}

/** Latitude must be [-90, 90], longitude [-180, 180], both finite numbers. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
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

/** Axis-aligned box enclosing a circle of `radiusKm` around a point. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundingBox(
  lat: number,
  lng: number,
  radiusKm: number,
): BoundingBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  // Longitude degrees shrink towards the poles; clamp the cosine so a
  // point at/near a pole does not divide by ~0.
  const lngDelta =
    (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI) /
    Math.max(0.01, Math.cos(toRadians(lat)));
  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: Math.max(-180, lng - lngDelta),
    maxLng: Math.min(180, lng + lngDelta),
  };
}

/** True when the point lies inside the box (inclusive on all edges). */
export function isInsideBoundingBox(
  point: Coordinates,
  box: BoundingBox,
): boolean {
  return (
    point.latitude >= box.minLat &&
    point.latitude <= box.maxLat &&
    point.longitude >= box.minLng &&
    point.longitude <= box.maxLng
  );
}

/**
 * Nearest-first sort of items carrying coordinates. Items without valid
 * coordinates sort last (in their original relative order) — callers that
 * need them excluded should filter first. Returns a new array.
 */
export function sortByDistance<T extends Coordinates>(
  items: readonly T[],
  from: Coordinates,
): T[] {
  return [...items]
    .map((item, index) => ({ item, index, d: haversineKm(from, item) }))
    .sort((x, y) => {
      const dx = Number.isFinite(x.d) ? x.d : Number.POSITIVE_INFINITY;
      const dy = Number.isFinite(y.d) ? y.d : Number.POSITIVE_INFINITY;
      return dx === dy ? x.index - y.index : dx - dy;
    })
    .map(({ item }) => item);
}
