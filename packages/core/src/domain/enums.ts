/**
 * Centralised enumerations for the PrintShop SaaS domain.
 *
 * These are declared as string-literal unions (and const arrays for runtime
 * iteration) so they are tree-shakeable, serialisable over the wire, and
 * safely exhaustively-switched in TypeScript.
 */

/**
 * Roles a user account may hold.
 *
 * `'customer'` is the global consumer role (a Customer Account). The
 * other three are shop-side / platform-side. A customer is NOT
 * shop-scoped — their `shopId` is always null on the User row, and
 * their orders are linked by `Order.customerAccountId` (a nullable
 * FK added in Phase 4) so a customer can have orders across multiple
 * shops under one login.
 */
export type UserRole = 'owner' | 'staff' | 'admin' | 'customer';
export const USER_ROLES: readonly UserRole[] = ['owner', 'staff', 'admin', 'customer'] as const;

/**
 * Fine-grained permissions a platform administrator may hold.
 *
 * The `admin` role grants access to the admin surface; `AdminPermission`
 * gates *which* admin actions a given admin can perform. A super-admin
 * is denoted by the synthetic wildcard `'*'` (matches every permission).
 *
 * Non-admin roles (`owner`, `staff`) never receive permissions — their
 * access is tenant-scoped to their own shop and enforced by `withAuth`
 * plus the entitlement service.
 */
export type AdminPermission =
  | '*'                       // super-admin — every permission
  | 'shops.approve'           // approve / reject shop applications
  | 'shops.suspend'           // suspend / restore a shop
  | 'subscription.manage'     // assign plan, grant / extend free period
  | 'payments.refund'         // issue refunds, reverse payments
  | 'users.manage'            // create / suspend / delete user accounts
  | 'config.manage'           // change platform configuration
  | 'audit.read'              // read the audit log
  | 'finance.read';           // read financial reports + reconciliation

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  '*',
  'shops.approve',
  'shops.suspend',
  'subscription.manage',
  'payments.refund',
  'users.manage',
  'config.manage',
  'audit.read',
  'finance.read',
] as const;

/** Subscription tier a shop can be on. */
export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';
export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  'free',
  'starter',
  'pro',
  'enterprise',
] as const;

/**
 * Lifecycle of a shop subscription / entitlement, from approval to expiry.
 *
 * The lifecycle is **server-authoritative**: every state transition is
 * driven by either an admin action (`admin_approved`, `granted_free`,
 * `suspended`, `restored`) or an automated cron (`expired`,
 * `grace_period`, `renewed`, `cancelled`). The shopkeeper cannot move
 * the state directly — they can only retry a payment, which (on
 * success) drives the state to `active` via the payment webhook.
 *
 * `EntitlementAccess` is derived from `SubscriptionStatus` +
 * `currentPeriodEnd` (see `EntitlementService.deriveAccess`):
 *   - admin_approved, granted_free, active, renewed, grace_period,
 *     payment_pending → `active` (shop may operate)
 *   - trial → `active` (during the trial window)
 *   - expired, suspended, cancelled → `inactive` (shop is locked out of
 *     order-creating / file-uploading routes, but may still access its
 *     own billing + data-export pages to recover access)
 */
export type SubscriptionStatus =
  | 'admin_approved'      // admin approved the application; no plan yet
  | 'granted_free'        // admin granted a free period (free-tier access)
  | 'trial'               // time-boxed trial of a paid tier
  | 'active'              // paid + within the current period
  | 'payment_pending'    // period ended, payment in flight (still active)
  | 'grace_period'        // period ended, payment failed, short grace
  | 'expired'             // period ended, no renewal
  | 'suspended'           // admin suspended the shop
  | 'cancelled'           // shopkeeper or admin cancelled the subscription
  | 'renewed';            // a new period was started (transient → active)

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'admin_approved',
  'granted_free',
  'trial',
  'active',
  'payment_pending',
  'grace_period',
  'expired',
  'suspended',
  'cancelled',
  'renewed',
] as const;

/**
 * The high-level access decision the entitlement service returns.
 * `inactive` shops are locked out of order-creating / file-uploading
 * routes, but NEVER out of their own billing + data-export pages.
 */
export type EntitlementAccess = 'active' | 'inactive';

/**
 * Grace period (days) before a shop with a failed payment is moved from
 * `payment_pending` to `expired`. Configurable per deployment via env
 * var `SUBSCRIPTION_GRACE_DAYS`; the default matches the existing
 * product policy of 7 days.
 */
export const DEFAULT_GRACE_DAYS = 7;

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

/** Print job lifecycle (agent-facing). */
export type PrintJobStatus = 'queued' | 'assigned' | 'printing' | 'completed' | 'failed' | 'needs_review';
export const PRINT_JOB_STATUSES: readonly PrintJobStatus[] = [
  'queued',
  'assigned',
  'printing',
  'completed',
  'failed',
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
