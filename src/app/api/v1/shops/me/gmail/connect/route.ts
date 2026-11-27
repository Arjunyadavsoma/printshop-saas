import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { isGmailOAuthConfigured, buildAuthUrl, generateState } from '@/lib/payments/gmail-oauth';
import { cookies } from 'next/headers';

/**
 * GET /api/v1/shops/me/gmail/connect — redirects to Google OAuth consent.
 * The shopkeeper is redirected to Google's consent screen. After consent,
 * Google redirects back to /gmail/callback with the authorization code.
 *
 * State validation: a random nonce is stored in a short-lived cookie and
 * embedded in the state parameter. The callback validates both to prevent CSRF.
 */
export const GET = withAuth(async (_req, _ctx, principal) => {
  if (!isGmailOAuthConfigured()) {
    return NextResponse.json(
      { error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.' },
      { status: 503 },
    );
  }
  const shop = await repos.shops.getByOwner(principal.userId);
  const state = generateState();
  const authUrl = buildAuthUrl(state, shop.id);
  // Store the state in a short-lived cookie (10 min) for CSRF protection.
  const cookieStore = await cookies();
  cookieStore.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return NextResponse.redirect(authUrl);
}, ['owner']);
