import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
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
 * credential verification.
 *
 * H1 fix: the previous implementation used `Buffer.equals()`, which is NOT
 * guaranteed to be constant-time across Node.js versions (the docs only
 * promise "the same as a === comparison"). `crypto.timingSafeEqual` IS
 * guaranteed constant-time, but it throws `RangeError` when the two buffers
 * have different lengths — so we pad to a fixed length first (with a
 * deterministic hash) and compare those. This avoids both the timing leak
 * AND the length-disclosure that an early `length !== length` return would
 * cause.
 *
 * Returns true iff the two UTF-8 strings are byte-for-byte equal.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Hash both buffers to a fixed 32-byte digest, then compare digests
  // constant-time. This sidesteps the length-mismatch throw entirely —
  // SHA-256 output is always 32 bytes regardless of input length — so an
  // attacker cannot learn anything about the secret's length from response
  // timing.
  const digestA = crypto.createHash('sha256').update(bufA).digest();
  const digestB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/** Generate a long random password that is NEVER used for login — it's only
 * stored as the admin user's passwordHash so that the env-var admin can't
 * be logged in via the normal credentials path. The env password itself is
 * never persisted. */
function randomUnusedPassword(): string {
  // 32 bytes → ~43 base64url chars. Cryptographically random.
  return crypto.randomBytes(32).toString('base64url');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await rateLimit(getContainer().cache, rateKey(req, 'login'), 20, 60);
    // Malformed / missing JSON must be a 400 VALIDATION_ERROR, not a 500: a
    // client that posts an empty body (or a proxy that strips it) previously
    // crashed `req.json()` with an unhandled SyntaxError and surfaced as a
    // server error, which looks like "login is broken" on the client side.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON: { "email", "password" }.' } },
        { status: 400 },
      );
    }
    const body = LoginSchema.parse(raw);
    const container = getContainer();

    // H-2 fix: normalise the email to lowercase before lookup. Previously
    // the lookup was case-sensitive (Postgres `=` on a text column is
    // case-sensitive by default), so a user who registered as
    // `User@Example.com` could NOT log in as `user@example.com`. The user
    // repository ALSO lowercases on findByEmail/verifyCredentials
    // (defense-in-depth), but lowercasing here keeps the admin-path
    // comparison and the audit log consistent with the canonical form.
    body.email = body.email.toLowerCase();

    // ── Env-var-based admin login ────────────────────────────────────
    // If ADMIN_EMAIL + ADMIN_PASSWORD env vars are set, and the submitted
    // email matches ADMIN_EMAIL, verify the password using a constant-time
    // comparison. This allows the platform owner to configure admin
    // credentials via Vercel env vars — they're NOT in the code or DB.
    //
    // SECURITY (H1 fix): the admin env password is NEVER stored in the
    // database. Previously the first admin login created a User row with
    // `password: adminPassword` (i.e. the env password was hashed + written
    // to the DB), which means anyone with DB read access could brute-force
    // the env password offline. Now we create the admin User row with a
    // cryptographically RANDOM, unused password — the env password is only
    // kept in memory for the comparison, immediately discarded, and never
    // hashed or written. The admin user's DB `passwordHash` is the hash of
    // a random 32-byte value that nobody knows.
    //
    // The admin user's JWT is issued with role='admin' + shopId=null.
    // No admin credentials are logged or returned in the response.
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword && timingSafeStringEqual(body.email.toLowerCase(), adminEmail.toLowerCase())) {
      if (!timingSafeStringEqual(body.password, adminPassword)) {
        // Wrong admin password — return the SAME generic error as a normal
        // login failure (no account-existence leak).
        throw new UnauthorizedError('Invalid email or password');
      }
      // Admin password verified — find or create the admin user in the DB.
      // The admin user is a normal User row with role='admin' + shopId=null.
      // The passwordHash is the hash of a RANDOM, unused password (NOT the
      // env password) — the env password is only ever compared in-memory
      // here, never persisted.
      let adminUser = await repos.users.findByEmail(adminEmail);
      if (!adminUser) {
        // Create the admin user on first login with a RANDOM password that
        // nobody knows — the env password is NOT persisted.
        adminUser = await repos.users.create(
          {
            email: adminEmail,
            phone: '+919999999999',
            password: randomUnusedPassword(),
            role: 'admin',
            shopId: null,
          },
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
