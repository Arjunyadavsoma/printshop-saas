# Cloudflare Workers + R2 Migration Guide

> Future migration path from Vercel + Neon + (R2/Supabase) to Cloudflare Workers + Neon + R2.
>
> **Status: NOT MIGRATED.** This is a planning document — no Cloudflare Workers code has been written.

---

## 1. Why migrate?

| Current (Vercel) | Target (Cloudflare Workers) | Benefit |
|---|---|---|
| Serverless functions (10s timeout) | Workers (30s CPU, no cold start) | Faster uploads, no cold starts |
| Vercel Hobby (limited builds) | Workers (free 100K req/day) | Lower cost at scale |
| Separate realtime service needed | Durable Objects (built-in) | Simpler realtime |
| Upstash Redis (external) | KV (built-in) | Fewer services |

## 2. What stays the same

- **Database:** Neon PostgreSQL (connection via `@neondatabase/serverless` driver — works on Workers).
- **Storage:** Cloudflare R2 (already the production storage adapter).
- **Architecture:** The adapter-pattern design means the business logic doesn't change — only the adapters.
- **Prisma:** Prisma 6.x supports Neon's serverless driver via `@prisma/adapter-pg` with `@neondatabase/serverless`.

## 3. Required changes

### 3a. Next.js → Cloudflare Pages with Workers

Next.js 16 supports the `@cloudflare/next-on-pages` adapter. The migration:

1. Install `@cloudflare/next-on-pages`:
   ```bash
   bun add -D @cloudflare/next-on-pages
   ```

2. Add build script:
   ```json
   "scripts": {
     "cf-build": "next-on-pages"
   }
   ```

3. Create `wrangler.toml`:
   ```toml
   name = "printshop-saas"
   compatibility_flags = ["nodejs_compat"]
   compatibility_date = "2024-01-01"
   ```

4. Deploy:
   ```bash
   npx wrangler pages deploy .vercel/output/static
   ```

### 3b. Database driver

The current Prisma client uses the standard `pg` driver. On Workers, use Neon's serverless driver:

1. Install the Prisma Neon adapter:
   ```bash
   bun add @prisma/adapter-neon @neondatabase/serverless
   ```

2. Update `src/lib/db.ts`:
   ```ts
   import { PrismaNeon } from '@prisma/adapter-neon';
   import { Pool, neonConfig } from '@neondatabase/serverless';
   import { PrismaClient } from '@prisma/client';

   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   const adapter = new PrismaNeon(pool);

   export const db = new PrismaClient({ adapter });
   ```

3. The Neon serverless driver uses HTTP/WebSockets (not TCP), which is Workers-compatible.

### 3c. Cache (Upstash → Cloudflare KV)

The `CacheAdapter` interface is already defined. Create a `KvCacheAdapter`:

```ts
import { KVNamespace } from '@cloudflare/workers-types';

export class KvCacheAdapter implements CacheAdapter {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.kv.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  }
  // ... del, incr (KV doesn't have atomic incr — use Durable Objects)
}
```

Note: KV doesn't support atomic `incr` — rate limiting needs Durable Objects or a different approach.

### 3d. Realtime (separate service → Durable Objects)

The `RealtimeAdapter` interface can be backed by Durable Objects:

```ts
export class DurableObjectRealtimeAdapter implements RealtimeAdapter {
  // Durable Objects support WebSocket connections natively.
  // No need for a separate socket.io service.
}
```

This eliminates the need for the Render-hosted realtime mini-service.

### 3e. Storage (R2 — no change needed)

The R2 adapter already uses `@aws-sdk/client-s3` pointed at R2's S3-compatible API. On Workers, use the native R2 binding instead of the AWS SDK:

```ts
// wrangler.toml:
// [[r2_buckets]]
// binding = "R2_BUCKET"
// bucket_name = "printshop-prod"

// In the adapter:
const r2 = env.R2_BUCKET as R2Bucket;
await r2.put(key, fileBytes);
```

This is faster (no HTTP round-trip) and free (R2→Workers is internal).

## 4. Migration checklist

- [ ] Verify `@cloudflare/next-on-pages` supports Next.js 16
- [ ] Test the Neon serverless driver on Workers
- [ ] Implement `KvCacheAdapter` (or use Upstash — it works on Workers too)
- [ ] Implement Durable Object realtime adapter
- [ ] Switch R2 adapter from AWS SDK to native R2 binding
- [ ] Test all three portals on Workers
- [ ] Run the concurrency + idempotency tests against Neon via Workers
- [ ] Verify upload/download via R2 binding
- [ ] Update `wrangler.toml` with the correct env vars + bindings
- [ ] Deploy to Cloudflare Pages

## 5. What CANNOT be ported

- **Print agent:** runs on the shopkeeper's PC (not on Workers). No change needed — it connects to the app via HTTP.
- **Dev simulate payment routes:** guarded by `requireDev()` → 404 in production. No change needed.

## 6. Estimated effort

| Task | Effort |
|---|---|
| Next.js → Workers adapter | 2-4 hours |
| Prisma → Neon serverless driver | 1 hour |
| R2 adapter (AWS SDK → native) | 1 hour |
| KV cache adapter | 2 hours |
| Durable Object realtime | 4-8 hours |
| Testing | 4-8 hours |
| **Total** | **~2-3 days** |

The adapter-pattern architecture means most of the work is in the adapter layer — the business logic (pricing, orders, payments, print jobs) stays untouched.
