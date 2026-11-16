import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { UnauthorizedError } from '@platform/core/errors';
import { toPublic } from '@platform/core/domain';

const LoginCustomerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

/**
 * POST /api/v1/auth/login-customer
 *
 * Log in a customer account. Returns a JWT with role='customer' and
 * shopId=null (customers are not shop-scoped).
 *
 * No account enumeration: returns the same "Invalid email or password"
 * error whether the email is unknown, the password is wrong, or the
 * account is deactivated. (The repository throws UnauthorizedError in
 * all three cases.)
 *
 * Rate limited: 10 attempts per 60s per IP.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'login-customer'), 10, 60);
    const body = LoginCustomerSchema.parse(await req.json());
    const container = getContainer();

    const account = await repos.customerAccounts.verifyCredentials(
      body.email,
      body.password,
      container.auth,
    );

    const access = await container.auth.issueAccessToken({
      id: account.id,
      shopId: null,
      role: 'customer',
    });
    const refresh = await container.auth.issueRefreshToken({
      id: account.id,
      shopId: null,
      role: 'customer',
    });

    await repos.audit.log({
      shopId: null,
      userId: null,
      action: 'customer.login',
      entityType: 'customerAccount',
      entityId: account.id,
      metadata: { email: account.email },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      account: toPublic(account),
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
    });
  } catch (cause) {
    if (cause instanceof UnauthorizedError) {
      // Don't leak whether the email is registered — return the same
      // generic UnauthorizedError for unknown email, wrong password,
      // or deactivated account.
      return fail(cause);
    }
    return fail(toAppError(cause));
  }
}
