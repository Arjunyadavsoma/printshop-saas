import { randomBytes } from 'node:crypto';
import type { User } from '@platform/core/domain';
import type { AuthAdapter } from '@platform/core/interfaces';
import { repos } from '@/lib/repositories';

/**
 * Clerk → local-user linking (the dual-auth migration seam).
 *
 * Clerk proves identity; the app's own JWT (issued by `AuthAdapter`) is
 * still the session token for every API route (`withAuth`). This helper is
 * the single place that maps a verified Clerk identity to a local user:
 *
 *   1. A local user already linked to this Clerk id → return it.
 *   2. Else a local user with the same email → link the Clerk id onto it
 *      (existing shopkeepers keep their account, shop, and role) and
 *      return it.
 *   3. Else create a new local user (role `owner`, no shop yet) linked to
 *      the Clerk id.
 *
 * Safety rules:
 * - The role is NEVER taken from Clerk. A newly created user is always
 *   `owner`; an existing user's role is never changed here — an admin
 *   stays an admin, and a Clerk account can never escalate itself.
 * - The created user gets a random, unusable password (same pattern as
 *   the env-var admin in the login route): password login for that row
 *   is effectively disabled until the owner sets one via reset.
 * - Email is lowercased before lookup, matching `UserRepository`.
 */
export async function linkOrCreateClerkUser(
  clerkId: string,
  email: string,
  auth: AuthAdapter,
): Promise<User> {
  const normalizedEmail = email.toLowerCase();

  const byClerkId = await repos.users.findByClerkId(clerkId);
  if (byClerkId) return byClerkId;

  const byEmail = await repos.users.findByEmail(normalizedEmail);
  if (byEmail) {
    return repos.users.update(byEmail.id, { clerkId });
  }

  return repos.users.create(
    {
      email: normalizedEmail,
      phone: '',
      password: randomUnusedPassword(),
      role: 'owner',
      shopId: null,
      clerkId,
    },
    auth,
  );
}

/** A long random password that is NEVER used for login — it only fills the
 * required `passwordHash` column for Clerk-created users. */
export function randomUnusedPassword(): string {
  return randomBytes(32).toString('base64url');
}

/** Unlink a Clerk id from its local user (Clerk `user.deleted` webhook).
 * The local user — and their shop — are kept: deleting the local account
 * would orphan the shop's orders. Only the link is removed, so the
 * password login (if one was ever set) keeps working. */
export async function unlinkClerkUser(clerkId: string): Promise<void> {
  const user = await repos.users.findByClerkId(clerkId);
  if (!user) return;
  await repos.users.update(user.id, { clerkId: null });
}
