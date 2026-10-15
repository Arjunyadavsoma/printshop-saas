import { NextResponse, type NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError, requestId, logRequest } from './envelope';
import { rateLimit, rateKey } from './rate-limit';
import { ForbiddenError, UnauthorizedError } from '@platform/core/errors';
import type { UserRole, User, PrintAgent } from '@platform/core/domain';

/** Time + log a handler call, set the X-Request-Id response header. */
async function timed<P>(
  req: NextRequest,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const rid = requestId(req);
  const path = req.nextUrl.pathname;
  const start = Date.now();
  let res: NextResponse;
  try {
    res = await fn();
  } catch (cause) {
    res = fail(toAppError(cause));
  }
  const dur = Date.now() - start;
  logRequest(getContainer().logger, req.method, path, res.status, dur, rid);
  try { res.headers.set('x-request-id', rid); } catch { /* immutable in some cases */ }
  return res;
}

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
    const container = getContainer();
    try {
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
      return await timed(req, () => handler(req, ctx, principal));
    } catch (cause) {
      const res = fail(toAppError(cause));
      const rid = requestId(req);
      logRequest(container.logger, req.method, req.nextUrl.pathname, res.status, 0, rid);
      try { res.headers.set('x-request-id', rid); } catch {}
      return res;
    }
  };
}

/** The verified agent principal (a registered print-agent daemon). */
export interface AgentPrincipal {
  agent: PrintAgent;
  shopId: string;
}

/**
 * Wrap a route handler with device-token auth. The Bearer token is hashed
 * (SHA-256) and matched against printAgent.tokenHash. The agent's shopId is
 * the tenant scope. Heartbeats refresh lastSeenAt + isOnline so the dispatch
 * path knows an agent is reachable.
 */
export function withDeviceAuth<P extends RouteParams = RouteParams>(
  handler: (req: NextRequest, ctx: RouteCtx<P>, agent: AgentPrincipal) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new UnauthorizedError('Missing device token');
      const tokenHash = createHmac('sha256', 'print-agent-salt').update(token).digest('hex');
      const agent = await repos.printAgents.findByTokenHash(tokenHash);
      if (!agent) throw new UnauthorizedError('Unknown device token');
      // Refresh presence on every authenticated call (cheap; the heartbeat
      // also does it explicitly).
      await repos.printAgents.update(agent.id, { isOnline: true, lastSeenAt: new Date() });
      return await timed(req, () => handler(req, ctx, { agent, shopId: agent.shopId }));
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
      return await timed(req, () => handler(req, ctx));
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
