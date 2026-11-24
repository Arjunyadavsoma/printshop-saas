/**
 * Location bridge — native GPS via the Capacitor Geolocation plugin.
 *
 * The web app's location features (shop discovery "near me", shopkeeper
 * location fields) call `window.NativeApp.location.getCurrent()` when
 * running inside the companion app. Native geolocation is used INSTEAD of
 * `navigator.geolocation` because the Android WebView's own prompt is
 * inconsistent across OEMs; the Capacitor plugin drives the proper Android
 * runtime-permission dialog and is deterministic.
 *
 * Error contract mirrors the web's GeolocationFailure union
 * (src/lib/location/shop-filters.ts): 'denied' | 'unavailable' | 'timeout'
 * — thrown as Error objects with a `code` field so the web fallbacks and
 * error messages work unchanged.
 */
import { Geolocation } from '@capacitor/geolocation';

export interface NativeLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout';

function fail(code: LocationErrorCode, message: string): Error {
  const err = new Error(message) as Error & { code: LocationErrorCode };
  err.code = code;
  return err;
}

/** Current permission state without prompting. */
export async function checkLocationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const state = await Geolocation.checkPermissions();
  return (state.location as 'granted' | 'denied' | 'prompt') ?? 'prompt';
}

/**
 * Get the device position, asking for permission first if needed.
 * enableHighAccuracy stays false — a cell/Wi-Fi fix is enough for shop
 * discovery and is much faster + cheaper on battery (same trade-off the
 * web path makes).
 */
export async function getCurrentLocation(): Promise<NativeLocation> {
  const perm = await Geolocation.checkPermissions();
  if (perm.location !== 'granted') {
    const asked = await Geolocation.requestPermissions();
    if (asked.location !== 'granted') {
      throw fail('denied', 'Location permission was not granted.');
    }
  }

  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 12_000, // same watchdog budget as the web path
      maximumAge: 30_000, // a 30s-old fix is fine for "shops near you"
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy:
        typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy)
          ? Math.round(pos.coords.accuracy)
          : null,
    };
  } catch (err) {
    // Capacitor throws generic Errors — map to the web's union by message.
    const msg = String((err as Error)?.message ?? '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) {
      throw fail('timeout', 'Locating you timed out.');
    }
    if (msg.includes('denied')) {
      throw fail('denied', 'Location permission was not granted.');
    }
    throw fail('unavailable', 'Could not get your location.');
  }
}
