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
import { hasAdminPermission, type AdminPermission } from '@platform/core/domain';
import { createDefaultPricingConfig } from '@platform/core/domain';

/**
 * Phase 1 — admin authentication + authorization regression tests.
 *
 * Verifies that:
 *   1. The `adminPermissions` column is read + written correctly.
 *   2. JWTs carry `perms` for admins, null for non-admins.
 *   3. `hasAdminPermission` honours the super-admin `'*'` wildcard.
 *   4. `hasAdminPermission` fails closed on null/empty perms.
 *   5. A revoked admin permission is no longer granted by `hasAdminPermission`
 *      after the user row is updated (the DB is the source of truth).
 */

let auth: JwtAuthAdapter;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  auth = new JwtAuthAdapter(
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

describe('Phase 1 — admin permissions storage', () => {
  it('creates an admin with permissions and reads them back', async () => {
    const admin = await repos.users.create(
      {
        email: 'super@example.com',
        phone: '+919999999999',
        password: 'pw-admin-123',
        role: 'admin',
        shopId: null,
        adminPermissions: ['*'],
      },
      auth,
    );
    expect(admin.role).toBe('admin');
    expect(admin.adminPermissions).toEqual(['*']);

    const reloaded = await repos.users.findById(admin.id);
    expect(reloaded?.adminPermissions).toEqual(['*']);
  });

  it('creates a non-admin with null permissions', async () => {
    const owner = await repos.users.create(
      {
        email: 'owner@example.com',
        phone: '+919999999998',
        password: 'pw-owner-123',
        role: 'owner',
        shopId: 'shop-1',
      },
      auth,
    );
    expect(owner.adminPermissions).toBeNull();
  });

  it('drops unknown permission values on read (defence in depth)', async () => {
    // Write a raw row with a junk value through the repository so the
    // parser has to filter it.
    const admin = await repos.users.create(
      {
        email: 'ops@example.com',
        phone: '+919999999997',
        password: 'pw-ops-123',
        role: 'admin',
        shopId: null,
        adminPermissions: ['shops.approve', 'unknown.bogus' as AdminPermission],
      },
      auth,
    );
    const reloaded = await repos.users.findById(admin.id);
    expect(reloaded?.adminPermissions).toEqual(['shops.approve']);
  });

  it('serialises empty perms to null on update', async () => {
    const admin = await repos.users.create(
      {
        email: 'fin@example.com',
        phone: '+919999999996',
        password: 'pw-fin-123',
        role: 'admin',
        shopId: null,
        adminPermissions: ['finance.read'],
      },
      auth,
    );
    const updated = await repos.users.update(admin.id, { adminPermissions: [] });
    expect(updated.adminPermissions).toBeNull();
  });
});

describe('Phase 1 — JWT carries admin permissions', () => {
  it('issues an access token with perms for a super-admin', async () => {
    const admin = await repos.users.create(
      {
        email: 'super2@example.com',
        phone: '+919999999995',
        password: 'pw-super-123',
        role: 'admin',
        shopId: null,
        adminPermissions: ['*'],
      },
      auth,
    );
    const { claims } = await auth.issueAccessToken({
      id: admin.id,
      shopId: null,
      role: 'admin',
      adminPermissions: admin.adminPermissions,
    });
    expect(claims.role).toBe('admin');
    expect(claims.perms).toEqual(['*']);
  });

  it('issues an access token with null perms for a non-admin', async () => {
    const owner = await repos.users.create(
      {
        email: 'owner2@example.com',
        phone: '+919999999994',
        password: 'pw-owner-123',
        role: 'owner',
        shopId: 'shop-2',
      },
      auth,
    );
    const { claims } = await auth.issueAccessToken({
      id: owner.id,
      shopId: 'shop-2',
      role: 'owner',
    });
    expect(claims.perms).toBeNull();
  });

  it('issues an access token with null perms for an admin with no permissions', async () => {
    const admin = await repos.users.create(
      {
        email: 'noaccess@example.com',
        phone: '+919999999993',
        password: 'pw-noaccess-123',
        role: 'admin',
        shopId: null,
        adminPermissions: null,
      },
      auth,
    );
    const { claims } = await auth.issueAccessToken({
      id: admin.id,
      shopId: null,
      role: 'admin',
      adminPermissions: admin.adminPermissions,
    });
    expect(claims.role).toBe('admin');
    expect(claims.perms).toBeNull();
  });
});

describe('Phase 1 — hasAdminPermission', () => {
  it('grants every permission to the wildcard super-admin', () => {
    const perms: AdminPermission[] = ['*'];
    expect(hasAdminPermission(perms, 'shops.approve')).toBe(true);
    expect(hasAdminPermission(perms, 'payments.refund')).toBe(true);
    expect(hasAdminPermission(perms, 'audit.read')).toBe(true);
  });

  it('grants an exact permission only', () => {
    const perms: AdminPermission[] = ['shops.approve', 'shops.suspend'];
    expect(hasAdminPermission(perms, 'shops.approve')).toBe(true);
    expect(hasAdminPermission(perms, 'shops.suspend')).toBe(true);
    expect(hasAdminPermission(perms, 'payments.refund')).toBe(false);
  });

  it('fails closed on null', () => {
    expect(hasAdminPermission(null, 'shops.approve')).toBe(false);
  });

  it('fails closed on empty list', () => {
    expect(hasAdminPermission([], 'shops.approve')).toBe(false);
  });

  it('fails closed on undefined', () => {
    expect(hasAdminPermission(undefined, 'shops.approve')).toBe(false);
  });
});

describe('Phase 1 — permission revocation is immediate', () => {
  it('removing a perm from the user row immediately denies it', async () => {
    const admin = await repos.users.create(
      {
        email: 'revokable@example.com',
        phone: '+919999999992',
        password: 'pw-rev-123',
        role: 'admin',
        shopId: null,
        adminPermissions: ['shops.approve', 'shops.suspend'],
      },
      auth,
    );

    // Sanity: the perm is granted right after creation.
    const before = await repos.users.findById(admin.id);
    expect(hasAdminPermission(before?.adminPermissions, 'shops.suspend')).toBe(true);

    // Revoke shops.suspend — simulate a super-admin narrowing scope.
    await repos.users.update(admin.id, {
      adminPermissions: ['shops.approve'],
    });

    const after = await repos.users.findById(admin.id);
    expect(hasAdminPermission(after?.adminPermissions, 'shops.suspend')).toBe(false);
    expect(hasAdminPermission(after?.adminPermissions, 'shops.approve')).toBe(true);
  });
});
