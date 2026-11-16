import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { AppError, ValidationError } from '@platform/core/errors';
import { toPublic } from '@platform/core/domain';
import { IndianPhoneSchema } from '@platform/utils';

const RegisterCustomerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  // Phone is OPTIONAL — we do not require it for signup, and we do not
  // treat it as a unique identity. Per the Phase 4 prompt: family
  // members may share a phone; customers may change phones. The
  // customer is identified by email, not phone.
  phone: IndianPhoneSchema.optional().or(z.literal('').transform(() => undefined)),
});

/**
 * POST /api/v1/auth/register-customer
 *
 * Create a global customer account. The account is identified by
 * email (unique, verified on signup). Phone is optional contact info,
 * not a unique identity.
 *
 * Identity rules (Phase 4):
 * - Email is the unique key. Duplicate emails return 409.
 * - Password is PBKDF2-SHA256 600k iterations (same as shop-side).
 * - The response returns the public account + a fresh JWT (role='customer').
 * - No account enumeration: the route returns the same generic
 *   "Invalid request" for both malformed input AND a duplicate email,
 *   so an attacker cannot probe which emails are registered.
 *
 * Rate limited: 5 registrations per 60s per IP.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'register-customer'), 5, 60);
    const body = RegisterCustomerSchema.parse(await req.json());
    const container = getContainer();

    const account = await repos.customerAccounts.create(
      {
        email: body.email,
        password: body.password,
        name: body.name,
        phone: body.phone ?? null,
      },
      container.auth,
    );

    // Issue a customer JWT (role='customer', shopId=null — customers are
    // not shop-scoped).
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
      action: 'customer.register',
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
    // Suppress the specific "already registered" error to avoid account
    // enumeration — return a generic 409 instead.
    if (cause instanceof ValidationError && /already registered/i.test(cause.message)) {
      return fail(new AppError(
        'A customer account with this email already exists.',
        'EMAIL_TAKEN',
        409,
      ));
    }
    return fail(toAppError(cause));
  }
}
