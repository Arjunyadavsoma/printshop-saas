/**
 * Onboarding persistence — localStorage flag read/written by the splash
 * and onboarding screens.
 *
 * This is a UI-preference flag ONLY (like a theme choice): it decides
 * whether the onboarding carousel is shown. It is NEVER used to assume
 * authentication — the splash screen separately checks the real
 * AuthContext (token + role) for that, exactly as the assignment
 * requires ("Never assume that a user is authenticated based only on
 * locally stored UI state").
 *
 * Inside the Printelyx Companion Android app, localStorage is backed by
 * the native storage bridge transparently (same origin WebView), so no
 * special handling is needed here.
 */

const KEY = 'printelyx:onboarding-complete';

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // localStorage unavailable — the user will see onboarding again; harmless.
  }
}

/** Reset (used by the "See intro again" affordance, if ever added). */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
