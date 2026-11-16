import { z } from 'zod';
import {
  SUBSCRIPTION_TIERS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionTier,
  type SubscriptionStatus,
  type EntitlementAccess,
} from './enums';

/**
 * A subscription record for a shop — the authoritative source of
 * entitlement state. The Shop model carries the *denormalised* tier +
 * expiry (for fast UI rendering); the Subscription table carries the
 * full lifecycle (status, current period, provider reference, history).
 *
 * One row per shop (unique on shopId). Updates are append-only in
 * principle: every transition is logged in the audit log; the row is
 * updated in place because the lifecycle is small and the latest state
 * is what the entitlement service reads.
 */
export interface Subscription {
  id: string;
  shopId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  provider: 'internal' | 'phonepe' | 'paytm' | 'razorpay';
  providerSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  tier: z.enum(SUBSCRIPTION_TIERS as [SubscriptionTier, ...SubscriptionTier[]]),
  status: z.enum(SUBSCRIPTION_STATUSES as [SubscriptionStatus, ...SubscriptionStatus[]]),
  currentPeriodStart: z.date(),
  currentPeriodEnd: z.date(),
  provider: z.enum(['internal', 'phonepe', 'paytm', 'razorpay']),
  providerSubscriptionId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * The decision returned by `EntitlementService.check`. Routes use this to
 * decide whether to serve a request or return a 402/403.
 *
 * - `access: 'active'` — shop may operate normally.
 * - `access: 'inactive'` — shop is locked out of order-creating /
 *   file-uploading routes, but may still access its own billing +
 *   data-export pages.
 *
 * `reason` is included so the API can return a meaningful error code and
 * the UI can show the shopkeeper exactly why they are locked out.
 */
export interface EntitlementDecision {
  access: EntitlementAccess;
  status: SubscriptionStatus;
  tier: SubscriptionTier;
  currentPeriodEnd: Date;
  /** Free-form machine-readable reason code for an `inactive` decision. */
  reason: 'ok' | 'expired' | 'suspended' | 'cancelled' | 'inactive_shop' | 'no_subscription';
}

export const EntitlementDecisionSchema = z.object({
  access: z.enum(['active', 'inactive']),
  status: z.enum(SUBSCRIPTION_STATUSES as [SubscriptionStatus, ...SubscriptionStatus[]]),
  tier: z.enum(SUBSCRIPTION_TIERS as [SubscriptionTier, ...SubscriptionTier[]]),
  currentPeriodEnd: z.date(),
  reason: z.enum(['ok', 'expired', 'suspended', 'cancelled', 'inactive_shop', 'no_subscription']),
});
