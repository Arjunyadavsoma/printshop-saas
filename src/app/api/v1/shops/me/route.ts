import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ShopPricingConfigSchema } from '@platform/core/domain';
import { UpiIdSchema } from '@platform/utils';

/** Patchable fields on the owner's own shop. */
const PatchShopSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  upiId: UpiIdSchema.optional(),
  pricingConfig: ShopPricingConfigSchema.optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(20).optional(),
});

export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  return ok({
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    upiId: shop.upiId,
    paymentProvider: shop.paymentProvider,
    pricingConfig: shop.pricingConfig,
    address: shop.address,
    phone: shop.phone,
    timezone: shop.timezone,
    isActive: shop.isActive,
    subscriptionTier: shop.subscriptionTier,
    subscriptionExpiresAt: shop.subscriptionExpiresAt,
  });
});

export const PATCH = withAuth(async (req, _ctx, principal) => {
  const body = PatchShopSchema.parse(await req.json());
  const shop = await repos.shops.getByOwner(principal.userId);
  const updated = await repos.shops.update(shop.id, body);
  await repos.audit.log({
    shopId: shop.id,
    userId: principal.userId,
    action: 'shop.update',
    entityType: 'shop',
    entityId: shop.id,
    metadata: { fields: Object.keys(body) },
    ip: req.headers.get('x-forwarded-for') ?? null,
  });
  return ok({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    upiId: updated.upiId,
    pricingConfig: updated.pricingConfig,
  });
});
