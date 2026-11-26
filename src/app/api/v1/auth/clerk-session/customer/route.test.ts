import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

// Clerk server SDK — mocked: no Clerk keys exist in the test env.
// Same pattern as the shopkeeper exchange route test: the route verifies
// the `__session` cookie directly with `verifyToken` and fetches the user
// with the Backend API client.
const clerkVerifyTokenMock = vi.fn();
const clerkGetUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  verifyToken: (...args: unknown[]) => clerkVerifyTokenMock(...args),
  clerkClient: async () => ({ users: { getUser: (...args: unknown[]) => clerkGetUserMock(...args) } }),
}));

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
import { POST } from './route';

let container: Container;

beforeEach(() => {
  resetMockDb();
  clerkVerifyTokenMock.mockReset();
  clerkGetUserMock.mockReset();
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

function postReq(sessionCookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (sessionCookie) headers.cookie = `__session=${sessionCookie}`;
  return new NextRequest('http://localhost/api/v1/auth/clerk-session/customer', {
    method: 'POST',
    headers,
  });
}

function mockValidSession(userId: string, email: string | null, firstName = 'Test', lastName = 'Buyer') {
  clerkVerifyTokenMock.mockResolvedValue({ sub: userId });
  clerkGetUserMock.mockResolvedValue(
    email === null
      ? { primaryEmailAddress: null, firstName, lastName }
      : { primaryEmailAddress: { emailAddress: email }, firstName, lastName },
  );
}

describe('POST /api/v1/auth/clerk-session/customer', () => {
  it('returns 401 with no Clerk session cookie', async () => {
    const res = await POST(postReq());
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(clerkVerifyTokenMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the session token fails verification', async () => {
    clerkVerifyTokenMock.mockRejectedValue(new Error('invalid signature'));
    const res = await POST(postReq('bad-token'));
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });

  it('returns 400 when the Clerk user has no email', async () => {
    mockValidSession('user_noemail', null);
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(400);
  });

  it('mints a customer JWT pair for a brand-new Clerk user and creates the local customer', async () => {
    mockValidSession('user_new1', 'Clerk-New@Example.com');
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    expect(body.data.role).toBe('customer');
    expect(body.data.email).toBe('clerk-new@example.com');
    expect(body.data.name).toBe('Test Buyer');
    const local = await repos.customerAccounts.findByClerkId('user_new1');
    expect(local).not.toBeNull();
    expect(local?.email).toBe('clerk-new@example.com');
    // The minted access token verifies as a real app JWT with role customer.
    const claims = await container.auth.verifyAccessToken(body.data.accessToken);
    expect(claims?.sub).toBe(local?.id);
    expect(claims?.role).toBe('customer');
    expect(claims?.shopId).toBeNull();
    // No shopkeeper account was created for this sign-in.
    expect(await repos.users.findByEmail('clerk-new@example.com')).toBeNull();
    expect(await repos.users.findByClerkId('user_new1')).toBeNull();
  });

  it('links an existing email customer instead of creating a duplicate', async () => {
    const existing = await repos.customerAccounts.create({ email: 'buyer@example.com', name: 'Buyer' });
    mockValidSession('user_link1', 'buyer@example.com');
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const claims = await container.auth.verifyAccessToken(body.data.accessToken);
    expect(claims?.sub).toBe(existing.id);
    const linked = await repos.customerAccounts.findById(existing.id);
    expect(linked?.clerkId).toBe('user_link1');
  });

  it('never links onto an owner row when the same email is a shopkeeper', async () => {
    const owner = await repos.users.create(
      { email: 'both@example.com', phone: '9000000000', password: 'pw123456', role: 'owner', shopId: null },
      container.auth,
    );
    mockValidSession('user_both1', 'both@example.com');
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const claims = await container.auth.verifyAccessToken(body.data.accessToken);
    // The JWT belongs to the NEW customer row, not the owner row.
    expect(claims?.sub).not.toBe(owner.id);
    expect(claims?.role).toBe('customer');
    const customer = await repos.customerAccounts.findByClerkId('user_both1');
    expect(customer).not.toBeNull();
    expect(claims?.sub).toBe(customer?.id);
    // The owner row is untouched.
    const ownerAfter = await repos.users.findById(owner.id);
    expect(ownerAfter?.clerkId).toBeNull();
    expect(ownerAfter?.role).toBe('owner');
  });
});
