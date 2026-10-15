import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { UnauthorizedError } from '@platform/core/errors';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'login'), 20, 60);
    const body = LoginSchema.parse(await req.json());
    const container = getContainer();

    const user = await repos.users.verifyCredentials(body.email, body.password, container.auth);
    if (!user.shopId) {
      // Admins (no shop) can't log in via the shop-owner endpoint.
      throw new UnauthorizedError('No shop associated with this account');
    }

    const access = await container.auth.issueAccessToken({
      id: user.id,
      shopId: user.shopId,
      role: user.role,
    });
    const refresh = await container.auth.issueRefreshToken({
      id: user.id,
      shopId: user.shopId,
      role: user.role,
    });

    await repos.audit.log({
      shopId: user.shopId,
      userId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
      user: { id: user.id, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
