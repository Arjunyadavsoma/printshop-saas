import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type ShopPricingConfig } from '@platform/core/domain';

/**
 * Idempotent demo-data seeder. Creates a "QuickPrint" demo shop with an owner
 * login if they don't already exist. Called by the /api/v1/dev/seed route and
 * safe to run multiple times.
 */
export async function seedDemoData(): Promise<{ shopId: string; ownerEmail: string; password: string; seeded: boolean }> {
  const container = getContainer();

  const existing = await repos.shops.findBySlug('quickprint');
  if (existing) {
    // Refresh dev payment credentials if missing (back-compat with Phase 2 seeds).
    if (!existing.paymentCredentials?.phonepe) {
      await repos.shops.update(existing.id, { paymentCredentials: devPaymentCredentials() });
    }
    return { shopId: existing.id, ownerEmail: 'owner@quickprint.demo', password: 'demo1234', seeded: false };
  }

  const owner = await repos.users.create(
    {
      email: 'owner@quickprint.demo',
      phone: '+919876543210',
      password: 'demo1234',
      role: 'owner',
      shopId: null, // set to the real shop id after the shop row exists (FK)
    },
    container.auth,
  );

  const pricingConfig: ShopPricingConfig = createDefaultPricingConfig();
  const paymentCredentials = devPaymentCredentials();
  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'QuickPrint Demo Shop',
    slug: 'quickprint',
    ownerUserId: owner.id,
    upiId: 'quickprint@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials,
    pricingConfig,
    address: 'Shop 12, MG Road, Bengaluru',
    phone: '+918012345678',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'starter',
    subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Link the owner to the shop (the user was created with a placeholder).
  await repos.users.update(owner.id, { shopId: shop.id });

  await repos.audit.log({
    shopId: shop.id,
    userId: owner.id,
    action: 'shop.create',
    entityType: 'shop',
    entityId: shop.id,
    metadata: { source: 'seed' },
    ip: null,
  });

  return { shopId: shop.id, ownerEmail: 'owner@quickprint.demo', password: 'demo1234', seeded: true };
}

/**
 * Dev payment credentials for all three providers. In production these are
 * encrypted at rest (libsodium sealed boxes); here they're plain JSON so the
 * demo's PhonePe/Paytm webhook round-trips work out of the box. Keys come
 * from env (with dev defaults) — the simulate routes sign + verify with the
 * same key, exercising the REAL crypto.
 */
function devPaymentCredentials(): Record<string, unknown> {
  return {
    phonepe: {
      saltKey: process.env.PHONEPE_SALT_KEY ?? 'demo-salt-key-quickprint',
      saltIndex: process.env.PHONEPE_SALT_INDEX ?? '1',
      merchantId: process.env.PHONEPE_MERCHANT_ID ?? 'DEMOQUICKPRINT',
      env: 'sandbox',
    },
    paytm: {
      merchantId: process.env.PAYTM_MERCHANT_ID ?? 'DEMOQK1234',
      merchantKey: process.env.PAYTM_MERCHANT_KEY ?? 'demo-paytm-merchant-key',
      website: process.env.PAYTM_WEBSITE ?? 'WEBSTAGING',
    },
  };
}
