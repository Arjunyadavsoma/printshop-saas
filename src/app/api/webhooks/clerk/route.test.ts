import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Webhook } from 'svix';

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
import { POST } from './route';

const WEBHOOK_SECRET = 'whsec_MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE='; // whsec_ + base64 (svix decodes it)
const env = process.env as unknown as Record<string, string | undefined>;
let savedSecret: string | undefined;

function signedRequest(event: Record<string, unknown>): NextRequest {
  const body = JSON.stringify(event);
  const wh = new Webhook(WEBHOOK_SECRET);
  // svix v2 `sign` returns just the signature value — the id + timestamp
  // headers are built here.
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = wh.sign('msg_test_1', new Date(timestamp * 1000), body);
  return new NextRequest('http://localhost/api/webhooks/clerk', {
    method: 'POST',
    headers: {
      'svix-id': 'msg_test_1',
      'svix-timestamp': String(timestamp),
      'svix-signature': signature,
      'content-type': 'application/json',
    },
    body,
  });
}

beforeEach(() => {
  resetMockDb();
  savedSecret = env.CLERK_WEBHOOK_SECRET;
  env.CLERK_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const cache = new InMemoryCacheAdapter();
  const container: Container = {
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

afterEach(() => {
  if (savedSecret === undefined) delete env.CLERK_WEBHOOK_SECRET;
  else env.CLERK_WEBHOOK_SECRET = savedSecret;
});

const userCreated = {
  type: 'user.created',
  data: {
    id: 'user_wh1',
    email_addresses: [{ id: 'email_1', email_address: 'hook@example.com' }],
    primary_email_address_id: 'email_1',
  },
};

describe('POST /api/webhooks/clerk', () => {
  it('creates + links the local user on user.created', async () => {
    const res = await POST(signedRequest(userCreated));
    expect(res.status).toBe(200);
    const user = await repos.users.findByClerkId('user_wh1');
    expect(user).not.toBeNull();
    expect(user?.email).toBe('hook@example.com');
    expect(user?.role).toBe('owner');
  });

  it('syncs the email on user.updated', async () => {
    await POST(signedRequest(userCreated));
    const res = await POST(
      signedRequest({
        type: 'user.updated',
        data: {
          id: 'user_wh1',
          email_addresses: [{ id: 'email_2', email_address: 'new@example.com' }],
          primary_email_address_id: 'email_2',
        },
      }),
    );
    expect(res.status).toBe(200);
    const user = await repos.users.findByClerkId('user_wh1');
    expect(user?.email).toBe('new@example.com');
  });

  it('unlinks (but keeps) the local user on user.deleted', async () => {
    await POST(signedRequest(userCreated));
    const before = await repos.users.findByClerkId('user_wh1');
    expect(before).not.toBeNull();
    const res = await POST(
      signedRequest({ type: 'user.deleted', data: { id: 'user_wh1' } }),
    );
    expect(res.status).toBe(200);
    const after = await repos.users.findById(before!.id);
    expect(after).not.toBeNull();
    expect(after?.clerkId).toBeNull();
  });

  it('rejects a bad signature with 400', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_bad',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb',
        'content-type': 'application/json',
      },
      body: JSON.stringify(userCreated),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await repos.users.findByClerkId('user_wh1')).toBeNull();
  });

  it('fails closed with 500 when the webhook secret is not configured', async () => {
    delete env.CLERK_WEBHOOK_SECRET;
    const res = await POST(signedRequest(userCreated));
    expect(res.status).toBe(500);
  });
});
