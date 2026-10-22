import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok } from '@/lib/api/envelope';
import { ShopPricingConfigSchema } from '@platform/core/domain';
import { UpiIdSchema, IndianPhoneSchema } from '@platform/utils';

/**
 * GET  /api/v1/shops/me          — owner's own shop (full profile, no creds).
 * PATCH /api/v1/shops/me         — update shop profile fields (additive).
 *
 * Patchable fields include the shopkeeper-facing profile fields:
 *   - name, upiId, pricingConfig, address, phone  (existing)
 *   - description, businessHours, logoUrl, upiQrStorageKey  (settings profile)
 *   - servicesJson, paymentPhone, paymentInstructions, cashOnPickup  (settings payment)
 *
 * The full field set mirrors the Shop domain model so the shopkeeper's
 * settings page can both read (GET) and write (PATCH) every profile field
 * through this single endpoint. `upiQrStorageKey` is also writable here for
 * the (rare) case where the shopkeeper wants to clear it without a DELETE —
 * but the canonical way to set it is POST /api/v1/shops/me/upi-qr.
 */
const PatchShopSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  upiId: UpiIdSchema.optional(),
  pricingConfig: ShopPricingConfigSchema.optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(20).optional(),
  // New shopkeeper-facing profile fields.
  description: z.string().max(2000).nullable().optional(),
  businessHours: z.string().max(4000).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  upiQrStorageKey: z.string().max(500).nullable().optional(),
  servicesJson: z.string().max(2000).nullable().optional(),
  paymentPhone: IndianPhoneSchema.nullable().optional(),
  paymentInstructions: z.string().max(2000).nullable().optional(),
  cashOnPickup: z.boolean().optional(),
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
    // New profile fields.
    description: shop.description,
    businessHours: shop.businessHours,
    logoUrl: shop.logoUrl,
    upiQrStorageKey: shop.upiQrStorageKey,
    servicesJson: shop.servicesJson,
    paymentPhone: shop.paymentPhone,
    paymentInstructions: shop.paymentInstructions,
    cashOnPickup: shop.cashOnPickup,
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
    address: updated.address,
    phone: updated.phone,
    description: updated.description,
    businessHours: updated.businessHours,
    logoUrl: updated.logoUrl,
    upiQrStorageKey: updated.upiQrStorageKey,
    servicesJson: updated.servicesJson,
    paymentPhone: updated.paymentPhone,
    paymentInstructions: updated.paymentInstructions,
    cashOnPickup: updated.cashOnPickup,
  });
});
