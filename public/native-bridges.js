
// PrintShop Companion — native bridges (auto-generated, do not edit)
// Bundled by scripts/inject-bridges.js from src/ — includes ALL bridge
// modules (camera, upi, storage, notifications, location, settings).
(function() {
  var Capacitor = window.Capacitor;
  if (!Capacitor) {
    // Regular browser — no Capacitor runtime, leave window.NativeApp
    // undefined so the web app uses its own fallbacks. No-op.
    return;
  }
  // Module map — the bundler strips the @capacitor/* imports; bind the
  // same names to the runtime globals here.
  var Camera = Capacitor.Plugins.Camera;
  var Geolocation = Capacitor.Plugins.Geolocation;
  var LocalNotifications = Capacitor.Plugins.LocalNotifications;
  var Preferences = Capacitor.Plugins.Preferences;
  var registerPlugin = function(name) { return Capacitor.Plugins[name]; };
  // Enum constants from @capacitor/camera (module constants, not plugins).
  var CameraResultType = { Base64: 'base64', DataUrl: 'dataUrl', Uri: 'uri' };
  var CameraSource = { Prompt: 'PROMPT', Camera: 'CAMERA', Photos: 'PHOTOS' };


// ===== module: bridges/camera.js =====

/**
 * Camera bridge — native document capture + file picking.
 *
 * Replaces the web's `<input type="file" accept="image/*" capture="camera">`
 * with the Capacitor Camera plugin, which uses Android's CameraX API for
 * better capture quality + native permission UX.
 *
 * The web app calls `window.NativeApp.camera.scan()` when the user taps
 * "Upload" inside the companion app (feature-detected via `window.NativeApp`).
 * The returned base64 is uploaded to the same `/api/v1/orders/[id]/files`
 * endpoint the web upload uses — the backend doesn't know or care whether
 * the file came from a browser file input or the native camera.
 */

async function scanDocument() {
    try {
        const photo = await Camera.getPhoto({
            quality: 85, // JPEG quality — 85 is a good balance for document capture
            allowEditing: false, // no crop — the user re-takes if it's wrong
            resultType: CameraResultType.Base64,
            source: CameraSource.Camera, // force the camera (not gallery)
            saveToGallery: false, // scans are temporary — don't pollute the gallery
            correctOrientation: true, // auto-rotate based on EXIF
            presentationStyle: 'fullscreen',
        });
        if (!photo.base64String)
            return null;
        return {
            base64: photo.base64String,
            mimeType: photo.format === 'png' ? 'image/png' : 'image/jpeg',
            filename: `scan-${Date.now()}.${photo.format ?? 'jpg'}`,
        };
    }
    catch (err) {
        // User cancelled, or permission denied — return null (no throw) so the
        // web app's "no file selected" path runs naturally.
        return null;
    }
}
async function pickDocument() {
    try {
        // Camera.getPhoto with source=Photos opens the gallery for a single image.
        // For PDFs + multi-select, we'd need @capacitor-community/file-picker —
        // but the MVP supports single-image picks via the gallery, and PDFs via
        // the web fallback (the file input still works in the WebView).
        const photo = await Camera.getPhoto({
            quality: 90,
            allowEditing: false,
            resultType: CameraResultType.Base64,
            source: CameraSource.Photos, // open the gallery
            correctOrientation: true,
            presentationStyle: 'popover',
        });
        if (!photo.base64String)
            return null;
        return {
            base64: photo.base64String,
            mimeType: photo.format === 'png' ? 'image/png' : 'image/jpeg',
            filename: `upload-${Date.now()}.${photo.format ?? 'jpg'}`,
        };
    }
    catch {
        return null;
    }
}


// ===== module: bridges/location.js =====

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

function fail(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}
/** Current permission state without prompting. */
async function checkLocationPermission() {
    const state = await Geolocation.checkPermissions();
    return state.location ?? 'prompt';
}
/**
 * Get the device position, asking for permission first if needed.
 * enableHighAccuracy stays false — a cell/Wi-Fi fix is enough for shop
 * discovery and is much faster + cheaper on battery (same trade-off the
 * web path makes).
 */
async function getCurrentLocation() {
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
            timeout: 12000, // same watchdog budget as the web path
            maximumAge: 30000, // a 30s-old fix is fine for "shops near you"
        });
        return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy)
                ? Math.round(pos.coords.accuracy)
                : null,
        };
    }
    catch (err) {
        // Capacitor throws generic Errors — map to the web's union by message.
        const msg = String(err?.message ?? '').toLowerCase();
        if (msg.includes('timeout') || msg.includes('timed out')) {
            throw fail('timeout', 'Locating you timed out.');
        }
        if (msg.includes('denied')) {
            throw fail('denied', 'Location permission was not granted.');
        }
        throw fail('unavailable', 'Could not get your location.');
    }
}


// ===== module: bridges/notifications.js =====

/**
 * Local notifications bridge — "Your prints are ready" push notifications.
 *
 * The web app polls `/api/v1/orders/[id]/status` every 30 seconds when an
 * order is being processed. When the status transitions to `ready` or
 * `completed`, the companion app fires a local notification (so the user
 * knows to pick up their prints even if they've switched away from the app).
 *
 * This is LOCAL notifications (no FCM server-side integration needed for the
 * MVP). The poller runs inside the WebView (the existing web app's polling
 * logic) and calls `window.NativeApp.notifications.schedule()` when the
 * status flips. The notification appears in the Android system notification
 * tray + triggers the device's default notification sound + vibration.
 *
 * Tapping the notification re-opens the companion app (via the MainActivity's
 * default intent) and lands the user on the order status page.
 */

let nextId = 1;
async function scheduleNotification(title, body, id) {
    try {
        const notificationId = id ?? nextId++;
        await LocalNotifications.schedule({
            notifications: [
                {
                    id: notificationId,
                    title,
                    body,
                    // Fire immediately (scheduleAt = now). For future scheduled
                    // notifications (e.g. "ready in 15 min"), set scheduleAt to a
                    // future Date — but the MVP fires on-demand from the poller.
                    schedule: { at: new Date() },
                    // Small icon must exist as a drawable resource in the Android
                    // project (res/drawable/ic_notification.xml — a white-on-transparent
                    // vector for Android 5+ status bar rendering).
                    smallIcon: 'ic_notification',
                    iconColor: '#2563eb', // brand blue
                    sound: undefined, // use the system default
                    // Tap action: re-open the app (default MainActivity intent).
                    actionTypeId: 'OPEN_APP',
                },
            ],
        });
        return notificationId;
    }
    catch {
        // Notification permission denied or plugin unavailable — fail silently.
        // The web app's in-page toast still fires (it's independent of this bridge).
        return -1;
    }
}
async function cancelNotification(id) {
    try {
        await LocalNotifications.cancel({ notifications: [{ id }] });
    }
    catch {
        // best-effort
    }
}


// ===== module: bridges/settings.js =====

/**
 * Settings bridge — sends the user to the system app-settings screen.
 *
 * Android silently ignores repeated permission prompts after a permanent
 * denial ("don't ask again"), so the only honest recovery path is the
 * settings page. The web permission flows render an "Open app settings"
 * button (only when running inside the companion app) that calls
 * `NativeApp.permissions.openSettings()` → the AppSettings plugin.
 */

const AppSettings = registerPlugin('AppSettings');
async function openAppSettings() {
    await AppSettings.openSettings();
}


// ===== module: bridges/storage.js =====

/**
 * Secure storage bridge — auth tokens in app-private Preferences.
 *
 * The web app stores auth tokens in localStorage (`printshop_token`,
 * `printshop_refresh_token`, `printshop_role`, `printshop_email`). In the
 * companion app, these are intercepted and stored via the Capacitor
 * Preferences plugin, which uses Android's SharedPreferences API.
 *
 * SharedPreferences data lives in the app's private data directory
 * (`/data/data/app.printshop.companion/shared_prefs/`), which is sandboxed
 * by Android's app sandbox — other apps can't read it without root.
 *
 * For hardware-backed encryption (EncryptedSharedPreferences + Android
 * Keystore), a custom Java plugin would be needed. That's deferred to
 * Phase 2 — the app sandbox is sufficient for the MVP (the attack surface
 * is "someone with physical access + root" which is outside the MVP threat
 * model).
 *
 * The web app's `auth-context.tsx` checks `window.NativeApp?.storage` first
 * and falls back to localStorage in a regular browser. The key names are
 * identical (`printshop_token`, etc.) so the logic is shared.
 */

async function setSecure(key, value) {
    try {
        await Preferences.set({ key, value });
    }
    catch {
        // If Preferences fails (rare: device storage full), fall back silently.
        // The web app's localStorage path will pick up the slack.
    }
}
async function getSecure(key) {
    try {
        const result = await Preferences.get({ key });
        return result.value;
    }
    catch {
        // Key doesn't exist, or read failed — return null (caller treats
        // this as "not authenticated" and redirects to login).
        return null;
    }
}
async function removeSecure(key) {
    try {
        await Preferences.remove({ key });
    }
    catch {
        // best-effort
    }
}
async function clearSecure() {
    try {
        await Preferences.clear();
    }
    catch {
        // best-effort
    }
}


// ===== module: bridges/upi.js =====

/**
 * UPI payment bridge — launches the installed UPI app via Android Intent.
 *
 * The web checkout returns `{ upiUri: "upi://pay?pa=...&am=...&tn=..." }`.
 * In a browser, this opens via `window.location = upiUri` — which may fail
 * silently if no UPI app is registered, or show a "open with..." dialog
 * that's confusing for non-technical users.
 *
 * In the companion app, this bridge fires a native Android Intent:
 *   Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(upiUri));
 *   startActivity(Intent.createChooser(intent, "Pay with"));
 *
 * The chooser shows ONLY installed UPI apps (PhonePe, GPay, Paytm, BHIM,
 * etc.) — Android filters by apps that register an intent filter for the
 * `upi://` scheme. This is the same UX as any native Indian payment app.
 *
 * IMPORTANT: this bridge does NOT confirm payment. The UPI app handles the
 * actual payment. The server resolves payment status via the PSP webhook
 * + the order-status poller (which the notifications bridge powers). This
 * bridge only launches the UPI app + reports whether the intent succeeded.
 */

const UPIPlugin = registerPlugin('UPIIntent');
async function payWithUPI(upiUri) {
    try {
        if (!upiUri || !upiUri.startsWith('upi://')) {
            return {
                success: false,
                app: null,
                error: 'Invalid UPI URI — must start with upi://',
            };
        }
        const result = await UPIPlugin.pay({ upiUri });
        return result;
    }
    catch (err) {
        return {
            success: false,
            app: null,
            error: err instanceof Error ? err.message : 'Failed to launch UPI app',
        };
    }
}


// ===== module: injector.js =====

/**
 * Injector — assembles all native bridges into `window.NativeApp`.
 *
 * This file is the entry point that `inject-bridges.js` bundles + injects
 * into the WebView BEFORE the web app's React scripts run. It:
 *   1. Imports all 4 bridge modules (camera, upi, storage, notifications).
 *   2. Constructs the `NativeAppBridge` object.
 *   3. Attaches it to `window.NativeApp`.
 *
 * The web app feature-detects `window.NativeApp` to know it's running inside
 * the companion app + calls the native bridges instead of web fallbacks.
 *
 * CRITICAL: this script must run BEFORE the web app's hydration. The
 * `inject-bridges.js` build step concatenates this compiled output + wraps
 * it in an IIFE that runs synchronously during the WebView's page load.
 */






const APP_VERSION = '1.2.0';
/** The assembled bridge object attached to window.NativeApp. */
const NativeApp = {
    version: APP_VERSION,
    platform: 'android',
    camera: {
        scan: scanDocument,
        pick: pickDocument,
    },
    upi: {
        pay: payWithUPI,
    },
    storage: {
        set: setSecure,
        get: getSecure,
        remove: removeSecure,
        clear: clearSecure,
    },
    notifications: {
        schedule: scheduleNotification,
        cancel: cancelNotification,
    },
    location: {
        // Native GPS — the web app uses this instead of navigator.geolocation
        // inside the app (deterministic permission prompt, OEM-independent).
        getCurrent: getCurrentLocation,
        checkPermission: checkLocationPermission,
    },
    permissions: {
        // Open the system app-settings page — the only recovery path after a
        // permanent ("don't ask again") permission denial.
        openSettings: openAppSettings,
    },
    openExternal: async (url) => {
        // Open the URL in the system browser (outside the WebView).
        // In Android, window.open with target=_blank triggers the system
        // browser if the WebViewClient's shouldOverrideUrlLoading is configured
        // to delegate external URLs (which the MainActivity handles).
        window.open(url, '_blank', 'noopener,noreferrer');
    },
    getInstallReferrer: async () => {
        // The Install Referrer API requires the com.android.installreferrer
        // library — deferred to Phase 2. Return null for now.
        return null;
    },
};
// Attach to window. The cast is because the global type augmentation in
// `types/native-app.d.ts` declares `window.NativeApp?` but at runtime
// we're constructing the concrete value.
if (typeof window !== 'undefined') {
    window.NativeApp = NativeApp;
    // Dispatch a custom event so the web app can know the bridge is ready
    // (it listens for 'nativeapp:ready' if it needs to do async init).
    // Guarded — a missing/locked-down dispatchEvent must never prevent the
    // bridge object itself from attaching.
    try {
        window.dispatchEvent(new CustomEvent('nativeapp:ready', { detail: { version: APP_VERSION } }));
    }
    catch {
        /* non-fatal */
    }
}


})();
