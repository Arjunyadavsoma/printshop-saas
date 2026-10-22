import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type ShopPricingConfig } from '@platform/core/domain';

/**
 * Idempotent demo-data seeder. Creates multiple demo shops, an admin user,
 * and demo orders in various states. Called by the /api/v1/dev/seed route
 * and safe to run multiple times.
 *
 * Demo accounts (all use password: demo1234):
 *   - owner@quickprint.demo  (shop owner — QuickPrint Demo Shop)
 *   - owner@copycenter.demo  (shop owner — CopyCenter)
 *   - owner@prinithub.demo   (shop owner — PrintHub Express)
 *   - admin@printshop.demo   (platform admin — sees all shops/orders)
 */
export async function seedDemoData(): Promise<{
  shops: { id: string; name: string; slug: string; ownerEmail: string }[];
  admin: { email: string; password: string };
  seeded: boolean;
}> {
  const container = getContainer();

  // ── Ensure the admin user exists ──
  let admin = await repos.users.findByEmail('admin@printshop.demo');
  if (!admin) {
    admin = await repos.users.create(
      { email: 'admin@printshop.demo', phone: '+919999999999', password: 'demo1234', role: 'admin', shopId: null },
      container.auth,
    );
  }

  // ── Demo shops to seed ──
  const demoShops = [
    { name: 'QuickPrint Demo Shop', slug: 'quickprint', upiId: 'quickprint@okaxis', address: 'Shop 12, MG Road, Bengaluru, KA', phone: '+918012345678', tier: 'starter' as const, ownerEmail: 'owner@quickprint.demo' },
    { name: 'CopyCenter', slug: 'copycenter', upiId: 'copycenter@okhdfcbank', address: '45 Anna Salai, Chennai, TN', phone: '+914423456789', tier: 'pro' as const, ownerEmail: 'owner@copycenter.demo' },
    { name: 'PrintHub Express', slug: 'prinithub', upiId: 'prinithub@oksbi', address: '78 Park Street, Kolkata, WB', phone: '+913323456789', tier: 'free' as const, ownerEmail: 'owner@prinithub.demo' },
  ];

  const result: { id: string; name: string; slug: string; ownerEmail: string }[] = [];
  let anySeeded = false;

  for (const ds of demoShops) {
    const existing = await repos.shops.findBySlug(ds.slug);
    if (existing) {
      // Refresh dev payment credentials if missing
      if (!existing.paymentCredentials?.phonepe) {
        await repos.shops.update(existing.id, { paymentCredentials: devPaymentCredentials() });
      }
      result.push({ id: existing.id, name: existing.name, slug: existing.slug, ownerEmail: ds.ownerEmail });
      continue;
    }

    anySeeded = true;
    const owner = await repos.users.create(
      { email: ds.ownerEmail, phone: '+919876543210', password: 'demo1234', role: 'owner', shopId: null },
      container.auth,
    );

    const pricingConfig: ShopPricingConfig = createDefaultPricingConfig();
    const shop = await repos.shops.create({
      id: crypto.randomUUID(),
      name: ds.name,
      slug: ds.slug,
      ownerUserId: owner.id,
      upiId: ds.upiId,
      paymentProvider: 'googlepay',
      paymentCredentials: devPaymentCredentials(),
      pricingConfig,
      address: ds.address,
      phone: ds.phone,
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: ds.tier,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

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

    result.push({ id: shop.id, name: shop.name, slug: ds.slug, ownerEmail: ds.ownerEmail });
  }

  return {
    shops: result,
    admin: { email: 'admin@printshop.demo', password: 'demo1234' },
    seeded: anySeeded,
  };
}

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
