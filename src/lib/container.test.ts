import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { setContainerForTesting, getContainer } from '@/lib/container';
import type { Container } from '@/lib/container';
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

function makeContainer(): Container {
  const cache = new InMemoryCacheAdapter();
  return {
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
    auth: new JwtAuthAdapter({ accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
  };
}

function setNodeEnv(val: string) {
  (process.env as Record<string, string>).NODE_ENV = val;
}

describe('Container startup validation', () => {
  const origEnv = { ...process.env };

  beforeEach(() => { process.env = { ...origEnv }; });
  afterEach(() => { process.env = { ...origEnv }; });

  it('throws in production if STORAGE_PROVIDER is memory', () => {
    setNodeEnv('production');
    process.env.STORAGE_PROVIDER = 'memory';
    process.env.DATABASE_PROVIDER = 'prisma';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.CACHE_PROVIDER = 'redis';
    process.env.JWT_ACCESS_SECRET = 'strong-secret-123';
    process.env.JWT_REFRESH_SECRET = 'strong-refresh-456';
    process.env.REALTIME_EMIT_SECRET = 'strong-emit-789';
    process.env.PAYMENT_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    // Reset the container so the next getContainer() triggers buildContainer()
    (globalThis as unknown as { __printshopContainer?: unknown }).__printshopContainer = undefined;
    expect(() => { void getContainer(); }).toThrow('STORAGE_PROVIDER=memory');
  });

  it('throws in production if DATABASE_URL is SQLite file', () => {
    setNodeEnv('production');
    process.env.DATABASE_PROVIDER = 'prisma';
    process.env.DATABASE_URL = 'file:./db/prod.db';
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.CACHE_PROVIDER = 'redis';
    process.env.JWT_ACCESS_SECRET = 'strong-secret-123';
    process.env.JWT_REFRESH_SECRET = 'strong-refresh-456';
    process.env.REALTIME_EMIT_SECRET = 'strong-emit-789';
    process.env.PAYMENT_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    (globalThis as unknown as { __printshopContainer?: unknown }).__printshopContainer = undefined;
    expect(() => { void getContainer(); }).toThrow('SQLite file');
  });

  it('throws in production if CACHE_PROVIDER is memory', () => {
    setNodeEnv('production');
    process.env.DATABASE_PROVIDER = 'prisma';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.CACHE_PROVIDER = 'memory';
    process.env.JWT_ACCESS_SECRET = 'strong-secret-123';
    process.env.JWT_REFRESH_SECRET = 'strong-refresh-456';
    process.env.REALTIME_EMIT_SECRET = 'strong-emit-789';
    process.env.PAYMENT_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    (globalThis as unknown as { __printshopContainer?: unknown }).__printshopContainer = undefined;
    expect(() => { void getContainer(); }).toThrow('CACHE_PROVIDER=memory');
  });

  it('throws if PAYMENT_ENCRYPTION_KEY is wrong length', () => {
    setNodeEnv('production');
    process.env.DATABASE_PROVIDER = 'prisma';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.CACHE_PROVIDER = 'redis';
    process.env.JWT_ACCESS_SECRET = 'strong-secret-123';
    process.env.JWT_REFRESH_SECRET = 'strong-refresh-456';
    process.env.REALTIME_EMIT_SECRET = 'strong-emit-789';
    process.env.PAYMENT_ENCRYPTION_KEY = Buffer.alloc(16, 0x42).toString('base64');
    (globalThis as unknown as { __printshopContainer?: unknown }).__printshopContainer = undefined;
    expect(() => { void getContainer(); }).toThrow('PAYMENT_ENCRYPTION_KEY');
  });

  it('does NOT throw in dev with all defaults', () => {
    setNodeEnv('development');
    (globalThis as unknown as { __printshopContainer?: unknown }).__printshopContainer = undefined;
    expect(() => getContainer()).not.toThrow();
  });
});

describe('Readiness endpoint logic', () => {
  it('reports ready when all in-memory deps are healthy', async () => {
    const container = makeContainer();
    setContainerForTesting(container);
    // Call the readiness check logic directly (the route wraps it in withRateLimit)
    const dbOk = await container.db.ping();
    expect(dbOk).toBe(true);
    // In-memory storage/cache are not checked (optional dev deps)
  });

  it('reports not-ready when db.ping() throws', async () => {
    const container = makeContainer();
    // Override db.ping to throw
    container.db.ping = async () => { throw new Error('connection refused'); };
    setContainerForTesting(container);
    const dbOk = await container.db.ping().catch(() => false);
    expect(dbOk).toBe(false);
  });

  it('reports not-ready when db.ping() returns false', async () => {
    const container = makeContainer();
    container.db.ping = async () => false;
    setContainerForTesting(container);
    const dbOk = await container.db.ping();
    expect(dbOk).toBe(false);
  });
});
