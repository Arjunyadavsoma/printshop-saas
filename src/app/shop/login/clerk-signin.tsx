'use client';

import { useEffect, useRef, useState } from 'react';
import { useSignIn, useUser } from '@clerk/nextjs';
import { useApiClient } from '@/components/portal/use-api-client';
import { GoogleMark } from '@/components/clear/provider-marks';

/**
 * Clerk sign-in pieces for the halo login page.
 *
 * These components are only rendered when Clerk is configured
 * (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set) — the login page gates them.
 * They must live in their own module because `useSignIn` / `useUser`
 * throw when no `<ClerkProvider>` is mounted, and the provider itself
 * is only mounted when Clerk is configured (see `src/app/layout.tsx`).
 */

const GOOGLE_PILL_CLASS =
  'flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-halo-pill text-[15px] font-semibold text-halo-ink transition-colors hover:bg-halo-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

/** "Continue with Google" — real Google OAuth via Clerk (v7 signal API). */
export function ClerkGoogleButton() {
  const { signIn } = useSignIn();
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (!signIn) return;
    const { error: ssoError } = await signIn.sso({
      strategy: 'oauth_google',
      // After SSO completes, Clerk lands on /sso-callback, which
      // completes the handshake and sends the user back here, where
      // <ClerkSessionSync /> exchanges the session for the app JWT.
      redirectUrl: '/shop/login?clerk=1',
      // Intermediate callback route. NOTE: this SDK version types
      // `redirectCallbackUrl` as required for signIn.sso(), so the
      // callback page cannot be skipped — instead it is hardened
      // (loading + error states, explicit redirect URLs) so a failed
      // handshake never leaves a blank page.
      redirectCallbackUrl: '/sso-callback',
    });
    if (ssoError) {
      setError(ssoError.message ?? 'Google sign-in failed. Try email instead.');
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
        <div role="alert" className="mt-4 rounded-2xl border border-halo-danger/40 bg-halo-danger-soft px-4 py-3 text-sm text-halo-danger-text">
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Completes a Clerk sign-in: after the Google OAuth redirect lands back
 * on `/shop/login`, the Clerk session is live — exchange it (server-side
 * verified) for the app's own JWT pair and redirect by role, exactly
 * like the email+password login does.
 *
 * Runs once per mount when the Clerk user is signed in. If the exchange
 * fails (e.g. the Clerk account has no email), it shows the error inline
 * instead of redirecting — the email form below still works.
 */
export function ClerkSessionSync() {
  const { isSignedIn, isLoaded } = useUser();
  const api = useApiClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || tried.current) return;
    tried.current = true;
    void (async () => {
      try {
        const r = await api.request<{
          success?: boolean;
          data?: { accessToken: string; refreshToken: string; role: string; email: string };
          error?: { message?: string };
        }>('POST', '/api/v1/auth/clerk-session', { body: {} });
        const inner = r.data?.data;
        if (r.status !== 200 || !inner?.accessToken) {
          setError(r.data?.error?.message ?? 'Could not finish signing in with Google.');
          return;
        }
        api.setAuth(inner.accessToken, inner.refreshToken ?? '', inner.role ?? 'owner', inner.email ?? '');
        window.location.href = inner.role === 'admin' ? '/admin' : '/shop/dashboard';
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Network error');
      }
    })();
  }, [isLoaded, isSignedIn, api]);

  // Google sent the user back (?clerk=1) but no Clerk session appeared:
  // the OAuth step did not establish a session. Say so plainly instead
  // of leaving the plain sign-in form with no explanation. The 3s delay
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
    <div
      role="alert"
      className="mt-4 rounded-2xl border border-halo-danger/40 bg-halo-danger-soft px-4 py-3 text-sm text-halo-danger-text"
    >
      {error ?? notice}
    </div>
  );
}
