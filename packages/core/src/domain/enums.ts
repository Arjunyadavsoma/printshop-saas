/**
 * Centralised enumerations for the PrintShop SaaS domain.
 *
 * These are declared as string-literal unions (and const arrays for runtime
 * iteration) so they are tree-shakeable, serialisable over the wire, and
 * safely exhaustively-switched in TypeScript.
 */

/** Roles a user account may hold. */
export type UserRole = 'owner' | 'staff' | 'admin';
export const USER_ROLES: readonly UserRole[] = ['owner', 'staff', 'admin'] as const;

/** Subscription tier a shop can be on. */
export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';
export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  'free',
  'starter',
  'pro',
  'enterprise',
] as const;

/** Payment providers supported by the PaymentAdapter abstraction. */
export type PaymentProvider = 'phonepe' | 'paytm' | 'googlepay' | 'razorpay' | 'cashfree';
export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = [
  'phonepe',
  'paytm',
  'googlepay',
  'razorpay',
  'cashfree',
] as const;

/** Lifecycle of an order, from draft to collected. */
export type OrderStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'printing'
  | 'ready'
  | 'collected'
  | 'cancelled'
  | 'refunded';
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'awaiting_payment',
  'paid',
  'printing',
  'ready',
  'collected',
  'cancelled',
  'refunded',
] as const;

/** Per-file print lifecycle. */
export type FileStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'needs_review';
export const FILE_STATUSES: readonly FileStatus[] = [
  'pending',
  'queued',
  'printing',
  'completed',
  'failed',
  'needs_review',
] as const;

/** Print job lifecycle (agent-facing). */
export type PrintJobStatus = 'queued' | 'assigned' | 'printing' | 'completed' | 'failed';
export const PRINT_JOB_STATUSES: readonly PrintJobStatus[] = [
  'queued',
  'assigned',
  'printing',
  'completed',
  'failed',
] as const;

/** Colour mode for a print job. */
export type ColorMode = 'bw' | 'color';

/** Supported paper sizes. */
export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal';
export const PAPER_SIZES: readonly PaperSize[] = ['a4', 'a3', 'letter', 'legal'] as const;

/**
 * Type guard utility — narrows an unknown string to a given union.
 * @param value - the raw value to test
 * @param allowed - the readonly tuple of valid literals
 * @returns true if `value` is one of `allowed`
 */
export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
