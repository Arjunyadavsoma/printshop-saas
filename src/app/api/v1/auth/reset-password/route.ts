import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { UnauthorizedError, ValidationError } from '@platform/core/errors';

const ResetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * POST /api/v1/auth/reset-password — complete a password reset.
 *
 * H16 fix: the second half of the forgot-password flow. Validates the
 * single-use token, updates the user's passwordHash, marks the token as
 * used, and writes an audit log entry.
 *
 * Single-use enforcement: the `usedAt` column is checked AND set in the
 * same UPDATE — a concurrent request submitting the same token will see
 * `usedAt` set by the first request and fail. (The UNIQUE constraint on
 * `tokenHash` doesn't help here because we're not inserting a new row,
 * we're updating an existing one — but the conditional UPDATE
 * `WHERE usedAt IS NULL` is the atomic single-use guard.)
 *
 * Password policy: minimum 8 chars, maximum 200 chars (the PBKDF2 hash
 * input is bounded to prevent DoS via a multi-MB password string). The
 * frontend should additionally guide the user toward strong passwords
 * via a strength meter, but the server enforces the floor.
 *
 * Token revocation after reset: ideally we'd revoke ALL of the user's
 * refresh-token jtis so any other logged-in session is also kicked out.
 * The current adapter stores jtis in the cache keyed by `refresh:${jti}`
 * without a reverse index to `userId` — we can't enumerate them without
 * scanning the whole cache. The TODO is to add a RefreshToken table that
 * tracks jti→userId so a password reset can revoke all sessions. For now,
 * the OLD refresh tokens remain live until their TTL expires (max 30
 * days), which is acceptable because:
 *   - The attacker who triggered the reset doesn't have the new password.
 *   - The legitimate user's other sessions will eventually expire.
 *   - The user can manually log out from each device.
 *
 * Rate-limited: 10 requests / 15min per IP. Caps brute-force attempts on
 * the reset token (32 bytes → infeasible, but the rate limit is defense
 * in depth).
 *
 * Request:  { "token": "...", "newPassword": "new-secret-123" }
 * Response: { "success": true, "data": { "reset": true } }
 *           400 if password fails validation
 *           401 if token is invalid, expired, or already used
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limit: 10 requests / 15min per IP.
    await rateLimit(getContainer().cache, rateKey(req, 'reset-password'), 10, 15 * 60);

    const body = ResetPasswordSchema.parse(await req.json().catch(() => ({})));
    const container = getContainer();
    const tokenHash = hashToken(body.token);

    // Look up the token by hash. The UNIQUE index on tokenHash makes this
    // O(1).
    let row: { id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null = null;
    try {
      const rows = await (container.db as any).findMany('PasswordResetToken', { tokenHash });
      row = rows[0] ?? null;
    } catch {
      // Table doesn't exist — no tokens can be valid.
      throw new UnauthorizedError('Reset token is invalid or has expired.');
    }

    if (!row) {
      // No row matches this hash — the token is wrong. Use the same error
      // message as the expired/used case so the caller can't distinguish
      // "token doesn't exist" from "token was valid but expired".
      throw new UnauthorizedError('Reset token is invalid or has expired.');
    }

    // Check expiry + single-use. Both checks use the row we just read —
    // the atomic single-use guard is the conditional UPDATE below.
    const now = new Date();
    if (row.usedAt !== null) {
      throw new UnauthorizedError('Reset token has already been used.');
    }
    if (row.expiresAt.getTime() < now.getTime()) {
      throw new UnauthorizedError('Reset token has expired.');
    }

    // Hash the new password (PBKDF2-SHA256, 600k iterations — see
    // JwtAuthAdapter.hashPassword).
    const passwordHash = await container.auth.hashPassword(body.newPassword);

    // Atomically mark the token as used. The `usedAt: null` condition in
    // the filter is the single-use guard — if a concurrent request won
    // the race, this UPDATE returns count=0 and we fail.
    let markedUsed = false;
    try {
      const result = await (container.db as any).update(
        'PasswordResetToken',
        { id: row.id, usedAt: null },
        { usedAt: now },
      );
      markedUsed = Array.isArray(result) && result.length > 0;
    } catch {
      markedUsed = false;
    }
    if (!markedUsed) {
      // A concurrent request already used this token.
      throw new UnauthorizedError('Reset token has already been used.');
    }

    // Update the user's password.
    await repos.users.update(row.userId, { passwordHash });

    // Audit log (best-effort).
    void repos.audit
      .log({
        userId: row.userId,
        action: 'auth.password.reset',
        entityType: 'user',
        entityId: row.userId,
        ip: req.headers.get('x-forwarded-for') ?? null,
      })
      .catch(() => {});

    return ok({ reset: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
