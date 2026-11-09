import { repos } from '@/lib/repositories';
import { ForbiddenError } from '@platform/core/errors';

/**
 * Entitlements middleware — checks if a shop's subscription is active
 * and the requested feature is available in their plan.
 *
 * Plans:
 *   free      — basic print ordering (always available)
 *   starter   — + analytics + daily reports
 *   pro       — + multiple devices + delivery tracking
 *   enterprise — + white-label + priority support
 *
 * If subscriptionExpiresAt is in the past, the shop is in grace period
 * (7 days) — features still work but a warning is shown.
 *
 * Usage:
 *   await requireEntitlement(principal.shopId, 'analytics');
 *   // throws ForbiddenError if not entitled
 */

export type Feature = 'analytics' | 'reports' | 'multi_device' | 'delivery_tracking' | 'advanced_pricing';

const PLAN_FEATURES: Record<string, Feature[]> = {
  free: [],
  starter: ['analytics', 'reports'],
  pro: ['analytics', 'reports', 'multi_device', 'delivery_tracking'],
  enterprise: ['analytics', 'reports', 'multi_device', 'delivery_tracking', 'advanced_pricing'],
};

const GRACE_PERIOD_DAYS = 7;

/**
 * Check if a shop is entitled to a feature.
 * Returns true if entitled, false otherwise.
 * Does NOT throw — caller decides what to do.
 */
export async function isEntitled(shopId: string, feature: Feature): Promise<boolean> {
  try {
    const shop = await repos.shops.findById(shopId);
    if (!shop) return false;

    // Free features are always available
    if (PLAN_FEATURES.free.includes(feature)) return true;

    // Check plan
    const plan = shop.subscriptionTier ?? 'free';
    const features = PLAN_FEATURES[plan] ?? [];

    if (!features.includes(feature)) return false;

    // Check subscription expiry — grace period of 7 days
    if (shop.subscriptionExpiresAt) {
      const now = new Date();
      const expired = shop.subscriptionExpiresAt < now;
      if (expired) {
        const graceEnd = new Date(shop.subscriptionExpiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        if (now > graceEnd) return false; // grace period expired
        // Within grace period — feature still works
      }
    }

    return true;
  } catch {
    return false; // fail-safe: if we can't check, don't block
  }
}

/**
 * Require a feature — throws ForbiddenError if not entitled.
 * Use in route handlers:
 *   await requireEntitlement(principal.shopId, 'analytics');
 */
export async function requireEntitlement(shopId: string, feature: Feature): Promise<void> {
  const entitled = await isEntitled(shopId, feature);
  if (!entitled) {
    throw new ForbiddenError(
      `This feature requires an upgraded plan. Your current plan does not include "${feature}".`,
    );
  }
}

/**
 * Get the shop's current plan + expiry status.
 */
export async function getSubscriptionStatus(shopId: string): Promise<{
  tier: string;
  isActive: boolean;
  expiresAt: Date | null;
  inGracePeriod: boolean;
  daysUntilExpiry: number | null;
}> {
  try {
    const shop = await repos.shops.findById(shopId);
    if (!shop) {
      return { tier: 'free', isActive: true, expiresAt: null, inGracePeriod: false, daysUntilExpiry: null };
    }

    const now = new Date();
    const expiresAt = shop.subscriptionExpiresAt;
    const tier = shop.subscriptionTier ?? 'free';

    if (!expiresAt) {
      return { tier, isActive: true, expiresAt: null, inGracePeriod: false, daysUntilExpiry: null };
    }

    const expired = expiresAt < now;
    if (!expired) {
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return { tier, isActive: true, expiresAt, inGracePeriod: false, daysUntilExpiry: daysLeft };
    }

    // Expired — check grace period
    const graceEnd = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const inGrace = now <= graceEnd;
    return {
      tier: inGrace ? tier : 'free', // downgrade after grace
      isActive: inGrace,
      expiresAt,
      inGracePeriod: inGrace,
      daysUntilExpiry: -Math.ceil((now.getTime() - expiresAt.getTime()) / (24 * 60 * 60 * 1000)),
    };
  } catch {
    return { tier: 'free', isActive: true, expiresAt: null, inGracePeriod: false, daysUntilExpiry: null };
  }
}
