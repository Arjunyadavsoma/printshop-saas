/**
 * Clerk feature flag — Clerk is ON only when both keys are present.
 *
 * The app runs dual-auth during the migration: the existing JWT
 * email+password login always works, and Clerk (Google OAuth via the
 * sign-in page + the session-exchange route) is an additional way in.
 * Gating on the keys means a deploy without Clerk configured behaves
 * exactly like today — no ClerkProvider is mounted, no Clerk buttons
 * render, no Clerk SDK call is made. Set the keys in Vercel and the
 * Clerk path lights up with no code change.
 *
 * Keys (Vercel env vars):
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — pk_test_… / pk_live_…
 *   CLERK_SECRET_KEY                  — sk_test_… / sk_live_…
 *   CLERK_WEBHOOK_SECRET              — whsec_… (Clerk dashboard → Webhooks)
 */
export function isClerkEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}
