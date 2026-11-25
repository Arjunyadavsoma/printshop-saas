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
import { linkOrCreateClerkUser, unlinkClerkUser } from './clerk-users';

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

describe('linkOrCreateClerkUser', () => {
  it('creates a fresh owner account for a new Clerk id + email', async () => {
    const user = await linkOrCreateClerkUser('user_clerk1', 'New@Example.com', container.auth);
    expect(user.clerkId).toBe('user_clerk1');
    expect(user.email).toBe('new@example.com');
    expect(user.role).toBe('owner');
    expect(user.shopId).toBeNull();
    // Password login for the Clerk-created row is unusable by design.
    expect(await container.auth.verifyPassword('anything', user.passwordHash)).toBe(false);
  });

  it('links an existing email account and preserves its role', async () => {
    const existing = await repos.users.create(
      { email: 'owner@example.com', phone: '9000000000', password: 'pw123456', role: 'admin', shopId: null },
      container.auth,
    );
    const linked = await linkOrCreateClerkUser('user_clerk2', 'OWNER@example.com', container.auth);
    expect(linked.id).toBe(existing.id);
    expect(linked.clerkId).toBe('user_clerk2');
    expect(linked.role).toBe('admin');
    // Password login still works for the linked account.
    expect(await container.auth.verifyPassword('pw123456', linked.passwordHash)).toBe(true);
  });

  it('is idempotent — a second call returns the same linked user', async () => {
    const first = await linkOrCreateClerkUser('user_clerk3', 'a@example.com', container.auth);
    const second = await linkOrCreateClerkUser('user_clerk3', 'a@example.com', container.auth);
    expect(second.id).toBe(first.id);
  });
});

describe('unlinkClerkUser', () => {
  it('clears the Clerk link but keeps the local user', async () => {
    const user = await linkOrCreateClerkUser('user_clerk4', 'keep@example.com', container.auth);
    await unlinkClerkUser('user_clerk4');
    const after = await repos.users.findById(user.id);
    expect(after).not.toBeNull();
    expect(after?.clerkId).toBeNull();
    expect(await repos.users.findByClerkId('user_clerk4')).toBeNull();
  });

  it('is a no-op for an unknown Clerk id', async () => {
    await expect(unlinkClerkUser('user_nonexistent')).resolves.toBeUndefined();
  });
});
