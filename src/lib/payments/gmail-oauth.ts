/**
 * Gmail OAuth helper — Google OAuth 2.0 authorization code flow.
 *
 * Scope: gmail.readonly (read-only — Printelyx never sends email on the
 * shopkeeper's behalf).
 *
 * Env vars (server-side only):
 *   GOOGLE_CLIENT_ID     — OAuth client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET — OAuth client secret
 *   GOOGLE_REDIRECT_URI  — e.g. https://printelyx.cc.cd/api/v1/shops/me/gmail/callback
 *
 * Security:
 *   - Authorization code flow with PKCE-like state validation.
 *   - State token: random hex + shopId, stored in a short-lived cookie,
 *     validated on callback to prevent CSRF.
 *   - Token exchange happens ONLY on the server.
 *   - Refresh token is AES-256-GCM encrypted at rest using PAYMENT_ENCRYPTION_KEY.
 *   - Access tokens are never stored — they're refreshed on demand and used
 *     immediately for the Gmail API call.
 */

import { encryptCredentials, decryptCredentials } from '@/lib/crypto/credential-encryption';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET ?? '';
const REDIRECT_URI = () => process.env.GOOGLE_REDIRECT_URI ?? '';

/** Check if Google OAuth is configured. */
export function isGmailOAuthConfigured(): boolean {
  return !!(CLIENT_ID() && CLIENT_SECRET() && REDIRECT_URI());
}

/** Generate a random state token (32 bytes hex). */
export function generateState(): string {
  return crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

/**
 * Build the Google OAuth consent URL.
 * The state encodes the shopId + a random nonce, separated by ':'.
 */
export function buildAuthUrl(state: string, shopId: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: REDIRECT_URI(),
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline', // request a refresh token
    prompt: 'consent', // force consent to always get a refresh token
    state: `${shopId}:${state}`,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange the authorization code for tokens (server-side only).
 * Returns the refresh token + access token + expiry + granted scopes.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scope: string;
  email?: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: REDIRECT_URI(),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${error.slice(0, 200)}`);
  }

  const data = await res.json() as {
    refresh_token?: string;
    access_token: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  };

  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Revoke access in Google Account settings and try again.');
  }

  // Decode the id_token to get the email (if present).
  let email: string | undefined;
  if (data.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString());
      email = payload.email;
    } catch { /* ignore */ }
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    email,
  };
}

/**
 * Refresh the access token using the stored (encrypted) refresh token.
 * Returns the fresh access token — never stored, used immediately.
 */
export async function refreshAccessToken(encryptedRefreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const refreshToken = String(decryptCredentials(encryptedRefreshToken).token);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${error.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Encrypt a refresh token for storage. */
export function encryptRefreshToken(token: string): string {
  return encryptCredentials({ token });
}

/** Revoke the Google OAuth token (called on disconnect). */
export async function revokeToken(encryptedRefreshToken: string): Promise<void> {
  try {
    const refreshToken = String(decryptCredentials(encryptedRefreshToken).token);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${refreshToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Best-effort — the token may already be expired or revoked.
  }
}

export { GMAIL_READONLY_SCOPE };
