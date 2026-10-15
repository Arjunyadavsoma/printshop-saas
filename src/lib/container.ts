/**
 * Composition root — the ONLY place that constructs concrete adapters.
 *
 * Every other module (routes, repositories, services) imports from
 * `@platform/core/interfaces` and receives a concrete via this container.
 * Swapping any provider is a one-line env-var change here; business logic
 * never edits. This is the load-bearing wall of the whole architecture.
 */

import { db } from '@/lib/db';
import type {
  DatabaseAdapter,
  StorageAdapter,
  PaymentAdapter,
  RealtimeAdapter,
  CacheAdapter,
  QueueAdapter,
  EmailAdapter,
  SMSAdapter,
  LoggerAdapter,
  AuthAdapter,
} from '@platform/core/interfaces';
import {
  InMemoryDatabaseAdapter,
  InMemoryStorageAdapter,
  InMemoryCacheAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { PrismaDatabaseAdapter } from '@/lib/adapters/prisma-database.adapter';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';

export interface Container {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  payment: PaymentAdapter;
  /** Per-shop provider routing — the checkout/webhook flows use this. */
  paymentRegistry: PaymentAdapterRegistry;
  realtime: RealtimeAdapter;
  cache: CacheAdapter;
  queue: QueueAdapter;
  email: EmailAdapter;
  sms: SMSAdapter;
  logger: LoggerAdapter;
  auth: AuthAdapter;
}

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

let _container: Container | null = null;

/**
 * Get the singleton container. Constructed lazily on first call and stored on
 * `globalThis` so it survives across route-handler module instances in the
 * Next.js dev runtime (which re-evaluates route modules per request). Without
 * this, an in-memory adapter (storage, cache, realtime) would be recreated
 * per request and lose its state.
 */
export function getContainer(): Container {
  const g = globalThis as unknown as { __printshopContainer?: Container };
  if (g.__printshopContainer) return g.__printshopContainer;
  if (_container) return _container;

  const container = buildContainer();
  g.__printshopContainer = container;
  _container = container;
  return container;
}

function buildContainer(): Container {

  const logger: LoggerAdapter =
    env('LOGGER_PROVIDER', 'json') === 'stub' ? new StubLoggerAdapter() : new JsonConsoleLogger({ service: 'printshop-api' });

  // Database
  const database: DatabaseAdapter =
    env('DATABASE_PROVIDER', 'prisma') === 'memory' ? new InMemoryDatabaseAdapter() : new PrismaDatabaseAdapter(db);

  // Storage — in-memory in the demo (R2 wiring is Phase-2-pending infra).
  // The InMemoryStorageAdapter is extended with real put()/getBytes() so the
  // full upload→parse→print flow works end-to-end without a cloud bucket.
  const storage = new InMemoryStorageAdapter();

  // Cache — in-memory (Upstash wiring is config-only).
  const cache: CacheAdapter = new InMemoryCacheAdapter();

  // Realtime — in-memory pub/sub (Supabase Realtime wiring is config-only).
  const realtime: RealtimeAdapter = new InMemoryRealtimeAdapter();

  // Queue — in-memory, processes jobs immediately.
  const queue: QueueAdapter = new InMemoryQueueAdapter();

  // Email / SMS — stubs capture to memory (MVP).
  const email: EmailAdapter = new StubEmailAdapter();
  const sms: SMSAdapter = new StubSmsAdapter();

  // Payments — a registry of all providers. The checkout/webhook flows route
  // to the shop's configured provider; `payment` is the default (UPI).
  const payment: PaymentAdapter = new UpiDeepLinkPaymentAdapter();
  const paymentRegistry = new PaymentAdapterRegistry();

  // Auth — JWT (HS256) + PBKDF2.
  const auth: AuthAdapter = new JwtAuthAdapter(
    {
      accessSecret: env('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
      refreshSecret: env('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
      accessTtlSeconds: Number(env('ACCESS_TOKEN_TTL_SECONDS', '900')),
      refreshTtlSeconds: Number(env('REFRESH_TOKEN_TTL_SECONDS', '2592000')),
    },
    cache,
  );

  const container: Container = {
    db: database,
    storage,
    payment,
    paymentRegistry,
    realtime,
    cache,
    queue,
    email,
    sms,
    logger,
    auth,
  };

  logger.info('container initialised', {
    db: container.db.provider,
    storage: container.storage.provider,
    payment: container.payment.provider,
    realtime: container.realtime.provider,
    cache: container.cache.provider,
    queue: container.queue.provider,
    auth: container.auth.provider,
    logger: container.logger.provider,
  });

  return container;
}

/** Test-only: inject a fully in-memory container (no Prisma). */
export function setContainerForTesting(c: Container): void {
  (globalThis as unknown as { __printshopContainer?: Container }).__printshopContainer = c;
  _container = c;
}
