import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';

const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * POST /api/v1/auth/logout — revoke the refresh-token session server-side.
 *
 * H16 fix: previously the only "logout" was the client-side `api.clearAuth()`
 * which clears localStorage but leaves the refresh-token `jti` live in the
 * cache. A stolen refresh token continued to work for up to 30 days after
 * the user "logged out". This endpoint closes that gap:
 *
 *   1. Verify the refresh token (side-effect-free — does NOT rotate it).
 *   2. Extract the `jti`.
 *   3. `revokeRefreshToken(jti)` → `cache.del('refresh:${jti}')`.
 *   4. Write an `auth.logout` audit-log entry.
 *
 * The endpoint is NOT behind `withAuth()` — the user's access token may
 * already be expired (that's a common reason to log out), but the refresh
 * token is still valid for revocation. We rate-limit by IP to make
 * brute-force probing of refresh tokens uneconomic.
 *
 * Idempotent: if the refresh token is already invalid/expired/revoked, we
 * still return 200 success — the user's mental model is "I am now logged
 * out", and that's true regardless of whether the server actually had to
 * delete anything. Returning an error would leak that the token state was
 * different from what the caller expected.
 *
 * Request:  { "refreshToken": "..." }
 * Response: { "success": true, "data": { "revoked": true } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limit: 30 logouts / 60s per IP — generous because the user might
    // legitimately log out from multiple tabs, but caps brute-force probing.
    await rateLimit(getContainer().cache, rateKey(req, 'logout'), 30, 60);

    const body = LogoutSchema.safeParse(await req.json().catch(() => ({})));
    // If the body is malformed, treat it as "nothing to revoke" → success.
    // This matches the idempotent semantics described above.
    if (!body.success) {
      return ok({ revoked: false, message: 'No refresh token provided — nothing to revoke.' });
    }

    const container = getContainer();
    // Side-effect-free verify: extract jti WITHOUT rotating.
    const claims = await container.auth.verifyRefreshToken(body.data.refreshToken);
    if (!claims) {
      // Token is malformed, expired, or has the wrong issuer/audience.
      // Idempotent: the session is already gone → success.
      return ok({ revoked: false, message: 'Refresh token is already invalid or expired.' });
    }

    // Revoke the jti — cache.del is a no-op if the key doesn't exist (e.g.
    // already rotated or revoked), which keeps logout idempotent.
    await container.auth.revokeRefreshToken(claims.jti);

    // Best-effort audit log. The shopId may be null (admin or unscoped
    // user); userId is the token's subject. Audit failures are swallowed
    // by the repo so this never breaks the logout flow.
    void repos.audit
      .log({
        shopId: claims.shopId ?? null,
        userId: claims.sub,
        action: 'auth.logout',
        entityType: 'user',
        entityId: claims.sub,
        ip: req.headers.get('x-forwarded-for') ?? null,
      })
      .catch(() => {});

    return ok({ revoked: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
