import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

/** Reset token TTL: 15 minutes. Long enough for the email to arrive + the
 * user to click the link, short enough that a leaked-then-recovered inbox
 * doesn't leave a long-lived reset window open. */
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Generate a 32-byte URL-safe random reset token. base64url has no URL-
 * unsafe characters (`+`, `/`, `=`), so the token survives being placed in
 * a query string without percent-encoding. 32 bytes → ~43 chars → ~257 bits
 * of entropy, far beyond any realistic brute-force threshold (the SHA-256
 * hash lookup is also O(1) via the UNIQUE index). */
function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hash of the reset token. We store ONLY the hash — the plaintext
 * is sent to the user via email and never persisted. Hashing (vs. encrypting)
 * is correct here because the token is single-use and short-lived: there's
 * no need to recover the plaintext, and a hash means a DB read can't leak a
 * usable token. */
function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * POST /api/v1/auth/forgot-password — request a password reset link.
 *
 * H16 fix: there was previously NO password-reset flow at all. This endpoint
 * initiates it: generates a single-use token, stores its SHA-256 hash with a
 * 15-min expiry, and emails the user a link.
 *
 * Anti-enumeration: the endpoint ALWAYS returns 200 success, regardless of
 * whether the email matches a real account. Returning 404 would leak that
 * the email isn't registered (an attacker could enumerate accounts by
 * submitting emails and observing the status). The email is only sent if
 * the user exists — but the response is identical either way.
 *
 * Rate-limited: 5 requests / 15min per IP. Caps abuse of the endpoint as a
 * spam vector (an attacker could otherwise send a flood of reset emails to
 * arbitrary addresses via the real email adapter when it's wired up).
 *
 * Token rotation: any existing UNUSED reset tokens for this user are marked
 * used ( invalidated) before issuing a new one — prevents token-stockpiling
 * where an attacker with read access to the user's inbox could collect
 * multiple valid tokens and use them after a successful reset.
 *
 * Email delivery: the StubEmailAdapter in dev captures to memory (check the
 * container logs). In production, swap to ResendEmailAdapter / Postmark —
 * the `container.email.send()` call is the single integration point.
 *
 * Request:  { "email": "user@example.com" }
 * Response: { "success": true, "data": { "sent": true } }
 *           (always — see anti-enumeration note above)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limit: 5 requests / 15min per IP. Generous for a forgetful user
    // but caps spam-abuse. The rate limit applies BEFORE body parsing so a
    // flood of malformed requests is also capped.
    await rateLimit(getContainer().cache, rateKey(req, 'forgot-password'), 5, 15 * 60);

    const body = ForgotPasswordSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      // Malformed body — return the same success envelope as the happy path
      // so the response is indistinguishable from a real request. (We don't
      // want to leak that the email was invalid vs. the user wasn't found.)
      return ok({ sent: true });
    }

    const container = getContainer();
    const email = body.data.email.toLowerCase();
    const user = await repos.users.findByEmail(email);

    if (!user) {
      // Anti-enumeration: return the same success envelope. No email is
      // sent, no DB row is created, but the response is identical to the
      // happy path. The rate limit is still consumed (intentionally —
      // otherwise an attacker could enumerate by timing the rate-limit
      // reset).
      return ok({ sent: true });
    }

    // Invalidate any existing UNUSED reset tokens for this user before
    // issuing a new one. Prevents token stockpiling — see header comment.
    try {
      const existing = await (container.db as any).findMany('PasswordResetToken', {
        userId: user.id,
        usedAt: null,
      });
      const now = new Date();
      await Promise.all(
        existing.map((row: { id: string }) =>
          (container.db as any).update('PasswordResetToken', { id: row.id }, { usedAt: now }),
        ),
      );
    } catch {
      // Table doesn't exist yet (pre-migration) or DB error — proceed with
      // the new-token insertion below; the UNIQUE constraint on tokenHash
      // is the durable guard.
    }

    // Generate + persist the new token.
    const plaintextToken = generateResetToken();
    const tokenHash = hashToken(plaintextToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    try {
      await (container.db as any).insert('PasswordResetToken', {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      });
    } catch {
      // If the table doesn't exist (pre-migration dev env) OR a hash
      // collision somehow occurred, the reset flow can't proceed. Return
      // success anyway (anti-enumeration) — the user will see "if your
      // email exists, a reset link has been sent" and not know the DB
      // write failed.
      return ok({ sent: true });
    }

    // Email the reset link. Best-effort — if the email adapter fails, we
    // still return success (anti-enumeration) but the token remains valid
    // in the DB (the user can't use it because they never received it, and
    // it expires in 15min anyway).
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/shop/reset-password?token=${plaintextToken}`;
    try {
      await container.email.send({
        to: user.email,
        from: process.env.EMAIL_FROM ?? 'no-reply@printshop.app',
        subject: 'Reset your PrintShop password',
        text: [
          `Hello,`,
          ``,
          `We received a request to reset the password for your PrintShop account.`,
          ``,
          `Click the link below to choose a new password. The link expires in 15 minutes.`,
          ``,
          resetUrl,
          ``,
          `If you didn't request this reset, you can safely ignore this email — your password won't change.`,
          ``,
          `— PrintShop`,
        ].join('\n'),
        html: [
          `<p>Hello,</p>`,
          `<p>We received a request to reset the password for your PrintShop account.</p>`,
          `<p>Click the link below to choose a new password. The link expires in 15 minutes.</p>`,
          `<p><a href="${resetUrl}">Reset my password</a></p>`,
          `<p style="color:#666;font-size:12px;">If you didn't request this reset, you can safely ignore this email — your password won't change.</p>`,
          `<p>— PrintShop</p>`,
        ].join('\n'),
      });
    } catch {
      // Email send failure — best-effort. Don't leak to the caller.
    }

    // Audit log (best-effort).
    void repos.audit
      .log({
        shopId: user.shopId ?? null,
        userId: user.id,
        action: 'auth.password.forgot',
        entityType: 'user',
        entityId: user.id,
        ip: req.headers.get('x-forwarded-for') ?? null,
      })
      .catch(() => {});

    return ok({ sent: true });
  } catch (cause) {
    return fail(toAppError(cause));
  }
}
