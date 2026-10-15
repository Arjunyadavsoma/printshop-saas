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
  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'QuickPrint Demo Shop',
    slug: 'quickprint',
    ownerUserId: owner.id,
    upiId: 'quickprint@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
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
