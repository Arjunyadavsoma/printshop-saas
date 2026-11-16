import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { UnauthorizedError } from '@platform/core/errors';

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { refreshToken } = RefreshSchema.parse(await req.json());
    const container = getContainer();

    // Verify + rotate the refresh token. The adapter returns a new pair
    // but has no DB access, so the access token it mints does not yet carry
    // admin permissions. We re-mint the access token below with the user's
    // CURRENT permissions so a revoked admin perm takes effect on the next
    // refresh. (WithAuth also re-checks the DB on every request, so a
    // revoked perm is effective immediately even mid-token.)
    const pair = await container.auth.rotateRefreshToken(refreshToken);
    if (!pair) throw new UnauthorizedError('Refresh token is invalid, expired, or already used');

    // Decode the freshly-minted access token to read its `sub` + `role`
    // (the token was just signed by us, so this is safe — we are not
    // trusting client input).
    const parts = pair.access.split('.');
    if (parts.length === 3) {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as
        { sub?: string; role?: string };
      if (claims.sub && claims.role === 'admin') {
        const adminUser = await repos.users.findById(claims.sub);
        if (adminUser) {
          const reissued = await container.auth.issueAccessToken({
            id: adminUser.id,
            shopId: adminUser.shopId,
            role: adminUser.role,
            adminPermissions: adminUser.adminPermissions,
          });
          return ok({ accessToken: reissued.token, refreshToken: pair.refresh });
        }
      }
    }

    return ok({ accessToken: pair.access, refreshToken: pair.refresh });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
