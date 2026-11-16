import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAdminPermission } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { grantFreePeriod } from '@/lib/services/entitlement.service';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { SUBSCRIPTION_TIERS, type SubscriptionTier } from '@platform/core/domain';

const GrantSchema = z.object({
  days: z.number().int().min(1).max(3650),
  tier: z.enum(SUBSCRIPTION_TIERS as [SubscriptionTier, ...SubscriptionTier[]]).default('free'),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/v1/admin/shops/:id/subscription/grant-free-period
 *
 * Authoritatively grant a free period for a shop. The shop's
 * subscription row is upserted with status=`granted_free` and a new
 * `currentPeriodEnd` (now + days). The shop's denormalised
 * `subscriptionTier` + `subscriptionExpiresAt` fields are NOT touched —
 * the entitlement service always reads from the subscription row.
 *
 * Authorization: requires the `subscription.manage` admin permission.
 * The audit log records the admin's userId, the shop, the duration,
 * and the optional reason.
 */
export const POST = withAdminPermission<{ id: string }>('subscription.manage', async (req, ctx, principal) => {
  try {
    const { id: shopId } = await ctx.params;
    const body = GrantSchema.parse(await req.json());

    const shop = await repos.shops.findById(shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    if (!shop.isActive) {
      throw new ValidationError('Cannot grant a free period to an inactive shop — restore the shop first.');
    }

    const subscription = await grantFreePeriod(shopId, body.days, body.tier);

    await repos.audit.log({
      shopId,
      userId: principal.userId,
      action: 'subscription.grant_free_period',
      entityType: 'subscription',
      entityId: subscription.id,
      metadata: { days: body.days, tier: body.tier, reason: body.reason ?? null, previousStatus: subscription.status },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      subscription: {
        id: subscription.id,
        shopId: subscription.shopId,
        tier: subscription.tier,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        provider: subscription.provider,
      },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});

/**
 * POST /api/v1/admin/shops/:id/subscription/suspend
 *
 * Mark a shop's subscription as `suspended`. The shop row's `isActive`
 * flag is also set to false so the entitlement service's `applyShopActive`
 * rule keeps the shop locked out even if the subscription row is later
 * tampered with. Reversible via the restore route (next phase).
 *
 * Authorization: requires the `shops.suspend` admin permission.
 */
export const PATCH = withAdminPermission<{ id: string }>('shops.suspend', async (req, ctx, principal) => {
  try {
    const { id: shopId } = await ctx.params;
    const body = z.object({ reason: z.string().max(500).optional() }).parse(await req.json());

    const shop = await repos.shops.findById(shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    const subscription = await repos.subscriptions.updateStatus(shopId, 'suspended');

    // Also flip the shop's isActive flag — belt + suspenders so an
    // admin suspension takes effect immediately for every code path,
    // not just the ones that consult the entitlement service.
    await repos.shops.update(shopId, { isActive: false });

    await repos.audit.log({
      shopId,
      userId: principal.userId,
      action: 'subscription.suspend',
      entityType: 'subscription',
      entityId: subscription?.id ?? shopId,
      metadata: { reason: body.reason ?? null },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({ ok: true, shopId, subscriptionStatus: 'suspended' });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
