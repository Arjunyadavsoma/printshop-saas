/**
 * Centralised enumerations for the PrintShop SaaS domain.
 *
 * These are declared as string-literal unions (and const arrays for runtime
 * iteration) so they are tree-shakeable, serialisable over the wire, and
 * safely exhaustively-switched in TypeScript.
 */

/** Roles a user account may hold. */
export type UserRole = 'owner' | 'operator' | 'staff' | 'admin';
export const USER_ROLES: readonly UserRole[] = ['owner', 'operator', 'staff', 'admin'] as const;

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
  // legacy lifecycle
  | 'pending'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'needs_review'
  // product-build upload pipeline (docs/ARCHITECTURE.md §5.1)
  | 'uploaded'
  | 'converting'
  | 'ready';
export const FILE_STATUSES: readonly FileStatus[] = [
  'pending',
  'queued',
  'printing',
  'completed',
  'failed',
  'needs_review',
  'uploaded',
  'converting',
  'ready',
] as const;

/**
 * The origin and trust level of a file's `pageCount`.
 *
 * - `auto_extracted`     — the parser confidently extracted the count (PDF,
 *                          DOCX, PPTX, XLSX, images). Safe to bill.
 * - `customer_declared`  — the customer entered the count manually (e.g. for
 *                          a legacy .doc the parser couldn't read). Billable
 *                          but the shopkeeper can correct it.
 * - `shopkeeper_confirmed` — the shopkeeper verified or set the count.
 *                          Highest trust. Billable.
 * - `placeholder`        — no trustworthy count is available. The file is in
 *                          `needs_review` status and CANNOT be priced or
 *                          checked out until a count is supplied.
 */
export type PageCountSource =
  | 'auto_extracted'
  | 'customer_declared'
  | 'shopkeeper_confirmed'
  | 'placeholder';
export const PAGE_COUNT_SOURCES: readonly PageCountSource[] = [
  'auto_extracted',
  'customer_declared',
  'shopkeeper_confirmed',
  'placeholder',
] as const;

/** Print job lifecycle (agent-facing).
 *  Product build (Phase 1): extends the legacy lifecycle with the task-level
 *  states the brief's dispatcher needs. 'completed' (legacy) and 'printed'
 *  (new) both mean physical print confirmed by the spooler; 'uncertain'
 *  means the spooler never confirmed — NEVER auto-retried. */
export type PrintJobStatus =
  | 'queued'
  | 'assigned'
  | 'dispatched'
  | 'received'
  | 'printing'
  | 'spooled'
  | 'completed'
  | 'printed'
  | 'uncertain'
  | 'failed'
  | 'cancelled'
  | 'needs_review';
export const PRINT_JOB_STATUSES: readonly PrintJobStatus[] = [
  'queued',
  'assigned',
  'dispatched',
  'received',
  'printing',
  'spooled',
  'completed',
  'printed',
  'uncertain',
  'failed',
  'cancelled',
  'needs_review',
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
