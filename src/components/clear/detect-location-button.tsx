'use client';

import { useState } from 'react';
import {
  geolocationErrorMessage,
  requestGeolocation,
  type CustomerLocation,
  type GeolocationFailure,
} from '@/lib/location/shop-filters';

/**
 * DetectLocationButton — shared "Detect location" button for shopkeepers.
 *
 * Used next to the latitude/longitude fields in shop registration and in
 * Settings → Shop location. Uses the browser Geolocation API ONLY on tap
 * — never on mount, never automatically — and fills the caller's lat/lng
 * fields with the detected coordinates. Shows the GPS accuracy (± metres)
 * when the browser reports it, and a clear error with a manual-entry
 * fallback when permission is denied / unavailable / times out.
 *
 * The detected coordinates are the shopkeeper's own device position, so
 * they are accurate only when the shopkeeper is standing at the shop —
 * the button label and hint say so. Coordinates filled this way are
 * saved as unverified (same as hand-typed ones); only "Find on map"
 * in Settings marks a location verified.
 */

export interface DetectLocationButtonProps {
  /** Called with the detected coordinates (accuracy in metres, if known). */
  onDetected: (loc: CustomerLocation) => void;
  /** Disable while the surrounding form is saving/submitting. */
  disabled?: boolean;
}

export function DetectLocationButton({ onDetected, disabled }: DetectLocationButtonProps) {
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<GeolocationFailure | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const handleClick = async () => {
    setDetecting(true);
    setError(null);
    setErrorCode(null);
    try {
      const loc = await requestGeolocation();
      setAccuracy(loc.accuracy ?? null);
      onDetected(loc);
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code;
      setErrorCode(code ?? 'unavailable');
      setError(
        code
          ? geolocationErrorMessage(code)
          : 'Could not detect your location. Enter the coordinates by hand instead.',
      );
    } finally {
      setDetecting(false);
    }
  };

  // Only transient failures get a retry: device-off / timeout may clear
  // once the user flips the location switch. A denied permission never
  // re-prompts in the browser, so retrying it would just fail again —
  // the error text already points at browser settings instead.
  const canRetry = errorCode === 'unavailable' || errorCode === 'timeout';

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={detecting || disabled}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[var(--accent-tint)] px-4 text-sm font-medium text-[var(--accent-tint-text)] disabled:opacity-60"
      >
        {detecting ? 'Detecting your location…' : 'Detect location'}
      </button>
      {accuracy != null && !error && (
        <span className="text-[13px] text-[var(--label-2)]" role="status">
          Detected ±{accuracy} m — check it looks right before saving.
        </span>
      )}
      {error && (
        <span className="text-[13px] text-[var(--label-2)]" role="alert">
          {error}
        </span>
      )}
      {error && canRetry && (
        <span>
          <button
            type="button"
            onClick={() => void handleClick()}
            disabled={detecting || disabled}
            className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
          >
            Try again
          </button>
        </span>
      )}
      {/* In the companion app, a permanent denial can only be recovered from
          the system app-settings page — Android ignores re-prompts after
          "don't ask again". Never shown in browsers (NativeApp absent). */}
      {error && errorCode === 'denied' && typeof window !== 'undefined' && window.NativeApp?.permissions && (
        <span>
          <button
            type="button"
            onClick={() => void window.NativeApp!.permissions!.openSettings()}
            className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"
          >
            Open app settings
          </button>
        </span>
      )}
    </span>
  );
}

export default DetectLocationButton;
