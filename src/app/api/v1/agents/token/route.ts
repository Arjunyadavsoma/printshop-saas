import { withDeviceAuth } from '@/lib/api/with-auth';
import { getContainer } from '@/lib/container';
import { ok } from '@/lib/api/envelope';

/**
 * POST /api/v1/agents/token — device-token-authed. Exchanges the agent's
 * long-lived device token for a short-lived JWT (shop-scoped, role 'staff')
 * that the agent uses to authenticate its socket.io connection to the realtime
 * mini-service (which verifies HS256 JWTs). The device token itself never
 * leaves the agent's machine after setup.
 */
export const POST = withDeviceAuth(async (_req, _ctx, { agent, shopId }) => {
  const container = getContainer();
  const access = await container.auth.issueAccessToken({ id: `agent:${agent.id}`, shopId, role: 'staff' });
  return ok({ accessToken: access.token, expiresIn: access.claims.exp - access.claims.iat, shopId });
});
