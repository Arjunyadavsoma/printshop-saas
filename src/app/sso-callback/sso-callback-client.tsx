'use client';

import { useEffect, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';

/**
 * Hardened OAuth callback.
 *
 * The stock <AuthenticateWithRedirectCallback /> renders nothing and
 * swallows handshake errors — a failed handshake left users on a
 * permanent white screen here (seen live 2026-11-26). This component
 * does the same handshake explicitly so every outcome is visible:
 *
 * - while waiting: a "Signing you in…" state, never a blank page;
 * - success: Clerk navigates to /shop/login?clerk=1 (or the already
 *   signed-in shortcut below fires first);
 * - failure or 15s timeout: an error with a way back to sign in.
 *
 * The redirect URLs are passed explicitly instead of relying on the
 * sign-in attempt's stored redirect — if that attempt is lost (e.g.
 * the browser dropped the attempt cookie on the way back from
 * Google), the callback still knows where to send the user.
 */
const AFTER_OAUTH = '/shop/login?clerk=1';

export function SsoCallbackClient() {
  const clerk = useClerk();
  const { isSignedIn, isLoaded } = useUser();
  const [error, setError] = useState<string | null>(null);

  // The OAuth step already established the session (Google accepted
  // the login) but the handshake stalled: skip it and go straight
  // back — <ClerkSessionSync /> on the login page finishes the job.
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      window.location.href = AFTER_OAUTH;
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    let done = false;
    const fail = (message: string) => {
      if (!done) {
        done = true;
        setError(message);
      }
    };
    const timer = window.setTimeout(() => {
      fail('Google sign-in timed out. Please try again.');
    }, 15000);
    void clerk
      .handleRedirectCallback({
        signInForceRedirectUrl: AFTER_OAUTH,
        signUpForceRedirectUrl: AFTER_OAUTH,
      })
      .catch(() => {
        fail('Google sign-in couldn’t be completed. Please try again.');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      done = true;
      window.clearTimeout(timer);
    };
  }, [isLoaded, isSignedIn, clerk]);

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-halo-surface px-6 text-center text-halo-text">
        <p className="text-lg font-bold">Google sign-in didn’t finish</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-halo-text-60">{error}</p>
        <a
          href="/shop/login"
          className="mt-6 flex min-h-[48px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white"
        >
          Back to sign in
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-halo-surface px-6 text-center text-halo-text">
      <p className="text-lg font-bold">Signing you in…</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-halo-text-60">
        Finishing your Google sign-in. This only takes a moment.
      </p>
    </main>
  );
}
