'use client';

import { useEffect, useRef, useState } from 'react';
import { useClerk, useSignIn, useUser } from '@clerk/nextjs';
import { useApiClient } from '@/components/portal/use-api-client';
import { GoogleMark } from '@/components/clear/provider-marks';

/**
 * Clerk sign-in pieces for the consumer profile page.
 *
 * The consumer twin of `src/app/shop/login/clerk-signin.tsx`. Same
 * pattern — Google OAuth via Clerk (`signIn.sso`, `oauth_google`),
 * then an explicit session exchange for the app's own JWT — but the
 * exchange here is the CUSTOMER one
 * (`POST /api/v1/auth/clerk-session/customer`), which only ever touches
 * the `Customer` table. A customer sign-in can never create or touch a
 * shopkeeper account, even for the same Google account.
 *
 * These components are only rendered when Clerk is configured
 * (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set) — the profile page gates
 * them. They must live in their own module because `useSignIn` /
 * `useUser` throw when no `<ClerkProvider>` is mounted, and the
 * provider itself is only mounted when Clerk is configured (see
 * `src/app/layout.tsx`).
 *
 * Google sign-in IS the signup for customers: Clerk SSO creates the
 * customer account on first sign-in. Guest ordering is untouched —
 * signing in is an addition, never a gate.
 */

const GOOGLE_PILL_CLASS =
  'flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] text-[15px] font-semibold text-[var(--label)] transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

const ALERT_CLASS =
  'mt-4 rounded-2xl border border-[var(--danger)]/40 bg-[var(--surface)] px-4 py-3 text-sm text-[var(--danger)]';

/** "Continue with Google" — real Google OAuth via Clerk (v7 signal API). */
export function CustomerGoogleButton() {
  const { signIn } = useSignIn();
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (!signIn) return;
    const { error: ssoError } = await signIn.sso({
      strategy: 'oauth_google',
      // After SSO completes, Clerk lands on /profile, which exchanges
      // the session for the app JWT via <CustomerSessionSync />.
      redirectUrl: '/profile?clerk=1',
      // Intermediate callback route. `?for=customer` tells the hardened
      // callback where to send the user back — the shopkeeper flow uses
      // the same route without the param (see sso-callback-client).
      redirectCallbackUrl: '/sso-callback?for=customer',
    });
    if (ssoError) {
      setError(ssoError.message ?? 'Google sign-in failed. Try again.');
    }
  };
  return (
    <>
      <button
        type="button"
        disabled={!signIn}
        onClick={() => void start()}
        className={GOOGLE_PILL_CLASS}
      >
        <GoogleMark />
        Continue with Google
      </button>
      {error && (
        <div role="alert" className={ALERT_CLASS}>
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Completes a customer Clerk sign-in: after the Google OAuth redirect
 * lands back on `/profile`, the Clerk session is live — exchange it
 * (server-side verified) for the app's own customer JWT pair.
 *
 * Runs once per mount when the Clerk user is signed in. If the exchange
 * fails (e.g. the Clerk account has no email), it shows the error inline
 * instead of redirecting — guest ordering below still works.
 */
export function CustomerSessionSync() {
  const { isSignedIn, isLoaded } = useUser();
  const api = useApiClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || tried.current) return;
    // Wait until the app's own auth state is known: exchanging before
    // localStorage has been read could swap a shopkeeper session the
    // user already holds. (Returning early without setting `tried`
    // lets the effect run again once `api` settles.)
    if (!api.ready) return;
    // Already holding an app session: never silently swap it. A
    // shopkeeper who visits /profile keeps their shopkeeper session
    // (the page shows a shopkeeper notice instead), and a customer who
    // is already signed in needs no re-exchange — without this guard
    // every /profile visit would re-exchange and full-reload the page.
    if (api.token && api.role) return;
    tried.current = true;
    void (async () => {
      try {
        const r = await api.request<{
          success?: boolean;
          data?: { accessToken: string; refreshToken: string; role: string; email: string };
          error?: { message?: string };
        }>('POST', '/api/v1/auth/clerk-session/customer', { body: {} });
        const inner = r.data?.data;
        if (r.status !== 200 || !inner?.accessToken) {
          setError(r.data?.error?.message ?? 'Could not finish signing in with Google.');
          return;
        }
        api.setAuth(inner.accessToken, inner.refreshToken ?? '', inner.role ?? 'customer', inner.email ?? '');
        window.location.href = '/profile';
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Network error');
      }
    })();
  }, [isLoaded, isSignedIn, api]);

  // Google sent the user back (?clerk=1) but no Clerk session appeared:
  // the OAuth step did not establish a session. Say so plainly instead
  // of leaving the plain sign-in button with no explanation. The 3s delay
  // gives Clerk time to restore a session that is still loading, so a
  // slow (but working) return does not flash a false warning.
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    if (!window.location.search.includes('clerk=1')) return;
    const t = window.setTimeout(() => {
      setNotice('Google sign-in didn’t finish — no Google session was found. Please try again.');
    }, 3000);
    return () => window.clearTimeout(t);
  }, [isLoaded, isSignedIn]);

  if (!error && !notice) return null;
  return (
    <div role="alert" className={ALERT_CLASS}>
      {error ?? notice}
    </div>
  );
}

/**
 * Sign out of BOTH sessions: the Clerk (Google) session and the app's
 * customer JWT. Clearing only the app token would leave the Clerk
 * session live, and the next visit to /profile would silently sign the
 * customer straight back in — "Sign out" has to mean signed out.
 */
export function CustomerSignOutButton() {
  const clerk = useClerk();
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clerk.signOut();
    } catch {
      // Clerk sign-out failing must not trap the user: the app token is
      // still cleared below, so the customer session ends either way.
    }
    api.logout();
    window.location.href = '/profile';
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void signOut()}
      className="flex min-h-[48px] items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-6 text-sm font-semibold text-[var(--label)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
