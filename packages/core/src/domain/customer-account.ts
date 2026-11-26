import { z } from 'zod';

/**
 * A customer account (consumer side).
 *
 * Separate from `User` on purpose — see the `CustomerAccount` model
 * comment in `prisma/schema.prisma`. The same Google account can be a
 * shopkeeper (`User`, role `owner`) AND a customer at the same time; the
 * two tables are keyed independently by email + Clerk id, so neither
 * flow can ever touch the other's row. Customers have no password and
 * no shop: Google sign-in IS the signup (Clerk SSO creates the row on
 * first sign-in).
 *
 * Named `CustomerAccount` because the schema already has a shop-scoped
 * `Customer` model (the per-shop customer directory) — unrelated to
 * sign-in.
 */
export interface CustomerAccount {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  /** Clerk user id (`user_…`) when the account is linked to Clerk sign-in. */
  clerkId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CustomerAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  phone: z.string().max(20).nullable(),
  clerkId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
