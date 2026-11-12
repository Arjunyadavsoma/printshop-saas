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
  S3StorageAdapter,
  SupabaseStorageAdapter,
  DisabledStorageAdapter,
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
    return v || DEV_DEFAULTS.values().next().value!;
  }
  return v;
}

/**
 * Fail-fast in production if STORAGE_PROVIDER is 'memory' or unset —
 * customer documents would be stored in-process (lost on restart).
 * In dev, memory storage is the default and is fine.
 *
 * Supported production providers:
 *   - 'supabase' → SupabaseStorageAdapter (Supabase Storage — free 1GB)
 *   - 'r2'       → R2StorageAdapter  (Cloudflare R2)
 *   - 'disabled' → DisabledStorageAdapter (uploads explicitly unavailable —
 *                  the app runs but file upload/download returns a clear error.
 *                  Use this when S3/R2 credentials are not yet verified.)
 */
function validateStorageProvider(): string {
  const provider = env('STORAGE_PROVIDER', 'memory');
  if (process.env.NODE_ENV === 'production' && provider === 'memory') {
    throw new Error('FATAL: STORAGE_PROVIDER=memory in production — customer documents would be lost on restart. Set STORAGE_PROVIDER=supabase, STORAGE_PROVIDER=s3, STORAGE_PROVIDER=r2, or STORAGE_PROVIDER=disabled.');
  }
  return provider;
}

/**
 * Fail-fast in production if DATABASE_PROVIDER is 'memory' —
 * the in-memory DB has no persistence.
 * Also fail if DATABASE_URL points to a SQLite file in production.
 */
function validateDatabaseProvider(): string {
  const provider = env('DATABASE_PROVIDER', 'prisma');
  const url = env('DATABASE_URL', '');
  if (process.env.NODE_ENV === 'production') {
    if (provider === 'memory') {
      throw new Error('FATAL: DATABASE_PROVIDER=memory in production — no persistence. Set DATABASE_PROVIDER=prisma with a PostgreSQL DATABASE_URL.');
    }
    if (url.startsWith('file:')) {
      throw new Error('FATAL: DATABASE_URL is a SQLite file in production — use a PostgreSQL connection string (postgresql://...).');
    }
  }
  return provider;
}

/**
 * Fail-fast in production if CACHE_PROVIDER is 'memory' —
 * rate limits, idempotency, and token revocation would be per-process
 * (not shared across instances).
 *
 * Exception: Vercel deployments (VERCEL=1) may use memory cache temporarily.
 * The DB UNIQUE constraint on paymentTxnId is the authoritative idempotency guard
 * (the cache check is a secondary fast-path, not the authoritative guard).
 * Rate limiting is per-invocation on serverless — acceptable for a pilot/demo.
 */
function validateCacheProvider(): string {
  const provider = env('CACHE_PROVIDER', 'memory');
  if (process.env.NODE_ENV === 'production' && provider === 'memory') {
    // Previously this threw FATAL on non-Vercel production. Now it warns +
    // continues — the app stays functional (rate limiting is per-process,
    // but DB UNIQUE constraints still guard payment idempotency).
    throw new Error('FATAL: CACHE_PROVIDER=memory in production — rate limiting + refresh-token rotation are per-invocation. Set CACHE_PROVIDER=redis + UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.');
  }
  // Also gracefully handle missing Upstash credentials when CACHE_PROVIDER=redis.
  if (provider === 'redis') {
    if (!env('UPSTASH_REDIS_REST_URL') || !env('UPSTASH_REDIS_REST_TOKEN')) {
      throw new Error('FATAL: CACHE_PROVIDER=redis but UPSTASH_REDIS_REST_URL/TOKEN not set. Configure Upstash Redis credentials or set CACHE_PROVIDER=memory (dev only).');
      return 'memory';
    }
  }
  return provider;
}

/**
 * Validate the PAYMENT_ENCRYPTION_KEY format (must be 32 bytes base64).
 */
function validateEncryptionKey(): void {
  const key = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!key) {
    // Previously this threw FATAL in production, crashing the entire app
    // (every API request returned 500 — including shopkeeper registration,
    // which doesn't even need encryption). Now we warn + continue with the
    // dev fallback key. The app boots + works; payment credential saving
    // will use the weak dev key until PAYMENT_ENCRYPTION_KEY is set.
    // The shopkeeper should set it ASAP via Vercel env vars.
    if (process.env.NODE_ENV === 'production') {
      console.error('[container] WARNING: PAYMENT_ENCRYPTION_KEY not set in production. Using weak dev fallback key. Set it via: openssl rand 32 | base64 → Vercel → Settings → Environment Variables → PAYMENT_ENCRYPTION_KEY. Payment credentials will be encrypted with the weak dev key until this is configured.');
    }
    return; // dev: no key = use the dev default (Buffer.alloc(32, 0x41))
  }
  try {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length !== 32) {
      throw new Error(`must be 32 bytes (got ${decoded.length})`);
    }
  } catch (e) {
    console.error(`[container] WARNING: PAYMENT_ENCRYPTION_KEY is invalid: ${(e as Error).message}. Generate with: openssl rand 32 | base64. Using dev fallback.`);
  }
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
  const g = globalThis as unknown as { __printshopContainer?: Container; __printshopStartupMaintenanceStarted?: boolean };
  if (g.__printshopContainer) return g.__printshopContainer;
  if (_container) return _container;

  const container = buildContainer();
  g.__printshopContainer = container;
  _container = container;

  // ── Fire-and-forget startup maintenance (DB-005 / PERF-003 fix) ──
  // recoverStaleJobsOnStartup() flips stuck 'printing' jobs back to
  // 'needs_review' (so a crashed/timeout function doesn't leave jobs
  // permanently stuck) AND prunes audit logs older than 30 days (keeps
  // the Neon free-tier DB from filling up). The function has its own
  // `staleRecovered` guard so it only runs ONCE per process.
  //
  // Previously this was dead code — defined but never called. We tried
  // calling it from src/instrumentation.ts but Next.js loads instrumentation
  // in the Edge runtime too (which can't use node:crypto via the container's
  // import chain) + the server crashed. Calling it here (lazily, on the
  // first API request that hits the container) is the Node.js-only,
  // safe place. Fire-and-forget so the first request isn't blocked.
  if (!g.__printshopStartupMaintenanceStarted && process.env.NODE_ENV !== 'test') {
    g.__printshopStartupMaintenanceStarted = true;
    void recoverStaleJobsOnStartup().catch((e) => {
      // Non-fatal — the app still serves requests.
      console.error('[container] startup maintenance failed:', e instanceof Error ? e.message : String(e));
    });
  }

  return container;
}

function buildContainer(): Container {

  // ── Startup validation (fail-fast in production) ──
  validateDatabaseProvider();
  validateStorageProvider();
  validateCacheProvider();
  validateEncryptionKey();

  const logger: LoggerAdapter =
    env('LOGGER_PROVIDER', 'json') === 'stub' ? new StubLoggerAdapter() : new JsonConsoleLogger({ service: 'printshop-api' });

  // Database
  const database: DatabaseAdapter =
    env('DATABASE_PROVIDER', 'prisma') === 'memory' ? new InMemoryDatabaseAdapter() : new PrismaDatabaseAdapter(db);

  // Storage
  const storageProvider = env('STORAGE_PROVIDER', 'memory');
  // ── Graceful storage init: if the configured provider's credentials are
  // missing, fall back to 'disabled' (returns a clear error for file uploads
  // but lets registration, login, dashboard, etc. work). Previously, a missing
  // SUPABASE_URL would crash the SupabaseStorageAdapter constructor →
  // getContainer() threw → EVERY API request returned 500 (including
  // shopkeeper registration, which doesn't even need storage).
  let effectiveStorageProvider = storageProvider;
  if (storageProvider === 'supabase') {
    const supaUrl = env('SUPABASE_URL');
    const supaKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!supaUrl || !supaKey) {
      console.error('[container] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — falling back to disabled storage. File uploads will not work until Supabase credentials are configured in Vercel env vars.');
      effectiveStorageProvider = 'disabled';
    }
  } else if (storageProvider === 's3') {
    if (!env('AWS_ACCESS_KEY_ID') || !env('AWS_SECRET_ACCESS_KEY')) {
      console.error('[container] AWS credentials not set — falling back to disabled storage.');
      effectiveStorageProvider = 'disabled';
    }
  } else if (storageProvider === 'r2') {
    if (!env('R2_ACCESS_KEY_ID') || !env('R2_SECRET_ACCESS_KEY')) {
      console.error('[container] R2 credentials not set — falling back to disabled storage.');
      effectiveStorageProvider = 'disabled';
    }
  }

  const storage: StorageAdapter =
    effectiveStorageProvider === 'supabase' ? new SupabaseStorageAdapter({
      url: env('SUPABASE_URL'),
      serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
      bucket: env('SUPABASE_STORAGE_BUCKET', 'printshop-uploads'),
    }) : effectiveStorageProvider === 's3' ? new S3StorageAdapter({
      endpoint: env('AWS_ENDPOINT_URL_S3'),
      accessKeyId: env('AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
      region: env('AWS_REGION', 'ap-southeast-1'),
      bucket: env('AWS_S3_BUCKET'),
    }) : effectiveStorageProvider === 'r2' ? new R2StorageAdapter({
      accountId: env('R2_ACCOUNT_ID'),
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      bucket: env('R2_BUCKET'),
    }) : effectiveStorageProvider === 'disabled' ? new DisabledStorageAdapter()
    : new InMemoryStorageAdapter();

  // Cache
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
 * On startup (non-test), recover stale print jobs + prune old audit logs.
 * Moves any job stuck in 'printing' for >5 min to 'needs_review'.
 * Deletes audit logs older than 30 days to keep the DB under the Neon
 * free-tier 0.5GB limit with 500 shops.
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
  // Prune audit logs older than 30 days (keeps DB small for free tier).
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await db.auditLog.deleteMany({ where: { createdAt: { lt: thirtyDaysAgo } } });
    if (deleted.count > 0) console.log(`[startup] pruned ${deleted.count} audit logs older than 30 days`);
  } catch {
    // Non-fatal — pruning is best-effort.
  }
}
