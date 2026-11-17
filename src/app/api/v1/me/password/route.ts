import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withAuth } from '@/lib/api/with-auth';
import { UnauthorizedError } from '@platform/core/errors';

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
}).refine((d) => d.oldPassword !== d.newPassword, {
  message: 'The new password must be different from the current password.',
  path: ['newPassword'],
});

/**
 * POST /api/v1/me/password — change the current user's password (authenticated).
 *
 * H16 fix: the third piece of the password-management story. A logged-in
 * user can change their password WITHOUT going through the email-based
 * forgot-password flow — they verify their OLD password and provide a new
 * one. This is the "Account security" → "Change password" form in the
 * settings page.
 *
 * Old-password verification: the request MUST include the current password.
 * Without it, a compromised session (e.g. an attacker who lifted the access
 * token from localStorage) could silently change the password and lock the
 * real user out. Requiring the old password makes that attack much harder
 * — the attacker also needs the password, which they typically don't have
 * (if they did, they wouldn't need the token).
 *
 * "New ≠ old" check: prevents the no-op change where a user types the same
 * password twice. The refine() runs AFTER the min/max checks, so the user
 * sees "must be at least 8 chars" before "must be different" if both fail.
 *
 * Audit log: writes `auth.password.change` with the userId. Does NOT write
 * the password (obviously) or the IP into the metadata — the IP is in its
 * own column.
 *
 * Session invalidation: like the reset flow, we'd ideally revoke all
 * refresh-token jtis for this user after a password change so other
 * sessions are kicked out. The current adapter doesn't support enumerating
 * jtis by userId — see the TODO in reset-password/route.ts. The user's
 * OTHER sessions will continue to work with the old password until the
 * access token expires (15min) — at which point a refresh attempt still
 * succeeds (the refresh token is independent of the password). This is a
 * known limitation; the mitigation is that the user explicitly changed
 * their password, so they know other sessions may still be live.
 *
 * Request:  { "oldPassword": "...", "newPassword": "new-secret-123" }
 * Response: { "success": true, "data": { "changed": true } }
 *           401 if old password is wrong or token is invalid
 *           400 if new password fails validation
 */
export const POST = withAuth(async (req, _ctx, { user }) => {
  try {
    const body = ChangePasswordSchema.parse(await req.json().catch(() => ({})));
    const container = getContainer();

    // Verify the OLD password. The user repository's verifyCredentials
    // would also work but throws a generic "Invalid email or password" —
    // we want a password-specific message here. Use verifyPassword
    // directly so the error is scoped to "wrong old password".
    const oldPasswordMatches = await container.auth.verifyPassword(
      body.oldPassword,
      user.passwordHash,
    );
    if (!oldPasswordMatches) {
      throw new UnauthorizedError('The current password you entered is incorrect.');
    }

    // Hash the new password + persist.
    const newHash = await container.auth.hashPassword(body.newPassword);
    await repos.users.update(user.id, { passwordHash: newHash });

    // Audit log (best-effort).
    void repos.audit
      .log({
        shopId: user.shopId ?? null,
        userId: user.id,
        action: 'auth.password.change',
        entityType: 'user',
        entityId: user.id,
        ip: req.headers.get('x-forwarded-for') ?? null,
      })
      .catch(() => {});

    return ok({ changed: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
