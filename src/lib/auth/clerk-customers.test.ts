import { describe, expect, it, beforeEach, vi } from 'vitest';

// Same harness as the other route/lib tests: the shared Prisma-style mock
// for '@/lib/db' + an in-memory test container (JWT auth with test secrets).
vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

import { setContainerForTesting, type Container } from '@/lib/container';
import { resetMockDb } from '@/lib/payments/test-prisma-mock';
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
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { repos } from '@/lib/repositories';
import { linkOrCreateClerkCustomer, unlinkClerkCustomer } from './clerk-customers';

let container: Container;

beforeEach(() => {
  resetMockDb();
  const cache = new InMemoryCacheAdapter();
  container = {
    db: new InMemoryDatabaseAdapter(),
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new StubLoggerAdapter(),
    auth: new JwtAuthAdapter(
      {
        accessSecret: 'test-access-secret-min-32-chars-long',
        refreshSecret: 'test-refresh-secret-min-32-chars-long',
        accessTtlSeconds: 900,
        refreshTtlSeconds: 2592000,
      },
      cache,
    ),
  };
  setContainerForTesting(container);
});

describe('linkOrCreateClerkCustomer', () => {
  it('creates a fresh customer account for a new Clerk id + email', async () => {
    const customer = await linkOrCreateClerkCustomer('user_clerk1', 'New@Example.com', 'New Customer');
    expect(customer.clerkId).toBe('user_clerk1');
    expect(customer.email).toBe('new@example.com');
    expect(customer.name).toBe('New Customer');
    expect(await repos.users.findByEmail('new@example.com')).toBeNull();
  });

  it('links an existing email customer instead of creating a duplicate', async () => {
    const existing = await repos.customerAccounts.create({ email: 'buyer@example.com', name: 'Buyer' });
    const linked = await linkOrCreateClerkCustomer('user_clerk2', 'BUYER@example.com');
    expect(linked.id).toBe(existing.id);
    expect(linked.clerkId).toBe('user_clerk2');
    expect(linked.name).toBe('Buyer');
  });

  it('is idempotent — a second call returns the same linked customer', async () => {
    const first = await linkOrCreateClerkCustomer('user_clerk3', 'a@example.com');
    const second = await linkOrCreateClerkCustomer('user_clerk3', 'a@example.com');
    expect(second.id).toBe(first.id);
  });

  it('never touches the shopkeeper table — the same email can be both an owner and a customer', async () => {
    // The shopkeeper signed up with email+password first.
    const owner = await repos.users.create(
      { email: 'both@example.com', phone: '9000000000', password: 'pw123456', role: 'owner', shopId: null },
      container.auth,
    );
    // The same person signs in as a customer with the same Google account.
    const customer = await linkOrCreateClerkCustomer('user_both1', 'both@example.com', 'Both Person');
    expect(customer.email).toBe('both@example.com');
    expect(customer.clerkId).toBe('user_both1');
    expect(customer.id).not.toBe(owner.id);
    // The owner row is untouched: no Clerk id linked onto it, role unchanged.
    const ownerAfter = await repos.users.findById(owner.id);
    expect(ownerAfter?.clerkId).toBeNull();
    expect(ownerAfter?.role).toBe('owner');
    // And the customer row is a separate identity in its own table.
    expect(await repos.customerAccounts.findByClerkId('user_both1')).not.toBeNull();
    expect(await repos.users.findByClerkId('user_both1')).toBeNull();
  });
});

describe('unlinkClerkCustomer', () => {
  it('clears the Clerk link but keeps the local customer and its history', async () => {
    const customer = await linkOrCreateClerkCustomer('user_clerk4', 'keep@example.com');
    await unlinkClerkCustomer('user_clerk4');
    const after = await repos.customerAccounts.findById(customer.id);
    expect(after).not.toBeNull();
    expect(after?.clerkId).toBeNull();
    expect(await repos.customerAccounts.findByClerkId('user_clerk4')).toBeNull();
  });

  it('is a no-op for an unknown Clerk id', async () => {
    await expect(unlinkClerkCustomer('user_nonexistent')).resolves.toBeUndefined();
  });
});
