/**
 * Type declarations for `window.NativeApp` — the native bridge API exposed by
 * the PrintShop Companion Android app.
 *
 * The companion app injects `/native-bridges.js` (loaded via a beforeInteractive
 * <Script> tag in the root layout) which attaches `window.NativeApp` when
 * running inside the Capacitor WebView. In a regular browser, `window.NativeApp`
 * is undefined and the web fallbacks (localStorage, <input type=file>, UPI
 * deep-link) run unchanged.
 *
 * This type file mirrors the full interface defined in
 * `android-app/src/types/native-app.d.ts` so the web app's TypeScript compiles
 * without depending on the android-app package.
 */

/** A captured document (photo or picked file) returned as base64. */
export interface CapturedDocument {
  /** Base64-encoded file contents (no data: prefix). */
  base64: string;
  /** MIME type: `image/jpeg`, `image/png`, or `application/pdf`. */
  mimeType: string;
  /** Original filename. */
  filename: string;
}

/** Result of a UPI payment intent launch. */
export interface UPIPaymentResult {
  success: boolean;
  app?: string | null;
  error?: string;
}

/** The shape of `window.NativeApp` when the companion app is active. */
export interface NativeAppBridge {
  version: string;
  platform: 'android';
  camera: {
    scan(): Promise<CapturedDocument | null>;
    pick(): Promise<CapturedDocument | null>;
  };
  upi: {
    pay(upiUri: string): Promise<UPIPaymentResult>;
  };
  storage: {
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | null>;
    remove(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  notifications: {
    schedule(title: string, body: string, id?: number): Promise<number>;
    cancel(id: number): Promise<void>;
  };
  openExternal(url: string): Promise<void>;
  getInstallReferrer(): Promise<string | null>;
}

declare global {
  interface Window {
    NativeApp?: NativeAppBridge;
  }

  // Background Sync API (Service Worker SyncManager). The lib.dom types
  // don't include these yet — they're part of the ServiceWorker spec and
  // available in Chromium browsers. Used by src/lib/customer/offline-queue.ts
  // for replay-on-reconnect. iOS Safari falls back to the `online` event.
  interface SyncManager {
    register(tag: string): Promise<void>;
    getTags(): Promise<string[]>;
  }
  interface ServiceWorkerRegistration {
    readonly sync?: SyncManager;
  }
}

export {};
