import { z } from 'zod';

/**
 * A global customer account — the consumer-side identity.
 *
 * Separate from the shop-scoped `Customer` CRM row (which a shopkeeper
 * maintains per-shop). A `CustomerAccount` is created by the consumer
 * when they sign up; their orders (across multiple shops) are linked
 * via `Order.customerAccountId`.
 *
 * Identity correctness:
 * - `email` is the unique key (verified on signup).
 * - `phone` is optional contact info, NOT a unique identity — family
 *   members may share a phone, and customers may change phones.
 *   `phoneVerified` is true only after an OTP round-trip.
 * - `deactivatedAt` is set on soft-delete; the row + order history is
 *   retained for audit. Login is refused while deactivated.
 */
export interface CustomerAccount {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CustomerAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  passwordHash: z.string(),
  name: z.string().min(1).max(120),
  phone: z.string().max(20).nullable(),
  phoneVerified: z.boolean(),
  emailVerified: z.boolean(),
  deactivatedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Public projection returned to the client (no passwordHash). */
export interface CustomerAccountPublic {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
}

export function toPublic(account: CustomerAccount): CustomerAccountPublic {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone,
    phoneVerified: account.phoneVerified,
    emailVerified: account.emailVerified,
    deactivatedAt: account.deactivatedAt,
    createdAt: account.createdAt,
  };
}
