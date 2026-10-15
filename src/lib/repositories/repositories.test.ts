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
import { ShopRepository } from './shop.repository';
import { UserRepository } from './user.repository';
import { OrderRepository } from './order.repository';
import { NotFoundError } from '@platform/core/errors';
import type { Shop, ShopPricingConfig } from '@platform/core/domain';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';

let db: InMemoryDatabaseAdapter;
let shops: ShopRepository;
let users: UserRepository;
let orders: OrderRepository;

function makeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: crypto.randomUUID(),
    name: 'Test Shop',
    slug: 'test-shop',
    ownerUserId: crypto.randomUUID(),
    upiId: 'test@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig(),
    address: 'somewhere',
    phone: '+919999999999',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  // Repos resolve the adapter lazily from the container, so set a fully
  // in-memory container for the test.
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
    logger: new StubLoggerAdapter(),
    auth: new JwtAuthAdapter({ accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
  };
  setContainerForTesting(container);
  shops = new ShopRepository('shop');
  users = new UserRepository('user');
  orders = new OrderRepository('order');
});

describe('ShopRepository', () => {
  it('round-trips a shop with JSON pricing config', async () => {
    const shop = makeShop({ slug: 'round-trip' });
    const saved = await shops.create(shop);
    expect(saved.slug).toBe('round-trip');
    expect(saved.pricingConfig.bw_a4_per_page).toBe(shop.pricingConfig.bw_a4_per_page);
    expect(saved.paymentCredentials).toEqual({});
  });

  it('finds by slug', async () => {
    await shops.create(makeShop({ slug: 'slug-find' }));
    const found = await shops.findBySlug('slug-find');
    expect(found?.name).toBe('Test Shop');
  });

  it('returns null for unknown slug', async () => {
    expect(await shops.findBySlug('nope')).toBeNull();
  });

  it('updates pricing config and re-parses it', async () => {
    const shop = await shops.create(makeShop({ slug: 'upd' }));
    const newCfg: ShopPricingConfig = { ...shop.pricingConfig, bw_a4_per_page: 999 };
    const updated = await shops.update(shop.id, { pricingConfig: newCfg });
    expect(updated.pricingConfig.bw_a4_per_page).toBe(999);
  });

  it('getByOwner throws NotFound for missing owner', async () => {
    await expect(shops.getByOwner('no-owner')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('OrderRepository', () => {
  it('creates an order in awaiting_payment with 0 total', async () => {
    const shop = await shops.create(makeShop({ slug: 'o1' }));
    const order = await orders.create({ shopId: shop.id, customerToken: 'ABCDEF' });
    expect(order.status).toBe('awaiting_payment');
    expect(order.totalAmountPaise).toBe(0);
    expect(order.currency).toBe('INR');
  });

  it('findByIdAndShop scopes by tenant — cross-tenant read is null', async () => {
    const shopA = await shops.create(makeShop({ slug: 'a', ownerUserId: crypto.randomUUID() }));
    const shopB = await shops.create(makeShop({ slug: 'b', ownerUserId: crypto.randomUUID() }));
    const order = await orders.create({ shopId: shopA.id, customerToken: 'TOKEN01' });
    // Shop A can read its own order.
    expect((await orders.findByIdAndShop(order.id, shopA.id))?.id).toBe(order.id);
    // Shop B CANNOT read shop A's order — tenant isolation.
    expect(await orders.findByIdAndShop(order.id, shopB.id)).toBeNull();
  });

  it('listByShop filters by status', async () => {
    const shop = await shops.create(makeShop({ slug: 'l1' }));
    await orders.create({ shopId: shop.id, customerToken: 'T1' });
    const paid = await orders.create({ shopId: shop.id, customerToken: 'T2' });
    await orders.update(paid.id, { status: 'paid' });
    const all = await orders.listByShop(shop.id);
    const onlyPaid = await orders.listByShop(shop.id, { status: 'paid' });
    expect(all).toHaveLength(2);
    expect(onlyPaid).toHaveLength(1);
    expect(onlyPaid[0]!.status).toBe('paid');
  });

  it('countByShop counts with optional status filter', async () => {
    const shop = await shops.create(makeShop({ slug: 'c1' }));
    await orders.create({ shopId: shop.id, customerToken: 'C1' });
    await orders.create({ shopId: shop.id, customerToken: 'C2' });
    const paid = await orders.create({ shopId: shop.id, customerToken: 'C3' });
    await orders.update(paid.id, { status: 'paid' });
    expect(await orders.countByShop(shop.id)).toBe(3);
    expect(await orders.countByShop(shop.id, 'paid')).toBe(1);
  });

  it('updateByShop is a no-op for foreign orders', async () => {
    const shopA = await shops.create(makeShop({ slug: 'u1', ownerUserId: crypto.randomUUID() }));
    const shopB = await shops.create(makeShop({ slug: 'u2', ownerUserId: crypto.randomUUID() }));
    const order = await orders.create({ shopId: shopA.id, customerToken: 'U1' });
    const result = await orders.updateByShop(order.id, shopB.id, { status: 'paid' });
    expect(result).toBeNull();
    // The order must still be awaiting_payment — no cross-tenant mutation.
    const check = await orders.findById(order.id);
    expect(check?.status).toBe('awaiting_payment');
  });
});

describe('UserRepository', () => {
  it('create + findByEmail round-trips', async () => {
    // Minimal fake auth: hash = plain reversed (tests don't verify crypto).
    const fakeAuth = {
      hashPassword: async (p: string) => `hash:${p}`,
      verifyPassword: async (p: string, h: string) => h === `hash:${p}`,
    };
    const user = await users.create(
      { email: 'x@y.com', phone: '+9199', password: 'secret', role: 'owner', shopId: null },
      fakeAuth as never,
    );
    const found = await users.findByEmail('x@y.com');
    expect(found?.id).toBe(user.id);
    expect(found?.role).toBe('owner');
  });
});
