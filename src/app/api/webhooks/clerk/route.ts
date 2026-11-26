import { NextResponse, type NextRequest } from 'next/server';
import { Webhook } from 'svix';
import { getContainer } from '@/lib/container';
import { linkOrCreateClerkUser, unlinkClerkUser } from '@/lib/auth/clerk-users';
import { unlinkClerkCustomer } from '@/lib/auth/clerk-customers';
import { repos } from '@/lib/repositories';

/**
 * POST /api/webhooks/clerk — Clerk user lifecycle webhook.
 *
 * Keeps the local `User` table in sync with Clerk so the Clerk sign-in
 * path and the JWT login path always agree about who someone is:
 *
 *   - `user.created` / `user.updated` → link-or-create the local user by
 *     Clerk id + email (same helper as the session exchange), and sync
 *     the email if the Clerk user changed it. Customer accounts are NOT
 *     created here — they are created lazily at the first customer
 *     sign-in (POST /api/v1/auth/clerk-session/customer), so a
 *     shopkeeper who never uses the consumer side never gains a
 *     customer row. If a customer row already exists for the Clerk id,
 *     its email follows the Clerk account the same way.
 *   - `user.deleted` → unlink the Clerk id only. The local user and
 *     their shop are KEPT — deleting them would orphan the shop's
 *     orders; the password login keeps working if one was ever set.
 *
 * Auth is the Svix signature (`svix-id` / `svix-timestamp` /
 * `svix-signature` headers, verified against `CLERK_WEBHOOK_SECRET`).
 * An unverified or malformed payload is rejected with 400 — Clerk
 * retries delivery, so a transient failure is safe. The route does NOT
 * rate-limit: the signature is the authentication, and Clerk's servers
 * are the only caller.
 *
 * Register this URL in the Clerk dashboard → Webhooks:
 * `https://printelyx.cc.cd/api/webhooks/clerk`
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed: without the secret we cannot verify the sender, so
    // never process the payload. Clerk retries, so this recovers the
    // moment the secret is set in Vercel.
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET is not set — rejecting webhook');
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 });
  }

  const payload = await req.text();
  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(secret);
    // svix v2 `verify` returns undefined on success (it only throws on
    // failure) — it does NOT return the parsed payload, so parse the
    // already-verified body ourselves.
    wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    event = JSON.parse(payload) as { type: string; data: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const data = event.data as {
      id?: string;
      email_addresses?: { id: string; email_address: string }[];
      primary_email_address_id?: string;
    };
    const clerkId = typeof data.id === 'string' ? data.id : '';
    if (!clerkId) return NextResponse.json({ received: true });

    if (event.type === 'user.deleted') {
      await unlinkClerkUser(clerkId);
      // The same Clerk id may also be linked to a customer account (the
      // same Google account can be a shopkeeper AND a customer) — unlink
      // both. Only the links are removed; both local rows are kept.
      await unlinkClerkCustomer(clerkId);
      return NextResponse.json({ received: true });
    }

    if (event.type === 'user.created' || event.type === 'user.updated') {
      const primary = data.email_addresses?.find((e) => e.id === data.primary_email_address_id)
        ?? data.email_addresses?.[0];
      const email = primary?.email_address?.toLowerCase();
      if (!email) return NextResponse.json({ received: true });

      const user = await linkOrCreateClerkUser(clerkId, email, getContainer().auth);
      // If the Clerk user changed their email, the local email follows —
      // email is the login identity for the JWT path too.
      if (user.email !== email) {
        await repos.users.update(user.id, { email });
      }
      // Same for a customer row linked to this Clerk id, if one exists.
      // (Never creates one — customer rows are created lazily at the
      // first customer sign-in.)
      const customer = await repos.customerAccounts.findByClerkId(clerkId);
      if (customer && customer.email !== email) {
        await repos.customerAccounts.update(customer.id, { email });
      }
      return NextResponse.json({ received: true });
    }

    // Other event types (session.*, organization.*, …) are ignored.
    return NextResponse.json({ received: true });
  } catch (cause) {
    console.error('[clerk-webhook] handler failed', cause);
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }
}
