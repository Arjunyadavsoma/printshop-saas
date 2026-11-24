import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the PrintShop Companion Android app.
 *
 * The app loads the deployed Next.js consumer storefront inside a native
 * Android WebView. The server URL points at the production deployment —
 * change this to your Vercel URL or custom domain before building.
 *
 * Native bridges (camera, UPI intent, secure storage, local notifications)
 * are injected into the WebView's `window.NativeApp` object by the TypeScript
 * code in `src/bridges/`. The web app feature-detects `window.NativeApp` and
 * calls the native bridge instead of the web fallback when running inside
 * the companion app.
 *
 * The `server` config makes the WebView load the remote URL (not a local
 * copy of the web app). This keeps the UI always in sync with the deployed
 * web app — no duplicate UI to maintain. The bridges are the ONLY local
 * code; they're injected as a small JS bundle that runs alongside the
 * remote page.
 *
 * Set `PRINTSHOP_WEB_URL` env var to override the server URL at build time:
 *   PRINTSHOP_WEB_URL=https://printshop-saas-arjunyadav35763-gmailcoms-projects.vercel.app npm run release
 * If unset, defaults to the placeholder below (you MUST change it before
 * building a distributable APK).
 */
const WEB_URL = process.env.PRINTSHOP_WEB_URL ?? 'https://printelyx.cc.cd';

const config: CapacitorConfig = {
  appId: 'app.printshop.companion',
  appName: 'PrintShop Companion',
  webDir: 'dist',
  // Load the deployed web app inside the WebView (not a local bundle).
  // This keeps the UI in sync with the web app — the bridges are the
  // only local code, injected via the `inject-bridges.js` script.
  server: {
    url: WEB_URL,
    // Allow the WebView to run native bridge calls without CORS issues
    // (the bridges are injected into the same WebView origin as the page).
    cleartext: false, // HTTPS only — no cleartext HTTP allowed
  },
  android: {
    // Allow mixed content (if the web app loads an HTTP image) — disabled
    // by default for security. The web app is HTTPS-only, so this stays false.
    allowMixedContent: false,
    // The WebView captures back-button presses to navigate history instead
    // of closing the app immediately.
    captureInput: true,
    // Use the Android System WebView (Chrome) — the most compatible option.
    webContentsDebuggingEnabled: false, // set true for `chrome://inspect` debugging
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      // Brand ground colour from the consumer redesign (light grey-blue).
      backgroundColor: '#F4F6F8FF',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    Camera: {
      // Allow the camera plugin to prompt for permission on first use.
      // The permission rationale string lives in strings.xml.
      androidScaleType: 'CENTER_CROP',
    },
    LocalNotifications: {
      // Small notification icon (white-on-transparent for Android 5+).
      smallIcon: 'ic_notification',
      iconColor: '#2563eb',
    },
  },
};

export default config;
