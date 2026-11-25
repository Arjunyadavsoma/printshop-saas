import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

/**
 * /sso-callback — intermediate route for Clerk's custom OAuth flow.
 *
 * The sign-in page's Google button calls `signIn.sso()` with
 * `redirectCallbackUrl: '/sso-callback'`; Clerk redirects here after
 * Google, this component completes the handshake, and Clerk then sends
 * the user to `redirectUrl` (`/shop/login?clerk=1`), where
 * <ClerkSessionSync /> exchanges the Clerk session for the app JWT.
 *
 * No UI of its own — Clerk renders a loading state while it finishes.
 */
export default function SsoCallbackPage() {
  return <AuthenticateWithRedirectCallback />;
}
