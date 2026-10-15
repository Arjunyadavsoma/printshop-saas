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
  SocketIoRelayRealtimeAdapter,
  R2StorageAdapter,
  UpstashCacheAdapter,
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

/** The dev-default secrets that must NOT ship to production. */
const DEV_DEFAULTS = new Set([
  'dev-access-secret-change-me',
  'dev-refresh-secret-change-me',
  'dev-emit-secret',
]);

/**
 * Fail-fast in production if a required secret is missing or still the dev
 * default. Better to refuse to boot than to run with guessable secrets.
 */
function requireSecret(key: string): string {
  const v = process.env[key];
  if (!v || DEV_DEFAULTS.has(v)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `FATAL: ${key} is missing or still the dev default — set a strong secret before deploying.`,
      );
    }
    // In dev, fall back to the documented default.
    return v || DEV_DEFAULTS.values().next().value!;
  }
  return v;
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

  // Storage — selected by STORAGE_PROVIDER (default: memory for dev).
  // Set STORAGE_PROVIDER=r2 in production (requires R2 credentials).
  const storage: StorageAdapter =
    env('STORAGE_PROVIDER', 'memory') === 'r2' ? new R2StorageAdapter({
      accountId: env('R2_ACCOUNT_ID'),
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      bucket: env('R2_BUCKET'),
    }) : new InMemoryStorageAdapter();

  // Cache — selected by CACHE_PROVIDER (default: memory for dev).
  // Set CACHE_PROVIDER=redis in production (requires Upstash REST URL + token).
  const cache: CacheAdapter =
    env('CACHE_PROVIDER', 'memory') === 'redis' ? new UpstashCacheAdapter({
      url: env('REDIS_URL'),
      token: env('REDIS_TOKEN'),
    }) : new InMemoryCacheAdapter();

  // Realtime — socket.io relay (pushes to the dashboard mini-service on :3004)
  // when REALTIME_PROVIDER=socketio; else in-memory for tests/single-process.
  const realtime: RealtimeAdapter =
    env('REALTIME_PROVIDER', 'socketio') === 'memory'
      ? new InMemoryRealtimeAdapter()
      : new SocketIoRelayRealtimeAdapter(
          { emitUrl: env('REALTIME_EMIT_URL', 'http://127.0.0.1:3004/emit'), emitSecret: requireSecret('REALTIME_EMIT_SECRET') },
          (msg, ctx) => logger.debug(msg, ctx),
        );

  // Queue — in-memory, processes jobs immediately.
  const queue: QueueAdapter = new InMemoryQueueAdapter();

  // Email / SMS — stubs capture to memory (MVP).
  const email: EmailAdapter = new StubEmailAdapter();
  const sms: SMSAdapter = new StubSmsAdapter();

  // Payments — a registry of all providers. The checkout/webhook flows route
  // to the shop's configured provider; `payment` is the default (UPI).
  const payment: PaymentAdapter = new UpiDeepLinkPaymentAdapter();
  const paymentRegistry = new PaymentAdapterRegistry();

  // Auth — JWT (HS256) + PBKDF2. Secrets fail-fast in production.
  const auth: AuthAdapter = new JwtAuthAdapter(
    {
      accessSecret: requireSecret('JWT_ACCESS_SECRET'),
      refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
      accessTtlSeconds: Number(env('ACCESS_TOKEN_TTL_SECONDS', '900')),
      refreshTtlSeconds: Number(env('REFRESH_TOKEN_TTL_SECONDS', '2592000')),
    },
    cache,
  );

  // Payment credential encryption key — fail-fast in production.
  if (process.env.NODE_ENV === 'production' && !process.env.PAYMENT_ENCRYPTION_KEY) {
    throw new Error('FATAL: PAYMENT_ENCRYPTION_KEY is required in production for credential encryption at rest.');
  }

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

/**
 * On startup (non-test), recover stale print jobs. Moves any job stuck in
 * 'printing' for >5 min to 'needs_review' (shopkeeper must review — no
 * automatic duplicate printing). Called lazily on the first container init.
 */
let staleRecovered = false;
export async function recoverStaleJobsOnStartup(): Promise<void> {
  if (staleRecovered) return;
  staleRecovered = true;
  if (process.env.NODE_ENV === 'test') return;
  try {
    const { recoverStaleJobs } = await import('@/lib/services/durable-queue');
    const count = await recoverStaleJobs();
    if (count > 0) console.log(`[startup] recovered ${count} stale print job(s) → needs_review`);
  } catch {
    // Non-fatal — the queue recovery is best-effort.
  }
}
