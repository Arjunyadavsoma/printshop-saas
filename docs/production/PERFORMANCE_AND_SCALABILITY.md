# Performance & Scalability

> Performance characteristics, known limits, and optimisation opportunities for the
> PrintShop SaaS app running on **Vercel Hobby** + **Supabase PostgreSQL** (free tiers).
> Every claim cites the file + line. Optimisations are ordered by **effort : impact**.

---

## 1. Database layer

### 1.1 Connection pool

`DATABASE_URL` points at the **Supabase pooler on port 6543** (PgBouncer,
transaction mode). Prisma is constructed lazily in `src/lib/db.ts` and cached
on `globalThis` so the client survives Next.js dev hot-reloads:

```ts
// src/lib/db.ts
export const db = globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query'],
  });
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

On Vercel serverless, every invocation gets its own Prisma client but they all
share PgBouncer's pool. Hobby's concurrency cap is well within the default
pooler size. **Risk:** Supabase free tier kills idle pooler connections after
~30 s — the first cold request after idle may see a one-shot latency spike.

### 1.2 N+1 queries (fixed)

The analytics route previously called `findByOrder(orderId)` in a loop — up
to 200 sequential SELECTs per dashboard refresh (measured ~50 on the demo
dataset). The fix is shipped: `FileRepository.findByOrderIds()` does a single
`WHERE orderId IN (...)` query and returns a `Map<orderId, PrintFile[]>`.

```ts
// src/lib/repositories/file.repository.ts (lines 59–74)
async findByOrderIds(orderIds: string[]): Promise<Map<string, PrintFile[]>> {
  const rows = await this.findMany({ orderId: { in: orderIds } }, { order: ['createdAt', 'asc'] });
  // …group into a Map…
}
// src/app/api/v1/shops/me/analytics/route.ts (lines 28–40)
const filesByOrder = await repos.files.findByOrderIds(paid.map((o) => o.id));
```

**Remaining N+1 risk:** `repos.shops.getByOwner(principal.userId)` is called
inside every `withAuth` handler. The analytics + orders routes then call it
again via the entitlements import on the same request. Cache the shop lookup
on the `Principal` object after `withAuth` resolves it.

### 1.3 Pagination & unbounded fetches

| Route | Strategy | Cap | Source |
|---|---|---|---|
| `GET /shops/me/orders` | `limit`/`offset` from query | `min(limit, 200)` | `shops/me/orders/route.ts:12` |
| `GET /shops/me/analytics` | Fixed fetch of 200 orders, no pagination | 200 then JS filter | `shops/me/analytics/route.ts:15` |
| `GET /metrics` (admin) | Fixed fetch of 500 orders | same pattern | `metrics/route.ts:24` |
| `OrderRepository.listByShop` | default `limit: 50` | repo-level | `order.repository.ts:67` |

**The analytics route silently caps at 200 orders.** Once a shop crosses ~200
lifetime orders, revenue + status-mix numbers will be **wrong** (underreported)
with no warning surfaced. Fix options (in order of preference):

1. Replace the JS reduce with SQL aggregation — `SUM(totalAmountPaise) GROUP BY status`. One query, N rows instead of 200.
2. Stream with cursor pagination, aggregate server-side.
3. At minimum: return `meta.truncated: true` when `all.length === 200` so the UI warns the shopkeeper.

### 1.4 Indexes

`prisma/schema.prisma` declares `@@index` entries covering the hot paths:
- `Order` — `[shopId, status]`, `[customerToken]`, unique `[shopId, tokenNumber]`
- `PrintFile` — `[orderId]`
- `PrintJob` — `[shopId, status]`, `[agentId]`
- `PrintAgent` — `[shopId, isOnline]`
- `AuditLog` — `[shopId, createdAt]`
- `PaymentAttempt` — `[shopId, status]`, `[orderId]`, `[providerTransactionId]`
- `PaymentEvent` — `[attemptId]`, `[merchantOrderId]`, unique `[provider, eventId]`
- `Customer` — `[shopId, updatedAt]`, `[shopId, deletedAt]`
- `PrintDeliveryAttempt` — `[shopId, status]`, `[agentId]`, `[printJobId]`
- `FileCleanupTask` — `[shopId, status]`, `[scheduledAt]`, `[printFileId]`

**Missing indexes worth adding:**

- `Order.createdAt` — `listByShop` orders by `createdAt DESC` but the existing `[shopId, status]` index is **not** optimal for unfiltered `ORDER BY createdAt`. Add `@@index([shopId, createdAt])`.
- `PaymentAttempt.expiresAt` — cleanup logic queries by `expiresAt`; no index.
- `PrintAgent.tokenHash` — looked up on every device-authenticated request (`withDeviceAuth` in `with-auth.ts:117`). Currently a sequential scan.

### 1.5 Query logging

`PrismaClient` is configured `log: ['warn', 'error']` in production — no
`query` events, so SQL structure never reaches stdout. In dev, `['query']`
is enabled for debugging. To surface slow queries in production, switch to
`['warn', 'error', { level: 'query', emit: 'event' }]` and forward slow
events (`duration > 200ms`) to the JSON logger.

---

## 2. Client bundle

`package.json` ships these heavy deps to the browser:
- `react@19` + `react-dom@19` — ~140 KB gz (core)
- `@radix-ui/*` (27 packages) — ~80 KB gz combined (tree-shakable per-component)
- `recharts@2.15` — ~100 KB gz (dashboard charts)
- `pdfjs-dist@6.4` — ~350 KB gz + worker (**lazy-loaded**)
- `framer-motion@12.23` — ~50 KB gz (animations)
- `@mdxeditor/editor` — ~200 KB gz (admin/explorer)

**Mitigations already in place:**

- `pdfjs-dist` is loaded via `await import('pdfjs-dist')` inside `PdfPreview.loadPdf()` (`src/components/portal/pdf-preview.tsx:82`). The worker is constructed from `new URL(..., import.meta.url)` so Next.js emits it as a separate chunk. **PDF.js never enters the initial bundle.**
- `next.config.ts` sets `output: "standalone"` → self-contained server bundle.

**Still expensive:**

- `recharts` is imported at the top of `src/app/shop/dashboard/page.tsx` and ships even when the analytics card isn't rendered. Wrap the chart in `next/dynamic({ ssr: false })`.
- `@mdxeditor/editor` is admin-only; Next 16 will code-split it — verify with `next build`'s route-size report.
- The dashboard page is `'use client'` — see §4.

**Audit command:**
```bash
bunx next build           # prints route sizes
ANALYZE=true bunx next build  # with @next/bundle-analyzer (not yet installed)
```

---

## 3. Serverless limits (Vercel Hobby)

| Limit | Value | Impact |
|---|---|---|
| Function duration | **10 s** | Analytics on a 500-order shop will time out |
| Function memory | 1 GB | Prisma + pdf-lib fits comfortably |
| Concurrent invocations | shared pool | Polling (§4) multiplies effective load |
| Region | `bom1` (Mumbai) | single region, no edge replicas |
| Cold start | ~300–800 ms | first request after idle pays Prisma init |

**The 10-second ceiling is the binding constraint.** `/api/v1/shops/me/analytics` (fetches 200 orders + 200× files + histogram) takes 2–4 s on a busy shop; a slow Supabase pooler connection can push it past 10 s on a cold start. `/api/v1/metrics` (500 orders + 200 print jobs + all agents) is similar. Both should be re-implemented as SQL aggregations (see §1.3).

---

## 4. Polling

The shop UI polls the API on **six intervals**:

| Page | Interval | Endpoint | Source |
|---|---|---|---|
| Dashboard | 15 s | `/shops/me` + `/analytics` | `shop/dashboard/page.tsx:184` |
| Orders list | 20 s | `/shops/me/orders` | `shop/orders/page.tsx:211` |
| Order detail | **5 s** | `/shops/me/orders/[id]` | `shop/orders/[id]/page.tsx:273` |
| Printer status | one-shot | native / printlatch client | `shop/dashboard/page.tsx:191` |
| Notes save debounce | 3 s | PUT activity | `shop/orders/[id]/page.tsx:370` |
| Toast auto-dismiss | 2 s after action | client-only | `shop/orders/[id]/page.tsx:417` |

The order-detail 5 s interval is reasonable while a print job is mid-flight (watching `printing` → `ready`), but once the order reaches a terminal state (`collected`, `cancelled`) it should stop or slow to 30 s. Today it runs forever until the tab is closed.

### 4.1 The hidden-tab problem

None of the `useEffect` intervals check `document.visibilityState`. A shopkeeper who leaves the dashboard tab open in the background **continues to hit the API every 5–20 s** — multiplied across N shopkeepers, this is a meaningful load on Vercel Hobby's invocation pool and the Supabase pooler.

```ts
// Current pattern (every page):
useEffect(() => {
  void load();
  const id = setInterval(() => void load(true), 15_000);
  return () => clearInterval(id);
}, []);

// Recommended fix — pause on hidden, resume on visible:
useEffect(() => {
  void load();
  const tick = () => { if (!document.hidden) void load(true); };
  const id = setInterval(tick, 15_000);
  document.addEventListener('visibilitychange', tick);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
}, []);
```

Even better: switch to **`react-query` (already a dependency!)** with `refetchInterval` + `refetchIntervalInBackground: false` — handles visibility, dedup, and retries in one declarative config.

---

## 5. Architectural recommendations

### 5.1 Convert client components to server components

`src/app/shop/dashboard/page.tsx`, `orders/page.tsx`, and `orders/[id]/page.tsx` are all `'use client'` at line 1 — they load data via `useApiClient`, render, poll. Server components would eliminate the **initial** client→server fetch (data is streamed inline in the RSC payload).

Migration path: split each page into a server-component shell that fetches initial data via `repos.*` (calling `getContainer()` server-side is supported), wrap the live-updating section in a `<ClientPoller initial={data}>` component that only re-fetches on the interval, and use `next/headers` cookies to read the JWT and call `repos` directly — no HTTP round-trip for the first paint.

### 5.2 Add a `document.hidden` check to every interval

See §4.1. Cheap, no architectural change, immediate 30–60% load reduction on a multi-shopkeeper deployment.

### 5.3 Replace JS-side aggregation with SQL

`/analytics` and `/metrics` should use Prisma `groupBy`:

```ts
await db.order.groupBy({
  by: ['status'],
  where: { shopId, status: { notIn: ['cancelled', 'awaiting_payment'] } },
  _sum: { totalAmountPaise: true },
  _count: true,
});
```

Drops analytics latency from ~1.5 s to ~50 ms on a 200-order shop.

### 5.4 Cache the analytics result

Analytics doesn't change minute-to-minute. Wrap the route in a 60-second cache via the existing `CacheAdapter` (`getContainer().cache`). Stale data for 60 s is acceptable for a dashboard chart.

---

## 6. Quick wins (ordered)

| # | Effort | Impact | Action |
|---|---|---|---|
| 1 | 10 min | High | Add `document.hidden` check to all 3 polling intervals |
| 2 | 30 min | High | Stop polling once order reaches terminal status |
| 3 | 1 h | High | Add `@@index([shopId, createdAt])` to Order + migrate |
| 4 | 2 h | High | Rewrite `/analytics` with `groupBy` + 60 s cache |
| 5 | 1 h | Medium | `next/dynamic` the `recharts` import on the dashboard |
| 6 | 4 h | Medium | Convert dashboard page to server component + client poller |
| 7 | 1 h | Low | Add `@next/bundle-analyzer` + document baseline sizes |
| 8 | 2 h | Low | Surface `meta.truncated: true` when analytics hits the 200 cap |

---

## 7. Capacity ceiling (back-of-envelope)

Assuming 50 active shops × 1 concurrent shopkeeper each:

- **Polling load:** 50 shops × (1/15 s + 1/20 s + ~1/5 s for active order detail)
  ≈ **12 req/s steady-state**. Vercel Hobby handles this fine.
- **DB connections:** 12 req/s × ~100 ms/query = ~1.2 concurrent connections.
  Supabase free pooler caps at ~200. Lots of headroom.
- **Storage:** 1 GB on Supabase Storage. Cleanup cron keeps it bounded — PDFs
  are deleted 15 min after verified receipt. Sustainable for ~5k orders/day.

The first wall you'll hit is **Vercel function duration** (10 s) when a single
shop grows past ~500 orders and the analytics route trips the timeout. That's
the trigger to do quick-win #4.
