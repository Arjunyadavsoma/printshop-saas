import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, clerkClient } from '@clerk/nextjs/server';
import { UnauthorizedError, ValidationError } from '@platform/core/errors';
import { getContainer } from '@/lib/container';
import { linkOrCreateClerkCustomer } from '@/lib/auth/clerk-customers';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';

/**
 * POST /api/v1/auth/clerk-session/customer — exchange a verified Clerk
 * session for the app's own JWT pair, for CUSTOMERS.
 *
 * The consumer twin of `/api/v1/auth/clerk-session` (shopkeepers). Same
 * verification pattern — `verifyToken` against the `__session` cookie
 * plus a Backend API `clerkClient().users.getUser` lookup; never
 * `auth()`/`currentUser()` (no Clerk middleware runs in this app, so
 * those throw). No Clerk token is ever trusted from the request body.
 *
 * The difference is the identity it mints: this route ONLY touches the
 * `CustomerAccount` table (see `linkOrCreateClerkCustomer`). The same Google
 * account may be both a shopkeeper and a customer — the two identities
 * live in different tables, so a customer sign-in can never create an
 * owner account, link a Clerk id onto an owner row, or change an
 * owner's role. The minted JWT carries `role: 'customer'`,
 * `shopId: null`, and is only accepted by the customer routes guarded
 * by `withCustomerAuth` — never by the shopkeeper/admin routes.
 *
 * Request:  {} (Clerk `__session` cookie)
 * Response: { "success": true, "data": { "accessToken", "refreshToken", "role": "customer", "email", "name" } }
 *           401 when there is no valid Clerk session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'clerk-session-customer'), 20, 60);

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
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

    const container = getContainer();
    const customer = await linkOrCreateClerkCustomer(userId, email, name);
    const access = await container.auth.issueAccessToken({
      id: customer.id,
      shopId: null,
      role: 'customer',
    });
    const refresh = await container.auth.issueRefreshToken({
      id: customer.id,
      shopId: null,
      role: 'customer',
    });

    return ok({
      accessToken: access.token,
      refreshToken: refresh.token,
      role: 'customer',
      email: customer.email,
      name: customer.name,
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
