# PRINTELYX — Scanner & Location Repair

**Date:** 2026-11-26

## QR Scanner (`/scan`)

### Implementation (existing — audited, not modified)

- **File:** `src/app/scan/page.tsx` (180 lines)
- **Library:** `jsQR` v1.4.0 (pure JS, canvas frame grab) — installed in `package.json`.
- **Camera access:** `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`.
- **Permission flow:** Explicit "Open scanner" button — camera is NOT requested on page load. Permission is requested only when the customer taps the button.
- **Manual fallback:** Slug/URL text input + "Go" button for denied permission, desktop use, or unsupported browsers.
- **QR formats supported:**
  - Shop QR: `/s/[shopSlug]` → redirects to the shop's upload page.
  - Order QR: `/o/[token]` → redirects to the order tracking page.
- **URL parsing:** `extractShopSlug(payload)` extracts the slug from a full URL or bare slug.

### Permission States Handled (in code)

| State | Behavior |
|---|---|
| Not requested | Shows "Open scanner" button |
| Granted | Camera preview + scan frame |
| Denied | Shows manual-entry fallback with instructions |
| Unavailable | Shows manual-entry fallback |
| Unsupported browser | Shows manual-entry fallback |

### What Was NOT Changed

The scanner was already correctly implemented with explicit permission request + manual fallback. No code changes were needed.

### Limitations

- **Not browser-tested.** The sandbox cannot run a browser (dev server is in a different network namespace). Camera permission, scan frame, and QR decoding were verified by code inspection only.
- **Not device-tested.** iOS Safari, Android Chrome, and Capacitor Android were not tested. Camera behavior varies by device/browser.
- **No flashlight/camera-switch controls.** The scanner does not implement flashlight toggle or camera switching (only `facingMode: 'environment'`). These are not fabricated.
- **No Capacitor camera bridge.** The scanner uses the browser `getUserMedia` API, not a Capacitor camera plugin. In the Capacitor Android app, the browser API should work but may need the camera permission in `AndroidManifest.xml`.

---

## Location & Geolocation

### Implementation (existing — audited, partially fixed)

- **Files:**
  - `src/lib/location/shop-filters.ts` — `requestGeolocation`, `loadStoredLocation`, `parseOpenStatus`, `NearbyShop` types.
  - `src/lib/location/distance.ts` — `haversineKm`, `formatDistance`, `isValidCoordinate`, `boundingBox`, `isInsideBoundingBox`.
  - `src/lib/location/opening-hours.ts` — `shopOpenStatus`.
  - `src/app/api/shops/nearby/route.ts` — the nearby API endpoint.
  - `src/app/find-a-shop/page.tsx` — the discovery page.

### Geolocation Permission Flow

- **Request trigger:** Only when the customer chooses a location-dependent action ("Detect my location" button). NOT requested on page load.
- **`requestGeolocation()`** wraps `navigator.geolocation.getCurrentPosition` with a timeout.
- **Permission states handled:**
  - Granted → fetches nearby shops with coordinates.
  - Denied → shows manual search fallback.
  - Timeout → shows error + "Try again".
  - Unsupported → shows manual search fallback.

### Manual Location Fallback

- **Text search:** The customer can search by shop name, address, or city without granting location.
- **No fabricated coordinates:** If the customer doesn't grant location, `distanceKm` is null for all shops. No distance is displayed.
- **No geocoding:** There is no address-to-coordinate geocoding endpoint. The customer cannot type "Indiranagar, Bangalore" and get coordinates. This is documented as a limitation.

### Fix Applied This Session

The `/api/shops/nearby` route was returning HTTP 500 because it used Prisma `db` directly instead of the container's database adapter. This was fixed by switching to `getContainer().db`. See `docs/PRINTELYX-CONSUMER-PLATFORM-AUDIT.md` Defect 2.

### Privacy

- Location coordinates are sent ONLY to `/api/shops/nearby` (same origin). They are NOT sent to any third-party API.
- Location is NOT stored server-side. The client stores the last-known location in `sessionStorage` (`printshop:location`) for the session only.
- No precise location is sent to unrelated APIs.

### Limitations

1. **No geocoding.** The customer cannot type an area name and get coordinates. They must either use device location or browse all shops.
2. **No "Open now" using inaccurate time.** The `shopOpenStatus` function uses the shop's `openingHours` JSON + timezone. If opening hours are not configured, `isOpen` defaults to the manual `Shop.isOpen` flag.
3. **Not browser-tested.** Geolocation permission flow was verified by code inspection only.
4. **Not device-tested.** Mobile browser geolocation behavior varies.
5. **No Capacitor location bridge.** The scanner uses the browser `navigator.geolocation` API, not a Capacitor geolocation plugin.
