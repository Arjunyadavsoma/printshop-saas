# Rate Limiting — Production Reality

## TL;DR

On Vercel serverless, rate limiting is **per-invocation**, not global. The
`UpstashCacheAdapter` is wired up and ready, but `REDIS_URL` is not configured
on Vercel, so the app falls back to `InMemoryCacheAdapter` — which counts
requests inside a single Lambda invocation, not across invocations.

This is an explicitly-acknowledged pilot/demo limitation, NOT a silent
failure. The container's `validateCacheProvider()` warns at boot:

```
[vercel] CACHE_PROVIDER=memory — rate limiting is per-invocation.
DB UNIQUE constraints still guard payment idempotency.
```

The DB-level guards (UNIQUE constraints) are the authoritative safety net
and DO work globally — they don't depend on the cache.

## Endpoints protected (rate-limit scopes)

All public + write endpoints apply `withRateLimit` / `rateLimit`:

| Scope            | Limit   | Endpoint                                | Purpose                          |
| ---------------- | ------- | --------------------------------------- | -------------------------------- |
| `register`       | 5/60s   | POST /api/v1/auth/register              | Shop signup abuse                |
| `slug-check`     | 30/60s  | GET  /api/v1/auth/register/check-slug  | Slug-debounce probe             |
| `login`          | 20/60s  | POST /api/v1/auth/login                 | Credential stuffing             |
| `create-order`   | 20/60s  | POST /api/v1/shops/:slug/orders         | Order-spam (per-IP)             |
| `checkout`       | 20/60s  | POST /api/v1/orders/:id/checkout        | Payment-intent abuse             |
| `upload-url`     | 30/60s  | POST /api/v1/orders/:id/files/upload-url| Upload-URL minting              |
| `confirm-file`   | 30/60s  | POST /api/v1/orders/:id/files           | File registration               |
| `patch-file`     | 60/60s  | PATCH /api/v1/orders/:id/files/:fileId  | File-settings update            |
| `status`         | 120/60s | GET  /api/v1/orders/:id/status          | Customer polling (relaxed)       |
| `upi-verify`     | 60/60s  | GET  /api/v1/payments/upi/verify/:id    | UPI status fallback poll         |
| `shops-list`     | 60/60s  | GET  /api/v1/shops                       | Public shop discovery           |
| `shop-info`      | 60/60s  | GET  /api/v1/shops/:slug                 | Public shop details             |
| `qr`             | 60/60s  | GET  /api/v1/qr                          | Public QR generation            |
| `metrics`        | 60/60s  | GET  /api/v1/metrics                     | Public metrics                  |
| `ready`          | 30/60s  | GET  /api/v1/ready                       | Liveness probe                  |
| `phonepe-simulate` | 20/60s| POST /api/v1/payments/dev/phonepe/simulate | Dev-only (requireDev)        |
| `paytm-simulate` | 20/60s  | POST /api/v1/payments/dev/paytm/simulate | Dev-only (requireDev)           |
| `mark-paid`      | 20/60s  | POST /api/v1/dev/orders/:id/mark-paid   | Dev-only (requireDev)            |

Authenticated shopkeeper endpoints (`/api/v1/shops/me/*`, `/api/v1/admin/*`)
are NOT rate-limited at the HTTP layer — they're guarded by JWT auth +
role checks. The blast radius of a single shopkeeper's actions is bounded by
their tenant scope.

## What the cache guards vs. what the DB guards

| Concern                                   | Cache-backed (per-invocation on Vercel) | DB-backed (global, authoritative) |
| ----------------------------------------- | --------------------------------------- | -------------------------------- |
| Per-IP request flooding                   | ✓ (rate limit counter)                  | ✗ (no per-IP table)              |
| Payment-webhook replay (same txnId)       | ✓ (fast-path skip)                      | ✓ (`Order.paymentTxnId` UNIQUE)  |
| Concurrent print-job dispatch             | ✗                                       | ✓ (`PrintJob_active_file_unique` partial index) |
| Order-token allocation race               | ✗                                       | ✓ (`Order_shop_tokenNumber_unique` partial index) |
| Stale token revocation (logout)           | ✓                                      | ✗ (not stored in DB)             |
| Slug collision on shop creation           | ✗                                       | ✓ (`Shop.slug` UNIQUE)           |
| Email collision on user creation          | ✗                                       | ✓ (`User.email` UNIQUE)          |

**Bottom line:** the DB-level guards protect against the genuinely dangerous
races (duplicate payments, duplicate tokens, duplicate slugs). The cache
guards are defense-in-depth — fast-path for the common case, not the
authoritative guard.

## Why we don't silently switch to Redis

The user prompt explicitly says:

> Implement a shared rate limiter **only if a supported, configured provider
> is available and authorized**. Otherwise, document the limitation and
> apply appropriate existing database-backed safeguards **without pretending
> they provide comprehensive rate limiting**.

Upstash Redis is supported (the `UpstashCacheAdapter` is wired up in
`src/lib/container.ts`) but NOT configured on Vercel — there's no
`REDIS_URL`/`REDIS_TOKEN` env var set. Setting those up is a paid
infrastructure decision the user has NOT authorized.

The current setup is the honest middle ground: the cache exists, works
correctly per-invocation, and the DB guards protect the actually-dangerous
races. To upgrade to global rate limiting, the operator sets:

1. Create an Upstash Redis account (free tier: 10K commands/day)
2. Set `REDIS_URL` and `REDIS_TOKEN` on Vercel
3. Set `CACHE_PROVIDER=redis` on Vercel (replace `memory`)
4. Redeploy

No code changes required — `validateCacheProvider()` will then stop
warning and use the shared cache.

## False-positive risk on legitimate retries

The order-token allocation retry loop (in `OrderRepository.createWithUniqueToken`)
makes 1-8 DB INSERTs inside a SINGLE HTTP request. The rate limiter counts
the HTTP request (1), NOT the internal retries. A shopkeeper clicking
"Create Order" 20 times in 60s would hit the limit; a single retry-prone
order creation does not.

The webhook idempotency check (`pay:done:provider:txnId` cache GET) is a
read, not a rate-limit increment. Webhook redelivery (PhonePe/Paytm retry)
does NOT increment any rate limit. ✓ No false-positive block on legitimate
retries.

## Recommendation for the production release

**Acceptable for authorized production promotion** with the documented
caveat that per-IP rate limiting is per-invocation on Vercel. The DB
constraints are the authoritative guard for the actually-dangerous races
(duplicate payments, duplicate tokens).

**Before scaling beyond pilot traffic**, the operator should configure
Upstash Redis (free tier is sufficient for a pilot) to enable global
rate limiting. This is a configuration change, not a code change.
