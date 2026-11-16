import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionTier,
  EntitlementDecision,
  EntitlementAccess,
} from '@platform/core/domain';
import { DEFAULT_GRACE_DAYS } from '@platform/core/domain';

/**
 * Pure functions that derive an entitlement decision from the
 * subscription + shop state. The service is split into pure helpers
 * (testable without DB) and a thin `EntitlementService` class that
 * loads the rows.
 *
 * The decision is **server-authoritative**: the shopkeeper cannot
 * move the state directly. A subscription is `active` if and only if
 * the server-side state permits it.
 */

/**
 * Map a (status, now, periodEnd, graceDays) tuple to an access decision.
 *
 * The rules:
 * - `admin_approved`, `granted_free`, `active`, `renewed`, `trial`,
 *   `payment_pending` → `active` while `now < periodEnd`. If `periodEnd`
 *   has passed, `payment_pending` stays active during the grace window;
 *   everything else goes `inactive` (reason `expired`).
 * - `grace_period` → `active` for `graceDays` after `periodEnd`.
 * - `expired`, `cancelled` → `inactive` (reason `expired` / `cancelled`).
 * - `suspended` → `inactive` (reason `suspended`).
 *
 * `inactive_shop` is reserved for when the shop row itself has
 * `isActive = false` — the service applies it on top of the
 * subscription decision.
 */
export function deriveAccess(
  status: SubscriptionStatus,
  now: Date,
  periodEnd: Date,
  graceDays: number = DEFAULT_GRACE_DAYS,
): EntitlementDecision {
  const ms = now.getTime();
  const endMs = periodEnd.getTime();
  const graceMs = graceDays * 24 * 60 * 60 * 1000;

  switch (status) {
    case 'admin_approved':
    case 'granted_free':
    case 'active':
    case 'renewed':
    case 'trial':
    case 'payment_pending':
      if (ms < endMs) {
        return { access: 'active', status, currentPeriodEnd: periodEnd, reason: 'ok', tier: 'free' };
      }
      // Period ended. payment_pending gets the grace window; the rest expire.
      if (status === 'payment_pending' && ms < endMs + graceMs) {
        return { access: 'active', status: 'grace_period', currentPeriodEnd: periodEnd, reason: 'ok', tier: 'free' };
      }
      return { access: 'inactive', status: 'expired', currentPeriodEnd: periodEnd, reason: 'expired', tier: 'free' };

    case 'grace_period':
      if (ms < endMs + graceMs) {
        return { access: 'active', status, currentPeriodEnd: periodEnd, reason: 'ok', tier: 'free' };
      }
      return { access: 'inactive', status: 'expired', currentPeriodEnd: periodEnd, reason: 'expired', tier: 'free' };

    case 'expired':
      return { access: 'inactive', status, currentPeriodEnd: periodEnd, reason: 'expired', tier: 'free' };

    case 'cancelled':
      return { access: 'inactive', status, currentPeriodEnd: periodEnd, reason: 'cancelled', tier: 'free' };

    case 'suspended':
      return { access: 'inactive', status, currentPeriodEnd: periodEnd, reason: 'suspended', tier: 'free' };

    default:
      // Exhaustiveness guard — never reached if the union is complete.
      return { access: 'inactive', status, currentPeriodEnd: periodEnd, reason: 'expired', tier: 'free' };
  }
}

/**
 * Apply a shop's `isActive` flag on top of a subscription decision. A
 * shop that an admin has marked inactive is always `inactive` regardless
 * of subscription state — this lets an admin instantly suspend a shop
 * without touching the subscription lifecycle.
 */
export function applyShopActive(
  decision: EntitlementDecision,
  isActive: boolean,
): EntitlementDecision {
  if (!isActive) {
    return { ...decision, access: 'inactive', reason: 'inactive_shop' };
  }
  return decision;
}

export interface EntitlementService {
  /**
   * Resolve the current entitlement decision for a shop. Reads the
   * subscription row + the shop row, then derives access.
   *
   * `tier` in the returned decision reflects the subscription row's
   * tier (the authoritative value), not the denormalised
   * `Shop.subscriptionTier`.
   */
  check(shopId: string): Promise<EntitlementDecision>;

  /**
   * Convenience: returns true when the shop is `active` AND the shop
   * row is `isActive`. Routes that gate on entitlement can use this
   * for a simple boolean, OR call `check` to surface the reason code.
   */
  isActive(shopId: string): Promise<boolean>;
}

/**
 * Default implementation. Uses the `repos` singleton (resolved lazily
 * from the container) so tests can swap the adapter.
 */
export class DefaultEntitlementService implements EntitlementService {
  constructor(private readonly graceDays: number = DEFAULT_GRACE_DAYS) {}

  async check(shopId: string): Promise<EntitlementDecision> {
    const { repos } = await import('@/lib/repositories');

    const shop = await repos.shops.findById(shopId);
    if (!shop) {
      return {
        access: 'inactive',
        status: 'expired',
        tier: 'free',
        currentPeriodEnd: new Date(0),
        reason: 'no_subscription',
      };
    }

    const sub = await repos.subscriptions.findByShop(shopId);
    if (!sub) {
      // No subscription row: fall back to the Shop's denormalised fields.
      // If `subscriptionExpiresAt` is null or in the future and the shop is
      // active, the shop may operate (legacy compatibility — early shops
      // were created before the Subscription table existed). If it's in
      // the past, the shop is expired.
      const now = new Date();
      const periodEnd = shop.subscriptionExpiresAt ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const fallbackStatus: SubscriptionStatus =
        shop.subscriptionExpiresAt && shop.subscriptionExpiresAt < now
          ? 'expired'
          : 'granted_free';
      const decision = deriveAccess(fallbackStatus, now, periodEnd, this.graceDays);
      return applyShopActive({ ...decision, tier: shop.subscriptionTier }, shop.isActive);
    }

    const decision = deriveAccess(sub.status, new Date(), sub.currentPeriodEnd, this.graceDays);
    return applyShopActive({ ...decision, tier: sub.tier }, shop.isActive);
  }

  async isActive(shopId: string): Promise<boolean> {
    const decision = await this.check(shopId);
    return decision.access === 'active';
  }
}

/**
 * Grant a free period for a shop. Used by the admin route. Caller is
 * responsible for the audit-log entry. Returns the new subscription
 * record.
 *
 * `days` MUST be a positive integer. The service enforces it.
 */
export async function grantFreePeriod(
  shopId: string,
  days: number,
  tier: SubscriptionTier = 'free',
): Promise<Subscription> {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('grantFreePeriod: days must be a positive integer');
  }
  const { repos } = await import('@/lib/repositories');
  const now = new Date();
  const newPeriodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return repos.subscriptions.upsert({
    shopId,
    tier,
    status: 'granted_free',
    currentPeriodStart: now,
    currentPeriodEnd: newPeriodEnd,
    provider: 'internal',
  });
}
