import { NextResponse, type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from './envelope';
import { rateLimit, rateKey } from './rate-limit';
import { ForbiddenError, UnauthorizedError } from '@platform/core/errors';
import type { UserRole, User } from '@platform/core/domain';

/** The verified principal attached to an authenticated request. */
export interface Principal {
  userId: string;
  shopId: string | null;
  role: UserRole;
  email: string;
  user: User;
}

type RouteParams = Record<string, string>;
type RouteCtx<P extends RouteParams> = { params: Promise<P> };
type AuthHandler<P extends RouteParams> = (
  req: NextRequest,
  ctx: RouteCtx<P>,
  principal: Principal,
) => Promise<NextResponse>;

/**
 * Wrap a route handler with JWT auth + optional role enforcement. The
 * resolved principal's `shopId` is the tenant scope — every downstream
 * query MUST filter by it. If the role isn't allowed, 403.
 */
export function withAuth<P extends RouteParams = RouteParams>(
  handler: AuthHandler<P>,
  allowedRoles?: UserRole[],
) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      const container = getContainer();
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new UnauthorizedError('Missing bearer token');

      const claims = await container.auth.verifyAccessToken(token);
      if (!claims) throw new UnauthorizedError('Invalid or expired token');
      if (allowedRoles && !allowedRoles.includes(claims.role)) {
        throw new ForbiddenError(`Role '${claims.role}' is not permitted`);
      }

      const user = await repos.users.findById(claims.sub);
      if (!user) throw new UnauthorizedError('User no longer exists');

      // If the JWT's shopId disagrees with the user's current shopId, reject
      // — defends against stale tokens after a shop reassignment.
      if (claims.shopId !== user.shopId) {
        throw new UnauthorizedError('Token shop scope is stale');
      }

      const principal: Principal = {
        userId: user.id,
        shopId: user.shopId,
        role: user.role,
        email: user.email,
        user,
      };
      return await handler(req, ctx, principal);
    } catch (cause) {
      return fail(toAppError(cause));
    }
  };
}

/** Wrap a public (unauthenticated) handler with a rate limit. */
export function withRateLimit<P extends RouteParams = RouteParams>(
  scope: string,
  limit: number,
  windowSeconds: number,
  handler: (req: NextRequest, ctx: RouteCtx<P>) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      await rateLimit(getContainer().cache, rateKey(req, scope), limit, windowSeconds);
      return await handler(req, ctx);
    } catch (cause) {
      return fail(toAppError(cause));
    }
  };
}

/** Wrap a simple handler with try/catch → envelope. */
export function withHandle<P extends RouteParams = RouteParams>(
  handler: (req: NextRequest, ctx: RouteCtx<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      const data = await handler(req, ctx);
      return ok(data);
    } catch (cause) {
      return fail(toAppError(cause));
    }
  };
}
