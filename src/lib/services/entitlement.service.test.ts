import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import {
  deriveAccess,
  applyShopActive,
  DefaultEntitlementService,
  grantFreePeriod,
} from '@/lib/services/entitlement.service';
import type { SubscriptionStatus, SubscriptionTier } from '@platform/core/domain';
import { createDefaultPricingConfig } from '@platform/core/domain';

/**
 * Phase 2 — subscription entitlement enforcement tests.
 *
 * Verifies:
 *   1. deriveAccess returns `active` for in-period statuses.
 *   2. deriveAccess returns `inactive` for expired / cancelled / suspended.
 *   3. deriveAccess honours the grace window for payment_pending.
 *   4. applyShopActive forces inactive when the shop row is inactive.
 *   5. EntitlementService.check returns the right decision end-to-end.
 *   6. grantFreePeriod writes a granted_free subscription row.
 *   7. An expired shop's entitlement check returns inactive.
 */

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  const container: Container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger(),
    auth,
  };
  setContainerForTesting(container);
});

describe('Phase 2 — deriveAccess pure logic', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const future = new Date('2026-12-16T12:00:00Z');
  const past = new Date('2026-10-16T12:00:00Z');
  const graceDays = 7;

  it('returns active for an active subscription in period', () => {
    const d = deriveAccess('active', now, future, graceDays);
    expect(d.access).toBe('active');
    expect(d.reason).toBe('ok');
  });

  it('returns active for granted_free in period', () => {
    const d = deriveAccess('granted_free', now, future, graceDays);
    expect(d.access).toBe('active');
    expect(d.reason).toBe('ok');
  });

  it('returns active for admin_approved in period', () => {
    const d = deriveAccess('admin_approved', now, future, graceDays);
    expect(d.access).toBe('active');
  });

  it('returns active for trial in period', () => {
    const d = deriveAccess('trial', now, future, graceDays);
    expect(d.access).toBe('active');
  });

  it('returns active for renewed in period', () => {
    const d = deriveAccess('renewed', now, future, graceDays);
    expect(d.access).toBe('active');
  });

  it('returns active for payment_pending in period', () => {
    const d = deriveAccess('payment_pending', now, future, graceDays);
    expect(d.access).toBe('active');
  });

  it('returns inactive (expired) when an active subscription has passed period end', () => {
    const d = deriveAccess('active', now, past, graceDays);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('expired');
    expect(d.status).toBe('expired');
  });

  it('returns active for payment_pending within the grace window', () => {
    // Period ended 3 days ago; grace is 7 days → still active.
    const justPast = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const d = deriveAccess('payment_pending', now, justPast, graceDays);
    expect(d.access).toBe('active');
    expect(d.status).toBe('grace_period');
  });

  it('returns inactive (expired) for payment_pending past the grace window', () => {
    const farPast = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const d = deriveAccess('payment_pending', now, farPast, graceDays);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('expired');
  });

  it('returns inactive (expired) for expired status', () => {
    const d = deriveAccess('expired', now, past, graceDays);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('expired');
  });

  it('returns inactive (cancelled) for cancelled status', () => {
    const d = deriveAccess('cancelled', now, past, graceDays);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('cancelled');
  });

  it('returns inactive (suspended) for suspended status', () => {
    const d = deriveAccess('suspended', now, future, graceDays);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('suspended');
  });
});

describe('Phase 2 — applyShopActive', () => {
  const future = new Date('2026-12-16T12:00:00Z');

  it('passes through an active decision when the shop is active', () => {
    const d = deriveAccess('active', new Date(), future);
    const applied = applyShopActive(d, true);
    expect(applied.access).toBe('active');
    expect(applied.reason).toBe('ok');
  });

  it('forces inactive when the shop row is inactive regardless of subscription', () => {
    const d = deriveAccess('active', new Date(), future);
    const applied = applyShopActive(d, false);
    expect(applied.access).toBe('inactive');
    expect(applied.reason).toBe('inactive_shop');
  });
});

describe('Phase 2 — EntitlementService end-to-end', () => {
  it('returns no_subscription for a non-existent shop', async () => {
    const service = new DefaultEntitlementService();
    const d = await service.check('shop-does-not-exist');
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('no_subscription');
  });

  it('returns active for a shop with a granted_free subscription in period', async () => {
    // Create a shop + a subscription row.
    const user = await repos.users.create(
      { email: 'owner@example.com', phone: '+919999999999', password: 'pw-12345', role: 'owner', shopId: null },
      // AuthAdapter passed separately below — the create call uses it.
      await import('@/lib/container').then(m => m.getContainer().auth),
    );
    const shopId = 'shop-ent-1';
    await repos.shops.create({
      id: shopId,
      name: 'Test Shop',
      slug: 'test-shop-1',
      ownerUserId: user.id,
      upiId: 'test@upi',
      paymentProvider: 'phonepe',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'Test Address',
      phone: '+919999999999',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      paymentMethods: 'both',
      pamphletEnabled: false,
      pamphletPricePaise: 0,
      pamphletName: null,
    } as never);

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await repos.subscriptions.upsert({
      shopId,
      tier: 'free',
      status: 'granted_free',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    const service = new DefaultEntitlementService();
    const d = await service.check(shopId);
    expect(d.access).toBe('active');
    expect(d.tier).toBe('free');
    expect(d.status).toBe('granted_free');
  });

  it('returns inactive (expired) for an expired subscription', async () => {
    const shopId = 'shop-ent-2';
    const user = await repos.users.create(
      { email: 'owner2@example.com', phone: '+919999999998', password: 'pw-12345', role: 'owner', shopId: null },
      await import('@/lib/container').then(m => m.getContainer().auth),
    );
    await repos.shops.create({
      id: shopId,
      name: 'Expired Shop',
      slug: 'expired-shop-2',
      ownerUserId: user.id,
      upiId: 'test2@upi',
      paymentProvider: 'phonepe',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'Test Address',
      phone: '+919999999998',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      paymentMethods: 'both',
      pamphletEnabled: false,
      pamphletPricePaise: 0,
      pamphletName: null,
    } as never);

    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await repos.subscriptions.upsert({
      shopId,
      tier: 'free',
      status: 'active',
      currentPeriodStart: new Date(past.getTime() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: past,
    });

    const service = new DefaultEntitlementService();
    const d = await service.check(shopId);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('expired');
  });

  it('returns inactive (suspended) when the shop row isActive=false', async () => {
    const shopId = 'shop-ent-3';
    const user = await repos.users.create(
      { email: 'owner3@example.com', phone: '+919999999997', password: 'pw-12345', role: 'owner', shopId: null },
      await import('@/lib/container').then(m => m.getContainer().auth),
    );
    await repos.shops.create({
      id: shopId,
      name: 'Suspended Shop',
      slug: 'suspended-shop-3',
      ownerUserId: user.id,
      upiId: 'test3@upi',
      paymentProvider: 'phonepe',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'Test Address',
      phone: '+919999999997',
      timezone: 'Asia/Kolkata',
      isActive: false, // ← admin suspended the shop
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      paymentMethods: 'both',
      pamphletEnabled: false,
      pamphletPricePaise: 0,
      pamphletName: null,
    } as never);

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await repos.subscriptions.upsert({
      shopId,
      tier: 'free',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: future,
    });

    const service = new DefaultEntitlementService();
    const d = await service.check(shopId);
    expect(d.access).toBe('inactive');
    expect(d.reason).toBe('inactive_shop');
  });
});

describe('Phase 2 — grantFreePeriod', () => {
  it('writes a granted_free subscription with the right period end', async () => {
    const shopId = 'shop-grant-1';
    const user = await repos.users.create(
      { email: 'owner-grant@example.com', phone: '+919999999996', password: 'pw-12345', role: 'owner', shopId: null },
      await import('@/lib/container').then(m => m.getContainer().auth),
    );
    await repos.shops.create({
      id: shopId,
      name: 'Grant Shop',
      slug: 'grant-shop-1',
      ownerUserId: user.id,
      upiId: 'grant@upi',
      paymentProvider: 'phonepe',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'Test Address',
      phone: '+919999999996',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      paymentMethods: 'both',
      pamphletEnabled: false,
      pamphletPricePaise: 0,
      pamphletName: null,
    } as never);

    const before = Date.now();
    const sub = await grantFreePeriod(shopId, 30, 'free');
    const after = Date.now();

    expect(sub.status).toBe('granted_free');
    expect(sub.tier).toBe('free');
    expect(sub.provider).toBe('internal');
    // Period end should be ~30 days from now (within a 5s tolerance).
    const expectedMs = before + 30 * 24 * 60 * 60 * 1000;
    const actualMs = sub.currentPeriodEnd.getTime();
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5000);
    // Sanity: period end is in the future.
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(after);
  });

  it('rejects non-positive days', async () => {
    await expect(grantFreePeriod('shop-x', 0)).rejects.toThrow();
    await expect(grantFreePeriod('shop-x', -5)).rejects.toThrow();
    await expect(grantFreePeriod('shop-x', 1.5)).rejects.toThrow();
  });

  it('is idempotent — calling twice upserts the same shopId', async () => {
    const shopId = 'shop-grant-2';
    const user = await repos.users.create(
      { email: 'owner-grant2@example.com', phone: '+919999999995', password: 'pw-12345', role: 'owner', shopId: null },
      await import('@/lib/container').then(m => m.getContainer().auth),
    );
    await repos.shops.create({
      id: shopId,
      name: 'Grant Shop 2',
      slug: 'grant-shop-2',
      ownerUserId: user.id,
      upiId: 'grant2@upi',
      paymentProvider: 'phonepe',
      paymentCredentials: {},
      pricingConfig: createDefaultPricingConfig(),
      address: 'Test Address',
      phone: '+919999999995',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      paymentMethods: 'both',
      pamphletEnabled: false,
      pamphletPricePaise: 0,
      pamphletName: null,
    } as never);

    const first = await grantFreePeriod(shopId, 30);
    const second = await grantFreePeriod(shopId, 45);

    // Same shopId → one row in the table, period end reflects the latest grant.
    const all = await repos.subscriptions.findByShop(shopId);
    expect(all?.id).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(second.currentPeriodEnd.getTime()).toBeGreaterThan(first.currentPeriodEnd.getTime());
  });
});
