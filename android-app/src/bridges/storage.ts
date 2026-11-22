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
import { Preferences } from '@capacitor/preferences';

export async function setSecure(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch {
    // If Preferences fails (rare: device storage full), fall back silently.
    // The web app's localStorage path will pick up the slack.
  }
}

export async function getSecure(key: string): Promise<string | null> {
  try {
    const result = await Preferences.get({ key });
    return result.value;
  } catch {
    // Key doesn't exist, or read failed — return null (caller treats
    // this as "not authenticated" and redirects to login).
    return null;
  }
}

export async function removeSecure(key: string): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch {
    // best-effort
  }
}

export async function clearSecure(): Promise<void> {
  try {
    await Preferences.clear();
  } catch {
    // best-effort
  }
}
