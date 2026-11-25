import Link from 'next/link';
import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';
import { isClerkEnabled } from '@/lib/clerk';

/**
 * /sso-callback — intermediate route for Clerk's custom OAuth flow.
 *
 * The sign-in page's Google button calls `signIn.sso()` with
 * `redirectCallbackUrl: '/sso-callback'`; Clerk redirects here after
 * Google, this component completes the handshake, and Clerk then sends
 * the user to `redirectUrl` (`/shop/login?clerk=1`), where
 * <ClerkSessionSync /> exchanges the Clerk session for the app JWT.
 *
 * Two guards, both load-bearing:
 *
 * 1. `dynamic = 'force-dynamic'` — this page must never be statically
 *    prerendered at build time. <AuthenticateWithRedirectCallback />
 *    reads the live OAuth redirect (search params + Clerk session), so
 *    prerendering it has nothing to render and fails the build.
 *
 * 2. Clerk-enabled check — <AuthenticateWithRedirectCallback /> calls
 *    Clerk hooks that throw without a <ClerkProvider> mounted. The
 *    root layout mounts the provider only when Clerk keys are set, so
 *    with keys unset (e.g. a fresh deploy before the Clerk account
 *    exists) this page renders an honest "not set up yet" message
 *    instead of crashing. The Google button only appears when Clerk
 *    is configured, so a real user only reaches here with keys set.
 */
export const dynamic = 'force-dynamic';

export default function SsoCallbackPage() {
  if (!isClerkEnabled()) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-halo-surface px-6 text-center text-halo-text">
        <p className="text-lg font-bold">Google sign-in isn&rsquo;t set up yet</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-halo-text-60">
          Printelyx signs shops in with email for now. Use the email
          sign-in on the login page instead.
        </p>
        <Link
          href="/shop/login"
          className="mt-6 flex min-h-[48px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white"
        >
          Back to sign in
        </Link>
      </main>
    );
  }
  return <AuthenticateWithRedirectCallback />;
}
