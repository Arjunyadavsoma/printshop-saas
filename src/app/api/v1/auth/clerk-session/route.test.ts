import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', async () => {
  const { getMockDb } = await import('@/lib/payments/test-prisma-mock');
  return { db: getMockDb() };
});

// Clerk server SDK — mocked: no Clerk keys exist in the test env.
// The route verifies the `__session` cookie directly with `verifyToken`
// (no clerkMiddleware runs in this app, so `auth()`/`currentUser()` would
// throw); the Backend API client fetches the user for their email.
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
  return new NextRequest('http://localhost/api/v1/auth/clerk-session', {
    method: 'POST',
    headers,
  });
}

function mockValidSession(userId: string, email: string | null) {
  clerkVerifyTokenMock.mockResolvedValue({ sub: userId });
  clerkGetUserMock.mockResolvedValue(
    email === null ? { primaryEmailAddress: null } : { primaryEmailAddress: { emailAddress: email } },
  );
}

describe('POST /api/v1/auth/clerk-session', () => {
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

  it('mints a JWT pair for a brand-new Clerk user and creates the local account', async () => {
    mockValidSession('user_new1', 'Clerk-New@Example.com');
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    expect(body.data.role).toBe('owner');
    expect(body.data.email).toBe('clerk-new@example.com');
    const local = await repos.users.findByClerkId('user_new1');
    expect(local).not.toBeNull();
    expect(local?.email).toBe('clerk-new@example.com');
    // The minted access token verifies as a real app JWT.
    const claims = await container.auth.verifyAccessToken(body.data.accessToken);
    expect(claims?.sub).toBe(local?.id);
    expect(claims?.role).toBe('owner');
  });

  it('links an existing email account instead of creating a duplicate', async () => {
    const existing = await repos.users.create(
      { email: 'shop@example.com', phone: '9000000000', password: 'pw123456', role: 'owner', shopId: null },
      container.auth,
    );
    mockValidSession('user_link1', 'shop@example.com');
    const res = await POST(postReq('valid-token'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const claims = await container.auth.verifyAccessToken(body.data.accessToken);
    expect(claims?.sub).toBe(existing.id);
    const linked = await repos.users.findById(existing.id);
    expect(linked?.clerkId).toBe('user_link1');
  });
});
