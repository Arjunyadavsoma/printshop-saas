import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, clerkClient } from '@clerk/nextjs/server';
import { UnauthorizedError, ValidationError } from '@platform/core/errors';
import { getContainer } from '@/lib/container';
import { linkOrCreateClerkUser } from '@/lib/auth/clerk-users';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';

/**
 * POST /api/v1/auth/clerk-session — exchange a verified Clerk session
 * for the app's own JWT pair.
 *
 * Dual-auth migration seam: Clerk proves *who* the user is (Google OAuth
 * on the sign-in page); the app's JWT is still the session token every
 * API route understands (`withAuth`). The caller must already hold a
 * valid Clerk session (the Clerk session cookie).
 *
 * Why no `auth()` / `currentUser()` here: in @clerk/nextjs v7 those
 * require `clerkMiddleware()` to have run on the request, and this app
 * deliberately has no Clerk middleware — `src/middleware.ts` is only the
 * app's own security-headers middleware, and the JWT login path must keep
 * working with or without Clerk. Calling `auth()` without the middleware
 * throws ("clerkMiddleware() was not run..."), which used to surface as a
 * 500 on every exchange and made Google sign-in fail for everyone. This
 * route instead verifies the session JWT directly with `verifyToken`
 * (signature checked against Clerk's JWKS) and fetches the user with the
 * Backend API client — no middleware needed. No Clerk token is ever
 * trusted from the request body.
 *
 * The local user is found or created by `linkOrCreateClerkUser`:
 * existing shopkeepers are matched by email and keep their account,
 * shop, and role; a brand-new Clerk user gets a fresh `owner` account.
 * The JWT login path is untouched — it keeps working with or without
 * Clerk configured.
 *
 * Request:  {} (Clerk `__session` cookie)
 * Response: { "success": true, "data": { "accessToken", "refreshToken", "role", "email" } }
 *           401 when there is no valid Clerk session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'clerk-session'), 20, 60);

    const sessionToken = req.cookies.get('__session')?.value;
    if (!sessionToken) {
      return fail(new UnauthorizedError('No Clerk session — sign in with Google first.'));
    }

    let userId: string;
    try {
      // `verifyToken` needs its options argument: the secret key lets it
      // load Clerk's JWKS and verify the session JWT's signature.
      const claims = await verifyToken(sessionToken, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      userId = claims.sub;
    } catch {
      return fail(new UnauthorizedError('No Clerk session — sign in with Google first.'));
    }

    const clerkUser = await (await clerkClient()).users.getUser(userId);
    const email = clerkUser?.primaryEmailAddress?.emailAddress?.toLowerCase();
    if (!email) {
      return fail(new ValidationError('Your Clerk account has no verified email address.'));
    }

    const container = getContainer();
    const user = await linkOrCreateClerkUser(userId, email, container.auth);
    const access = await container.auth.issueAccessToken(user);
    const refresh = await container.auth.issueRefreshToken(user);

    return ok({
      accessToken: access.token,
      refreshToken: refresh.token,
      role: user.role,
      email: user.email,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
