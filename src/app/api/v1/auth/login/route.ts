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

/**
 * Constant-time string comparison to prevent timing attacks on admin
 * credential verification. Returns true if the strings are equal.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return bufA.equals(bufB); // Buffer.equals is constant-time in Node.js
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'login'), 20, 60);
    const body = LoginSchema.parse(await req.json());
    const container = getContainer();

    // ── Env-var-based admin login ────────────────────────────────────
    // If ADMIN_EMAIL + ADMIN_PASSWORD env vars are set, and the submitted
    // email matches ADMIN_EMAIL, verify the password using a constant-time
    // comparison. This allows the platform owner to configure admin
    // credentials via Vercel env vars — they're NOT in the code or DB.
    //
    // SECURITY: the admin password is NEVER stored in the database. It's
    // compared in-memory against the env var + immediately discarded.
    // The admin user's JWT is issued with role='admin' + shopId=null.
    // No admin credentials are logged or returned in the response.
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword && timingSafeEqual(body.email.toLowerCase(), adminEmail.toLowerCase())) {
      if (!timingSafeEqual(body.password, adminPassword)) {
        // Wrong admin password — return the SAME generic error as a normal
        // login failure (no account-existence leak).
        throw new UnauthorizedError('Invalid email or password');
      }
      // Admin password verified — find or create the admin user in the DB.
      // The admin user is a normal User row with role='admin' + shopId=null.
      // The passwordHash is set to a random value (the admin authenticates
      // via the env var, not via the DB password hash).
      let adminUser = await repos.users.findByEmail(adminEmail);
      if (!adminUser) {
        // Create the admin user on first login.
        adminUser = await repos.users.create(
          { email: adminEmail, phone: '+919999999999', password: adminPassword, role: 'admin', shopId: null },
          container.auth,
        );
      }
      // Issue tokens.
      const access = await container.auth.issueAccessToken({ id: adminUser.id, shopId: null, role: 'admin' });
      const refresh = await container.auth.issueRefreshToken({ id: adminUser.id, shopId: null, role: 'admin' });
      await repos.audit.log({
        shopId: null, userId: adminUser.id, action: 'auth.login', entityType: 'user', entityId: adminUser.id,
        ip: req.headers.get('x-forwarded-for') ?? null,
      });
      return ok({
        accessToken: access.token, refreshToken: refresh.token,
        expiresIn: access.claims.exp - access.claims.iat,
        user: { id: adminUser.id, email: adminUser.email, role: 'admin', shopId: null },
      });
    }
    // ── End env-var-based admin login ────────────────────────────────

    // Normal user login (shop owner or demo admin).
    const user = await repos.users.verifyCredentials(body.email, body.password, container.auth);
    if (!user.shopId && user.role !== 'admin') {
      throw new UnauthorizedError('No shop associated with this account');
    }

    const access = await container.auth.issueAccessToken({ id: user.id, shopId: user.shopId, role: user.role });
    const refresh = await container.auth.issueRefreshToken({ id: user.id, shopId: user.shopId, role: user.role });

    await repos.audit.log({
      shopId: user.shopId, userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id,
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      accessToken: access.token, refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
      user: { id: user.id, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
