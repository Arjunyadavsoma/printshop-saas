# PrintShop SaaS — Security Audit (OWASP Top 10)

> Comprehensive security audit covering OWASP Top 10 (2021). For each finding: ID, severity, file path, current behavior, expected behavior, risk, fix. References and supersedes `docs/SECURITY_ASSESSMENT.md` (v1.0).

**Audit date:** 2025-11-08 · **Commit:** `dc24f4b`
**Severity scale:** P0 (critical/release-blocker) · P1 (high) · P2 (medium) · P3 (low)
**Evidence labels:** VERIFIED, IMPLEMENTED, BLOCKED, NOT VERIFIED

---

## Summary

| Severity | Count | Status |
|---|---|---|
| P0 | 0 | All known P0s already fixed (SEC-001 through SEC-004) |
| P1 | 3 | Open: subscription enforcement, PaymentAttempt wiring, realtime deployment |
| P2 | 6 | Open: documented gaps, defense-in-depth |
| P3 | 4 | Low-priority improvements |

---

## OWASP A01 — Broken Access Control

### SEC-001 (P0, FIXED) — Customer order IDOR
- **File:** `src/lib/api/with-order-access.ts:1-97`
- **Was:** customer order routes were UNAUTHENTICATED — UUID in URL was the only "credential"
- **Now:** every customer order route goes through `withOrderAccess` — requires per-order `customerToken` (constant-time compared via `timingSafeEqual`, line 86). Mismatch → 403 (not 404, hides order existence).
- **Risk if reverted:** attacker reads order status, downloads receipts, uploads malicious PDFs, re-prices files
- **Status:** VERIFIED — code present + PRODUCTION_READINESS_AUDIT.md:257-260 confirms

### SEC-010 (P2, OPEN) — Admin routes accept any authenticated role on `/shops/me/*`
- **File:** `src/app/api/v1/shops/me/analytics/route.ts:9` (no role restriction)
- **Current:** `withAuth` called without `['owner']` on some `/shops/me/*` routes — staff can access analytics, reports
- **Expected:** all `/shops/me/*` routes pass `['owner']` (or specific role) for defense-in-depth
- **Risk:** staff role can view shop financials (intended?) — depends on business policy
- **Fix:** add `['owner']` to `withAuth` calls on sensitive `/shops/me/*` routes
- **Status:** VERIFIED — partial gap; some routes do (`reports/daily/route.ts:73`), others don't (`analytics/route.ts:9`)
- **Reference:** `docs/SECURITY_ASSESSMENT.md:268`

### SEC-011 (P2, OPEN) — `/api/v1/db-health` is public
- **File:** `src/app/api/v1/db-health/route.ts`
- **Current:** returns env-var presence flags + masked `DATABASE_URL` without auth
- **Expected:** admin-only endpoint
- **Risk:** minor information disclosure (masked, no secrets)
- **Fix:** require admin auth or remove the endpoint
- **Status:** VERIFIED — `docs/KNOWN_LIMITATIONS.md:127-130`

### SEC-012 (P2, OPEN) — Soft-404 on admin login
- **File:** `src/app/admin/login/page.tsx`
- **Current:** admin login returns HTTP 200 with a fake 404 page (security-through-obscurity)
- **Expected:** acceptable if intentional; document the choice
- **Risk:** low — obscures admin endpoint existence
- **Status:** VERIFIED — `docs/SECURITY_ASSESSMENT.md:265`

---

## OWASP A02 — Cryptographic Failures

### SEC-013 (P0, IMPLEMENTED) — Password storage
- **File:** `src/lib/auth/jwt-auth.adapter.ts:7-98`
- **Algorithm:** PBKDF2-SHA256, 600,000 iterations (OWASP 2023), 16-byte salt, 32-byte key
- **Verification:** constant-time XOR-OR diff
- **Status:** VERIFIED — meets OWASP 2023 recommendation

### SEC-014 (P0, IMPLEMENTED) — Payment credential encryption
- **File:** `src/lib/crypto/credential-encryption.ts`
- **Algorithm:** AES-256-GCM via `createCipheriv`
- **Format:** `v1:<nonceHex>:<ciphertextHex>:<tagHex>` (key versioning for rotation)
- **Production fail-safe:** non-`v1:` credentials in production → FATAL log + empty creds (no plaintext leak)
- **Status:** VERIFIED

### SEC-015 (P0, IMPLEMENTED) — Device token storage
- **File:** `src/lib/api/with-auth.ts:108-127` (`withDeviceAuth`)
- **Algorithm:** HMAC-SHA256('print-agent-salt', token) → hex digest stored in `PrintAgent.tokenHash`
- **Plaintext token:** returned ONCE at registration (`src/app/api/v1/agents/register/route.ts:33`), never stored
- **Note:** the salt `'print-agent-salt'` is a domain separator, not a secret — security comes from the 72-char UUID pair
- **Status:** VERIFIED

### SEC-016 (P1, OPEN) — JWT secrets not rotated
- **Current:** single `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` with no rotation mechanism
- **Expected:** key-versioning mechanism in the JWT verifier (header `kid` to support multiple accepted keys during rotation)
- **Risk:** if a secret leaks, rotation requires hard logout of all users
- **Fix:** add `kid` header support to verifier; document rotation procedure
- **Status:** NOT VERIFIED — `docs/SECURITY_ASSESSMENT.md:281`

---

## OWASP A03 — Injection

### SEC-017 (P0, IMPLEMENTED) — SQL injection prevented by Prisma
- **Current:** all DB access through `src/lib/repositories/*` using Prisma's parameterized queries
- **No raw SQL** in route handlers (rule enforced by codebase convention)
- **Status:** VERIFIED — `docs/SECURITY_ASSESSMENT.md:95`

### SEC-018 (P2, OPEN) — XSS via inline scripts
- **File:** `src/middleware.ts:64-66`
- **Current:** CSP allows `script-src 'self' 'unsafe-inline'` (Next.js 16 requires `unsafe-inline` for hydration scripts)
- **Expected:** ideally `unsafe-inline` removed, but Next.js 16 architecture requires it
- **Mitigation:** `'unsafe-eval'` is excluded from production; no user-generated HTML rendered without escaping (React JSX escapes by default)
- **Risk:** low — React escapes by default; CSP is defense-in-depth
- **Status:** VERIFIED — documented constraint

---

## OWASP A04 — Insecure Design

### SEC-009 (P1, OPEN) — No entitlements enforcement
- **Current:** `Shop.subscriptionTier` is informational only; `Subscription` model is vestigial (zero repos use it)
- **Expected:** `requireEntitlement('feature')` middleware gates routes by tier
- **Risk:** free-tier shops can use all features; no usage limits
- **Fix:** see `SUBSCRIPTION_GAP_ANALYSIS.md` (Phase A wiring)
- **Status:** VERIFIED — `docs/SECURITY_ASSESSMENT.md:267`

### SEC-019 (P1, OPEN) — `PaymentAttempt` not wired (cache-only webhook lookup)
- **File:** `src/lib/payments/webhook.service.ts:27-35`
- **Current:** `merchantOrderId → orderId` mapping lives in cache only (10-min TTL)
- **Expected:** DB-backed `PaymentAttempt.findOne({merchantOrderId})` as primary lookup
- **Risk:** delayed webhooks (>10 min) or Vercel cold starts lose the mapping → webhook 404s → payment lost
- **Fix:** replace `lookupPaymentSession` with DB-primary lookup
- **Status:** VERIFIED — `docs/KNOWN_LIMITATIONS.md:55-58`

---

## OWASP A05 — Security Misconfiguration

### SEC-007 (P2, OPEN) — `/api/v1/db-health` public (see SEC-011)

### SEC-006 (P2, OPEN) — Soft-404 on admin login (see SEC-012)

### SEC-020 (P2, OPEN) — `next.config.ts` `ignoreBuildErrors: true`
- **File:** `next.config.ts:7`
- **Current:** TypeScript errors are masked at build time (though `tsc --noEmit` passes clean independently)
- **Expected:** remove the flag after verifying `next build` passes clean
- **Risk:** type errors could ship to production silently
- **Status:** VERIFIED — `docs/KNOWN_LIMITATIONS.md:65-68`

### SEC-021 (P3, OPEN) — `migration_lock.toml` provider mismatch
- **File:** `prisma/migrations/migration_lock.toml`
- **Current:** declares `provider = "sqlite"`; production is PostgreSQL
- **Risk:** `prisma migrate deploy` would fail or apply wrong SQL
- **Fix:** change to `provider = "postgresql"` and baseline history
- **Status:** VERIFIED — `docs/PRODUCTION_READINESS_AUDIT.md:21-32` (finding C1)

---

## OWASP A06 — Vulnerable and Outdated Components

### SEC-022 (P3, OPEN) — Unused `next-auth` dependency
- **File:** `package.json`
- **Current:** `next-auth@^4.24.11` installed but unused (custom JWT stack)
- **Risk:** unnecessary attack surface + bundle bloat
- **Fix:** remove from `package.json`
- **Status:** VERIFIED — `docs/KNOWN_LIMITATIONS.md:99-102`

### SEC-023 (P3, OPEN) — Dead dependencies
- `@mdxeditor/editor`, `next-intl`, `@reactuses/core` — installed but unused
- **Fix:** remove from `package.json`

---

## OWASP A07 — Identification and Authentication Failures

### SEC-024 (P0, IMPLEMENTED) — JWT auth + refresh rotation
- **File:** `src/lib/auth/jwt-auth.adapter.ts:102-186`
- **Access token TTL:** 15 min
- **Refresh token TTL:** 30 days, single-use (jti replay-guarded via cache)
- **Stale-token guard:** if `claims.shopId !== user.shopId` → reject (defends against shop reassignment)
- **Status:** VERIFIED

### SEC-025 (P1, OPEN) — Rate limiting is per-invocation on Vercel
- **File:** `src/lib/api/rate-limit.ts`
- **Current:** `InMemoryCacheAdapter` — rate limits reset on each serverless cold start
- **Limits:** login 20/60s, register 5/60s, checkout 20/60s, upload-url 30/60s, status poll 120/60s, shops list 60/60s
- **Expected:** distributed rate limiting via Upstash Redis
- **Risk:** brute-force attacks more effective on serverless (per-invocation limits)
- **Fix:** configure `UpstashRedisAdapter` (already exists at `packages/adapters/src/cache/upstash.adapter.ts`)
- **Status:** VERIFIED — `docs/SECURITY_ASSESSMENT.md:199`

---

## OWASP A08 — Software and Data Integrity Failures

### SEC-026 (P0, IMPLEMENTED) — Webhook signature verification
- **PhonePe v1:** X-VERIFY (SHA-256 + base64 + salt) — `packages/adapters/src/payment/phonepe.adapter.ts`
- **PhonePe v2:** SHA-256(username:password) — `src/lib/payments/phonepe-v2-webhook.ts:55-69`
- **Paytm:** CHECKSUMHASH (AES-128-CBC + SHA-256) — `packages/adapters/src/payment/paytm.adapter.ts`
- **Fail-closed:** if env vars unset, webhooks rejected
- **Status:** VERIFIED

### SEC-027 (P0, IMPLEMENTED) — Webhook idempotency (4 layers)
- DB-level: `Order.paymentTxnId @unique` (`prisma/schema.prisma:83`)
- Cache: `pay:done:{provider}:{txnId}` 24h TTL (`webhook.service.ts:161, 262`)
- Race-safe: `transitionStatus(order.id, shop.id, 'awaiting_payment', ...)` (line 224)
- UNIQUE catch: `isUniqueConstraintError` → idempotent skip (lines 247-256)
- **Status:** VERIFIED — see `FINANCIAL_REPORTING_AUDIT.md` §3

### SEC-028 (P0, IMPLEMENTED) — Amount validation mandatory
- **File:** `src/lib/payments/webhook.service.ts:182-206`
- **Was:** `if (v.amountPaise !== null && ...)` — skipped validation when amount missing
- **Now:** missing amount → 400 reject; mismatch → 400 reject
- **Status:** VERIFIED

### SEC-029 (P2, OPEN) — PrintEXE integrity not checked
- **Current (PrintEXE):** no tamper detection; if the .exe is modified, no integrity check
- **Expected:** code signing + integrity self-check
- **Risk:** modified PrintEXE could exfiltrate device tokens
- **Fix:** EV code signing in CI + integrity self-check on startup
- **Status:** BLOCKED — requires Windows build

---

## OWASP A09 — Security Logging and Monitoring Failures

### SEC-030 (P0, IMPLEMENTED) — Audit log
- **File:** `prisma/schema.prisma:175-189` (`AuditLog` model)
- **Append-only:** no `updatedAt`, no delete
- **Pruned:** entries older than 30 days deleted on container startup (`src/lib/container.ts:367-386`)
- **Audited actions:** `auth.login`, `auth.register`, `order.{create,paid,cancelled,collected}`, `webhook.{provider}.{paid,failed}`, `payment.{manual_verify,reject}`, `agent.{register,revoke}`
- **Admin endpoint:** `GET /api/v1/admin/audit?limit=` (admin-only, no raw webhook bodies)
- **Status:** VERIFIED

### SEC-031 (P2, OPEN) — Audit log pruning loses long-term history
- **Current:** 30-day retention
- **Risk:** dispute resolution beyond 30 days is impossible from audit logs alone
- **Fix:** export audit logs to cold storage (S3 Glacier) before pruning
- **Status:** NOT VERIFIED

---

## OWASP A10 — Server-Side Request Forgery (SSRF)

### SEC-032 (P0, N/A) — No server-side fetch of user-supplied URLs
- **Current:** no endpoint accepts a URL from the user and fetches it server-side
- **Storage:** presigned URLs are generated server-side (not fetched)
- **Webhooks:** outbound webhook calls are not made (we receive webhooks, we don't send them)
- **Status:** VERIFIED — N/A by design

---

## Tenant isolation (defense in depth) — VERIFIED

**3-layer model (`docs/SECURITY_ASSESSMENT.md:88-95`):**
1. **Auth layer:** JWT claims include `shopId`; device token resolves to `PrintAgent.shopId`
2. **Query layer:** every repository query filters by `shopId` from the principal
3. **Mutation layer:** `shopId` forcibly set from the principal, never from request body

**Code evidence:**
- `withAuth` line 74: `if (claims.shopId !== user.shopId) throw UnauthorizedError` (stale-token guard)
- `withDeviceAuth` line 121: passes `{agent, shopId: agent.shopId}` — shopId from DB, not request
- All repos in `src/lib/repositories/*` filter by `shopId`

**Status:** VERIFIED — `docs/PRODUCTION_READINESS_AUDIT.md:252-263`

---

## Headers (middleware) — VERIFIED

**File:** `src/middleware.ts:1-101`
- CSP: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`
- COOP: `same-origin` · COEP: `credentialless`
- HSTS: `max-age=63072000; includeSubDomains; preload`
- X-Content-Type-Options: `nosniff` · X-Frame-Options: `DENY`
- Referrer-Policy: `strict-origin-when-cross-origin`
- Permissions-Policy: `camera=(), microphone=(), geolocation=()`

**Status:** VERIFIED — production CSP includes Supabase origin for storage uploads.

---

## PrintEXE-specific security gaps — BLOCKED

| Gap | Status | Fix |
|---|---|---|
| SQLite queue not encrypted at rest | OPEN | SQLCipher or app-level encryption |
| No certificate pinning | OPEN | Pin PrintShop SaaS cert in PrintEXE HTTP client |
| No tamper detection | OPEN (SEC-029) | EV code signing + integrity check |
| DPAPI token storage | IMPLEMENTED | CurrentUser scope — VERIFIED |

---

## Recommendations (priority order)

1. **Wire `PaymentAttempt` model** (SEC-019, P1) — closes webhook reliability gap
2. **Implement entitlements middleware** (SEC-009, P1) — gates features by tier
3. **Move rate limiting to Upstash Redis** (SEC-025, P1) — distributed limits
4. **Deploy realtime service** (P1) — Vercel can't host long-running sockets
5. **Make `/api/v1/db-health` admin-only** (SEC-007/SEC-011, P2)
6. **Add `['owner']` to all sensitive `/shops/me/*` routes** (SEC-010, P2)
7. **Remove `ignoreBuildErrors: true`** (SEC-020, P2) — after verifying `next build` passes
8. **Fix `migration_lock.toml`** (SEC-021, P3)
9. **Remove unused dependencies** (SEC-022, SEC-023, P3)
10. **Add JWT key rotation** (SEC-016, P1) — `kid` header support

---

## References
- `docs/SECURITY_ASSESSMENT.md` — v1.0 (predecessor)
- `docs/PRODUCTION_READINESS_AUDIT.md` — production probes
- `docs/KNOWN_LIMITATIONS.md` — known gaps
- OWASP Top 10 (2021): https://owasp.org/Top10/
