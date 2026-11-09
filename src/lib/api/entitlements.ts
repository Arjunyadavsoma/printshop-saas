import { repos } from '@/lib/repositories';
import { ForbiddenError } from '@platform/core/errors';
import { getContainer } from '@/lib/container';

/**
 * Entitlements middleware — checks if a shop's subscription is active
 * and the requested feature is available in their plan.
 *
 * BEHAVIOR: FAIL-CLOSED. If the subscription status cannot be verified
 * (DB error, missing shop, etc.), access is DENIED for non-free features.
 * Free features are always allowed.
 *
 * Subscription states:
 *   active     — subscription is current, all plan features available
 *   grace      — subscription expired but within 7-day grace period, features still work
 *   expired    — grace period elapsed, downgraded to free
 *   suspended  — manually suspended by admin, all non-free features blocked
 *   canceled   — subscription canceled, downgraded to free
 *
 * Plans:
 *   free       — basic print ordering (always available, no subscription needed)
 *   starter    — + analytics + daily reports
 *   pro        — + multiple devices + delivery tracking
 *   enterprise — + advanced pricing + priority support
 */

export type Feature = 'analytics' | 'reports' | 'multi_device' | 'delivery_tracking' | 'advanced_pricing';

export type SubscriptionState = 'active' | 'grace' | 'expired' | 'suspended' | 'canceled';

const PLAN_FEATURES: Record<string, Feature[]> = {
  free: [],
  starter: ['analytics', 'reports'],
  pro: ['analytics', 'reports', 'multi_device', 'delivery_tracking'],
  enterprise: ['analytics', 'reports', 'multi_device', 'delivery_tracking', 'advanced_pricing'],
};

const GRACE_PERIOD_DAYS = 7;

/**
 * Determine the subscription state from the shop's tier + expiry.
 */
function resolveState(tier: string, expiresAt: Date | null): SubscriptionState {
  // Free tier is always active
  if (tier === 'free') return 'active';

  // No expiry = active (manually set or lifetime)
  if (!expiresAt) return 'active';

  const now = new Date();
  if (expiresAt > now) return 'active';

  // Expired — check grace period
  const graceEnd = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  if (now <= graceEnd) return 'grace';

  return 'expired';
}

/**
 * Check if a shop is entitled to a feature.
 * FAIL-CLOSED: returns false on error for non-free features.
 */
export async function isEntitled(shopId: string, feature: Feature): Promise<boolean> {
  try {
    const shop = await repos.shops.findById(shopId);
    if (!shop) return false; // fail-closed: unknown shop

    const tier = shop.subscriptionTier ?? 'free';
    const state = resolveState(tier, shop.subscriptionExpiresAt);

    // Expired → downgraded to free
    const effectiveTier = state === 'expired' || state === 'canceled' || state === 'suspended' ? 'free' : tier;
    const features = PLAN_FEATURES[effectiveTier] ?? [];

    return features.includes(feature);
  } catch {
    // FAIL-CLOSED: if we can't verify, deny non-free features
    return false;
  }
}

/**
 * Require a feature — throws ForbiddenError if not entitled.
 * FAIL-CLOSED: throws on error.
 */
export async function requireEntitlement(shopId: string, feature: Feature): Promise<void> {
  const entitled = await isEntitled(shopId, feature);
  if (!entitled) {
    // Audit log the denial
    try {
      const container = getContainer();
      await container.db.insert('AuditLog', {
        id: crypto.randomUUID(),
        shopId,
        userId: null,
        action: 'entitlement.denied',
        entityType: 'subscription',
        entityId: shopId,
        metadata: JSON.stringify({ feature, timestamp: new Date().toISOString() }),
        ip: null,
        createdAt: new Date(),
      });
    } catch {
      // audit log failure is non-fatal
    }

    throw new ForbiddenError(
      `This feature (${feature}) requires an upgraded subscription plan.`,
    );
  }
}

/**
 * Get the shop's current subscription status.
 */
export async function getSubscriptionStatus(shopId: string): Promise<{
  tier: string;
  effectiveTier: string;
  state: SubscriptionState;
  isActive: boolean;
  expiresAt: Date | null;
  inGracePeriod: boolean;
  daysUntilExpiry: number | null;
  features: Feature[];
}> {
  try {
    const shop = await repos.shops.findById(shopId);
    if (!shop) {
      return {
        tier: 'free', effectiveTier: 'free', state: 'active',
        isActive: true, expiresAt: null, inGracePeriod: false,
        daysUntilExpiry: null, features: PLAN_FEATURES.free,
      };
    }

    const tier = shop.subscriptionTier ?? 'free';
    const expiresAt = shop.subscriptionExpiresAt;
    const state = resolveState(tier, expiresAt);
    const effectiveTier = state === 'expired' || state === 'canceled' || state === 'suspended' ? 'free' : tier;

    const now = new Date();
    let daysUntilExpiry: number | null = null;
    if (expiresAt) {
      daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    }

    return {
      tier,
      effectiveTier,
      state,
      isActive: state === 'active' || state === 'grace',
      expiresAt,
      inGracePeriod: state === 'grace',
      daysUntilExpiry,
      features: PLAN_FEATURES[effectiveTier] ?? [],
    };
  } catch {
    // FAIL-CLOSED: on error, return free tier (no paid features)
    return {
      tier: 'free', effectiveTier: 'free', state: 'expired',
      isActive: false, expiresAt: null, inGracePeriod: false,
      daysUntilExpiry: null, features: [],
    };
  }
}
