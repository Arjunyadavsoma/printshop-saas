import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { ShopPricingConfigSchema } from '@platform/core/domain';
import { UpiIdSchema, IndianPhoneSchema } from '@platform/utils';
import { AppError, ValidationError } from '@platform/core/errors';

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
  // Payment method customization
  paymentMethods: z.enum(['upi', 'cash', 'both', 'split']).optional(),
  // Pamphlet / cover sheet feature
  pamphletEnabled: z.boolean().optional(),
  pamphletPricePaise: z.number().int().min(0).max(100000).optional(),
  pamphletName: z.string().max(100).nullable().optional(),
  // ── Shop location ──
  // Full display address (separate from the legacy `address` field),
  // city / state / PIN, and WGS-84 coordinates. All optional; empty
  // strings are normalised to null so a shopkeeper can clear a field.
  // locationVerified is owner-asserted but the server never lets it be
  // true without coordinates (see the coercion below) — hand-typed
  // coordinates are saved with locationVerified=false.
  fullAddress: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z
    .string()
    .max(10)
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || v.trim() === '' || /^[1-9][0-9]{5}$/.test(v.trim()), {
      message: 'Enter a 6-digit PIN code starting with 1–9.',
    }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationVerified: z.boolean().optional(),
});

/** Location field names — used for the pre-migration error guard below. */
const LOCATION_FIELDS = [
  'fullAddress',
  'city',
  'state',
  'pincode',
  'latitude',
  'longitude',
  'locationVerified',
  'locationUpdatedAt',
] as const;

/**
 * Interim guard: until the location columns land in the database (worker
 * A's schema change + migration), Prisma rejects any write mentioning
 * them with "Unknown argument `latitude`…". Surface that as an explicit
 * 503 naming the missing migration instead of a generic 500, and only
 * for location saves — other settings saves never include these keys.
 */
function isUnknownLocationArgError(cause: unknown): boolean {
  const msg = cause instanceof Error ? cause.message : String(cause ?? '');
  return LOCATION_FIELDS.some((f) => msg.includes(`Unknown argument \`${f}\``));
}

export const GET = withAuth(async (_req, _ctx, principal) => {
  const shop = await repos.shops.getByOwner(principal.userId);
  const { getSubscriptionStatus } = await import('@/lib/api/entitlements');
  const subscription = await getSubscriptionStatus(shop.id);
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
    subscription: {
      tier: subscription.tier,
      effectiveTier: subscription.effectiveTier,
      state: subscription.state,
      isActive: subscription.isActive,
      inGracePeriod: subscription.inGracePeriod,
      daysUntilExpiry: subscription.daysUntilExpiry,
      features: subscription.features,
    },
    // New profile fields.
    description: shop.description,
    businessHours: shop.businessHours,
    logoUrl: shop.logoUrl,
    upiQrStorageKey: shop.upiQrStorageKey,
    servicesJson: shop.servicesJson,
    paymentPhone: shop.paymentPhone,
    paymentInstructions: shop.paymentInstructions,
    cashOnPickup: shop.cashOnPickup,
    // Shop location.
    fullAddress: shop.fullAddress ?? null,
    city: shop.city ?? null,
    state: shop.state ?? null,
    pincode: shop.pincode ?? null,
    latitude: shop.latitude ?? null,
    longitude: shop.longitude ?? null,
    locationVerified: shop.locationVerified ?? false,
    locationUpdatedAt: shop.locationUpdatedAt ?? null,
  });
}, ['owner']);

export const PATCH = withAuth(async (req, _ctx, principal) => {
  try {
    const body = PatchShopSchema.parse(await req.json());

    // M1 fix (ledger mismatch — pamphlet interim guard):
    //
    // The pamphlet feature (`pamphletEnabled`, `pamphletPricePaise`,
    // `pamphletName`) is persisted to the DB and PATCHable here, but the
    // pricing engine (`priceFileFromRecord`, `recalcOrderTotal`, the
    // checkout route) NEVER reads these fields. So if a shopkeeper enables
    // the pamphlet, the surcharge is silently dropped from every checkout
    // — the customer is never billed for the pamphlet, and the ledger
    // never reflects it. The shopkeeper hands out free cover sheets.
    //
    // Until the pamphlet is either honored (Fix B.1: add `wantsPamphlet`
    // to Order, bill `pamphletPricePaise` at checkout) or removed (Fix
    // B.2: drop the columns + schema), reject any attempt to ENABLE it.
    // This closes the revenue leak — a shopkeeper can't configure a
    // surcharge that will silently never be billed.
    //
    // Disabling an already-enabled pamphlet (or setting the price/name
    // without enabling) is ALLOWED so the shopkeeper can recover from a
    // prior misconfiguration without a 422.
    if (body.pamphletEnabled === true) {
      throw new ValidationError(
        'The pamphlet / cover-sheet feature is not yet billed at checkout. ' +
          'Enabling it would configure a surcharge that customers are never charged, ' +
          'producing a ledger mismatch. Please leave it disabled until the feature is implemented.',
      );
    }

    const shop = await repos.shops.getByOwner(principal.userId);

    // ── Location normalisation ──
    // Only when the patch touches a location field: empty strings become
    // null (clear), a lone latitude/longitude is rejected (a half-filled
    // pair is not a location), locationVerified is forced false when no
    // coordinates are supplied, and locationUpdatedAt is stamped now.
    const locationKeys = LOCATION_FIELDS.filter((k) => k in body);
    const patch: Record<string, unknown> = { ...body };
    if (locationKeys.length > 0) {
      for (const k of ['fullAddress', 'city', 'state', 'pincode'] as const) {
        if (k in patch && typeof patch[k] === 'string' && (patch[k] as string).trim() === '') {
          patch[k] = null;
        }
      }
      if (typeof patch.pincode === 'string') patch.pincode = (patch.pincode as string).trim();
      const lat = patch.latitude as number | null | undefined;
      const lng = patch.longitude as number | null | undefined;
      const hasLat = lat !== undefined && lat !== null;
      const hasLng = lng !== undefined && lng !== null;
      if (hasLat !== hasLng) {
        throw new ValidationError(
          'Enter both latitude and longitude, or neither — a half-filled coordinate pair is not a location.',
        );
      }
      if (!hasLat && patch.locationVerified === true) {
        patch.locationVerified = false;
      }
      patch.locationUpdatedAt = new Date();
    }

    const updated = await repos.shops.update(shop.id, patch);
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
      fullAddress: updated.fullAddress ?? null,
      city: updated.city ?? null,
      state: updated.state ?? null,
      pincode: updated.pincode ?? null,
      latitude: updated.latitude ?? null,
      longitude: updated.longitude ?? null,
      locationVerified: updated.locationVerified ?? false,
      locationUpdatedAt: updated.locationUpdatedAt ?? null,
    });
  } catch (cause) {
    if (isUnknownLocationArgError(cause)) {
      return fail(
        new AppError(
          'Shop location fields are not saved yet — the location database update has not been applied. ' +
            'Your other settings are unaffected; try saving the location again after the update.',
          'LOCATION_MIGRATION_PENDING',
          503,
        ),
      );
    }
    return fail(toAppError(cause));
  }
}, ['owner']);
