
// PrintShop Companion — native bridges (auto-generated, do not edit)
// Injected at document-start via Capacitor's WebView plugin.
(function() {
  // Capacitor plugin modules are exposed on the global Capacitor object.
  // The imports in the TS source (@capacitor/camera, etc.) resolve to these.
  const Capacitor = window.Capacitor;
  if (!Capacitor) {
    console.warn('[NativeApp] Capacitor runtime not loaded — bridges disabled.');
    return;
  }
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
// (import stripped — resolved by bundler)
// (import stripped — resolved by bundler)
// (import stripped — resolved by bundler)
// (import stripped — resolved by bundler)
const APP_VERSION = '1.1.0';
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
    window.dispatchEvent(new CustomEvent('nativeapp:ready', { detail: { version: APP_VERSION } }));
}

})();
