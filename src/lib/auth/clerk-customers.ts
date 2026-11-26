import type { CustomerAccount } from '@platform/core/domain';
import { repos } from '@/lib/repositories';

/**
 * Clerk → local-customer linking (the consumer dual-auth seam).
 *
 * Mirrors `linkOrCreateClerkUser` for shopkeepers, but touches ONLY the
 * * `CustomerAccount` table — never `User`:
 *
 *   1. A local customer already linked to this Clerk id → return it.
 *   2. Else a local customer with the same email → link the Clerk id
 *      onto it and return it.
 *   3. Else create a new local customer linked to the Clerk id.
 *
 * Safety rules (the reason customers are a separate table):
 * - The same Google account (same email, same Clerk id) may be both a
 *   shopkeeper and a customer. The two identities live in different
 *   tables, so a customer sign-in can never link a Clerk id onto an
 *   owner row, never create an owner account, and never change an
 *   existing owner's role. A shopkeeper who signs in as a customer
 *   simply gets a second, independent customer row.
 * - No password exists for customers: Google sign-in IS the signup.
 * - Email is lowercased before lookup, matching `CustomerAccountRepository`.
 */
export async function linkOrCreateClerkCustomer(
  clerkId: string,
  email: string,
  name: string | null = null,
): Promise<CustomerAccount> {
  const normalizedEmail = email.toLowerCase();

  const byClerkId = await repos.customerAccounts.findByClerkId(clerkId);
  if (byClerkId) return byClerkId;

  const byEmail = await repos.customerAccounts.findByEmail(normalizedEmail);
  if (byEmail) {
    return repos.customerAccounts.update(byEmail.id, { clerkId });
  }

  return repos.customerAccounts.create({
    email: normalizedEmail,
    name,
    clerkId,
  });
}

/** Unlink a Clerk id from its local customer (Clerk `user.deleted`
 * webhook). The local customer row — and its order history — is kept:
 * deleting it would orphan the orders it placed. Only the link is
 * removed, so a later Google sign-in with the same email re-links to
 * the same customer (by email) instead of creating a duplicate. */
export async function unlinkClerkCustomer(clerkId: string): Promise<void> {
  const customer = await repos.customerAccounts.findByClerkId(clerkId);
  if (!customer) return;
  await repos.customerAccounts.update(customer.id, { clerkId: null });
}
