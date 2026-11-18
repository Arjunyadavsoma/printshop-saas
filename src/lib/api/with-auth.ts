import { NextResponse, type NextRequest } from 'next/server';
import { hashDeviceToken, legacyDeviceTokenHash } from '@/lib/api/device-token';
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
    // Container build can THROW in production (fail-fast env validation —
    // e.g. DEVICE_TOKEN_PEPPER). Acquire it inside the try so such failures
    // return the standard JSON error envelope instead of a bare empty 500.
    let container: ReturnType<typeof getContainer> | null = null;
    try {
      container = getContainer();
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
      // container may be null when the container build itself threw —
      // still answer with the envelope, just without structured logging.
      if (container) {
        logRequest(container.logger, req.method, req.nextUrl.pathname, res.status, 0, rid);
      }
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
 * with the versioned scheme from '@/lib/api/device-token' (v2 = HMAC with
 * DEVICE_TOKEN_PEPPER, legacy = the pre-Phase-C 'print-agent-salt' HMAC) and
 * matched against printAgent.tokenHash. The agent's shopId is the tenant
 * scope. Heartbeats refresh lastSeenAt + isOnline so the dispatch path knows
 * an agent is reachable.
 *
 * H2 fix: a recognised-but-DISABLED agent (`isEnabled === false`) is rejected
 * with 403 DEVICE_DISABLED — the shopkeeper can disable a lost/stolen PC via
 * PATCH /api/v1/shops/me/devices/:deviceId without deleting the agent row
 * (which would lose audit history).
 *
 * Token rotation overlap: after POST /api/v1/companion/token/rotate the old
 * token's hash is kept in `prevTokenHash` for a short grace window, so a
 * device that lost the rotation response can still recover. The window is
 * deliberately short (10 minutes) and the old credential is NOT granted
 * unrestricted access inside it: see PREVIOUS_CREDENTIAL_ALLOWED below.
 *
 * Rate limiting: every authenticated device call is rate-limited per agent
 * per path (default 150 req/min — well above the companion's ~60/min worst
 * case; individual routes may tune it via opts.rateLimit).
 */
const DEVICE_TOKEN_OVERLAP_MS = 10 * 60 * 1000;

/**
 * Default per-agent cap when a route does not declare its own limit. Sized
 * well above the companion's legitimate cadence (2s job poll + 3s command
 * poll + 15s heartbeat ≈ 60 req/min worst case, all combined), so normal
 * devices are never slowed — but runaway or compromised devices are throttled.
 * Keyed per agent per path (devices behind a shop NAT share an IP, so IP
 * keying would falsely group them).
 */
const DEFAULT_DEVICE_RATE_LIMIT = { limit: 150, windowSeconds: 60 };

/**
 * What the PREVIOUS credential may do during the rotation overlap window.
 * Policy (Phase C): the old token is accepted ONLY for operations that let a
 * device recover or report presence/read state —
 *   - retry the rotation itself (lost-response recovery),
 *   - heartbeat (stay visible online),
 *   - read-only polling (pending jobs, pending commands, sync read).
 * State-mutating operations (job status reports, delivery receipts, command
 * result reports, sync push) REQUIRE the current token, so a leaked previous
 * token cannot advance job state during the window. Not in the list → 403
 * TOKEN_OVERLAP_READ_ONLY.
 */
const PREVIOUS_CREDENTIAL_ALLOWED = new Set([
  '/api/v1/companion/token/rotate',
  '/api/v1/agents/heartbeat',
  '/api/v1/agents/jobs/pending',
  '/api/v1/companion/commands:GET',
  '/api/v1/sync/pull',
  '/api/v1/sync/status',
]);

export interface DeviceAuthOptions {
  rateLimit?: { limit: number; windowSeconds: number };
}

export function withDeviceAuth<P extends RouteParams = RouteParams>(
  handler: (req: NextRequest, ctx: RouteCtx<P>, agent: AgentPrincipal) => Promise<NextResponse>,
  opts?: DeviceAuthOptions,
) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<NextResponse> => {
    try {
      // Inside the try: container-build failures (fail-fast env validation)
      // must return the JSON error envelope, not a bare empty 500.
      const container = getContainer();
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new UnauthorizedError('Missing device token');
      const v2Hash = hashDeviceToken(token);
      const legacyHash = legacyDeviceTokenHash(token);
      // Current credential first: v2 (versioned) or legacy (pre-rotation
      // devices that have not migrated through the rotate flow yet).
      let agent = await repos.printAgents.findByTokenHash(v2Hash);
      if (!agent) agent = await repos.printAgents.findByTokenHash(legacyHash);
      let isPreviousCredential = false;
      if (!agent) {
        // Rotation overlap: fall back to the previous token hash (either
        // format) if it is still inside the grace window.
        agent = await repos.printAgents.findByPreviousTokenHash(v2Hash, DEVICE_TOKEN_OVERLAP_MS);
        if (!agent) {
          agent = await repos.printAgents.findByPreviousTokenHash(legacyHash, DEVICE_TOKEN_OVERLAP_MS);
        }
        isPreviousCredential = agent !== null;
      }
      if (!agent) throw new UnauthorizedError('Unknown device token');
      // H2: a disabled device is a security revocation — reject every
      // authenticated call. The token is still recognised (so we don't leak
      // whether the token exists to a brute-forcer), but the device can no
      // longer mutate any state on the shop's behalf.
      if (agent.isEnabled === false) {
        throw new ForbiddenError(
          'DEVICE_DISABLED: This device has been disabled by the shopkeeper. Ask them to re-enable it from /shop/devices.',
        );
      }
      // Phase C: the previous credential is read-only + recovery only.
      // Set entries may be path+method ('...:GET') for method-sensitive
      // routes, or bare paths when the route only exposes one method.
      const routeKey = `${req.nextUrl.pathname}:${req.method}`;
      if (
        isPreviousCredential &&
        !PREVIOUS_CREDENTIAL_ALLOWED.has(routeKey) &&
        !PREVIOUS_CREDENTIAL_ALLOWED.has(req.nextUrl.pathname)
      ) {
        throw new ForbiddenError(
          'TOKEN_OVERLAP_READ_ONLY: The previous token is only accepted for heartbeat, read-only polling, and rotation recovery. Complete the rotation or re-pair the device.',
        );
      }
      // Always rate-limit (per-route override allowed).
      const rl = opts?.rateLimit ?? DEFAULT_DEVICE_RATE_LIMIT;
      await rateLimit(
        container.cache,
        `device:${agent.id}:${req.nextUrl.pathname}`,
        rl.limit,
        rl.windowSeconds,
      );
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
