/**
 * Type definitions for the native bridge API exposed on `window.NativeApp`.
 *
 * The web app feature-detects these bridges at runtime:
 *   if (typeof window !== 'undefined' && window.NativeApp) {
 *     // running inside the PrintShop Companion Android app
 *     await window.NativeApp.camera.scan();
 *   } else {
 *     // running in a regular browser — use the web fallback
 *   }
 *
 * The bridge is injected by `inject-bridges.js` (which concatenates the
 * compiled bridges + attaches them to `window.NativeApp`) BEFORE the
 * WebView's main page scripts run. This guarantees `window.NativeApp` is
 * available by the time the web app's React hydration fires.
 */

/** A captured document (photo or picked file) returned as base64. */
export interface CapturedDocument {
  /** Base64-encoded file contents (no data: prefix). */
  base64: string;
  /** MIME type: `image/jpeg`, `image/png`, or `application/pdf`. */
  mimeType: string;
  /** Original filename (e.g. `scan-001.jpg` or `document.pdf`). */
  filename: string;
}

/** Result of a UPI payment intent launch. */
export interface UPIPaymentResult {
  /** Whether the user's UPI app accepted the intent. Does NOT confirm payment —
   * the actual payment status is resolved via the server's webhook + status API. */
  success: boolean;
  /** The package name of the UPI app the user selected (e.g. `com.phonepe.app`,
   * `com.google.android.apps.nbu.paisa.user`), or null if cancelled. */
  app?: string | null;
  /** Error message if the intent failed to launch (no UPI app installed, etc). */
  error?: string;
}

/** The shape of the `window.NativeApp` object injected by the companion app. */
export interface NativeAppBridge {
  /** The companion app version (e.g. `1.0.0`). */
  version: string;
  /** The platform — always `'android'` in this build. */
  platform: 'android';

  camera: {
    /** Open the device camera and capture a single photo (JPEG). */
    scan(): Promise<CapturedDocument | null>;
    /** Open the gallery/file picker and let the user select an existing file
     *  (image or PDF). Returns null if the user cancels. */
    pick(): Promise<CapturedDocument | null>;
  };

  upi: {
    /** Launch a native UPI payment intent. The `upiUri` is the full
     *  `upi://pay?pa=...&pn=...&am=...` URI returned by the checkout API.
     *  Shows a chooser of installed UPI apps (PhonePe, GPay, Paytm, etc). */
    pay(upiUri: string): Promise<UPIPaymentResult>;
  };

  storage: {
    /** Store a value securely (EncryptedSharedPreferences, hardware-backed). */
    set(key: string, value: string): Promise<void>;
    /** Retrieve a previously-stored value, or null if not found. */
    get(key: string): Promise<string | null>;
    /** Remove a key. */
    remove(key: string): Promise<void>;
    /** Remove all keys. */
    clear(): Promise<void>;
  };

  notifications: {
    /** Schedule a local notification. Returns the notification id. */
    schedule(title: string, body: string, id?: number): Promise<number>;
    /** Cancel a previously-scheduled notification. */
    cancel(id: number): Promise<void>;
  };

  /** Open a URL in the system browser (outside the WebView). */
  openExternal(url: string): Promise<void>;

  /** Get the app's install referrer (for analytics — which QR code led to install). */
  getInstallReferrer(): Promise<string | null>;
}

declare global {
  interface Window {
    NativeApp?: NativeAppBridge;
  }
}

export {};
