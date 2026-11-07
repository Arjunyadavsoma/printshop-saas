# PrintShop — Security Assessment

> Threat model and mitigations for the unified PrintShop platform
> (web SaaS + PrintEXE desktop client).

**Status:** v1.0 — 2025-11-07.

---

## 1. Threat model

### 1.1 Assets

| Asset | Location | Sensitivity |
|---|---|---|
| Customer PII (phone, files) | Supabase Postgres + Storage | High |
| Payment credentials (PhonePe/Paytm keys) | `Shop.paymentCredentials` (AES-256-GCM encrypted) | Critical |
| JWT secrets | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` env vars | Critical |
| Payment encryption key | `PAYMENT_ENCRYPTION_KEY` env var | Critical |
| Device tokens | `PrintAgent.tokenHash` (HMAC-SHA256 hashed) | High |
| Audit logs | `AuditLog` table (append-only) | High |

### 1.2 Attack surfaces

| Surface | Exposure | Mitigation |
|---|---|---|
| Public API routes | Internet-facing | Rate limiting, input validation, tenant scoping |
| Customer order routes | Public (order-token auth) | `withOrderAccess` constant-time token comparison |
| Shopkeeper routes | JWT auth | `withAuth` + role checks + stale-token guard |
| Admin routes | JWT auth (admin role) | `withAuth(['admin'])` + hidden login + access key |
| Print agent routes | Device-token auth | `withDeviceAuth` HMAC-hashed token |
| Payment webhooks | Public (signature-verified) | Real crypto verification (X-VERIFY, SHA-256, CHECKSUMHASH) |
| File storage | Presigned URLs (time-limited) | 5-min upload, 15-min download, 60s print-url |
| Realtime (socket.io) | JWT-verified room join | `auth {token}` event + `shop:{shopId}` room scoping |
| Desktop client | Local SQLite + DPAPI token | DPAPI CurrentUser scope, origin-based CORS |

---

## 2. Authentication security

### 2.1 Password storage

- **Algorithm:** PBKDF2-SHA256, 600,000 iterations (OWASP 2023 recommendation)
- **Salt:** 16 bytes, random per password
- **Key:** 32 bytes
- **Format:** `pbkdf2$<iter>$<saltB64>$<keyB64>`
- **Verification:** constant-time XOR-OR diff
- **Location:** `src/lib/auth/jwt-auth.adapter.ts:7-98`

### 2.2 JWT

- **Algorithm:** HS256 via Web Crypto `SubtleCrypto`
- **Access token TTL:** 15 minutes (`ACCESS_TOKEN_TTL_SECONDS=900`)
- **Refresh token TTL:** 30 days (`REFRESH_TOKEN_TTL_SECONDS=2592000`)
- **Refresh rotation:** single-use (jti replay-guarded via cache)
- **Stale-token guard:** if `claims.shopId !== user.shopId` → reject (defends against shop reassignment)
- **Location:** `src/lib/auth/jwt-auth.adapter.ts:102-186`

### 2.3 Device token

- **Format:** `<uuid>-<uuid>` (plaintext, returned ONCE at registration)
- **Storage:** HMAC-SHA256('print-agent-salt', token) hex digest stored in `PrintAgent.tokenHash`
- **Auth:** `withDeviceAuth` hashes the incoming token + looks up by `tokenHash`
- **Revocation:** `DELETE /api/v1/agents/{id}` deletes the row → hash gone → token invalid
- **PrintEXE storage:** DPAPI (CurrentUser scope) at `%AppData%\PrintShop\Companion\device.dat`

### 2.4 Customer order token

- **Format:** 6-char alphanumeric (e.g. "B5EY7Y")
- **Auth:** `withOrderAccess` — constant-time `timingSafeEqual`
- **Token sources:** `X-Order-Token` header or `?t=` query (for receipt downloads)
- **Security:** mismatched token → 403 (NOT 404 — hides order existence)

---

## 3. Authorization security

### 3.1 Role-based access control

| Role | Permissions | Routes |
|---|---|---|
| `customer` (no JWT) | View own order, upload files, pay, track | `/api/v1/orders/{id}/*` (order-token auth) |
| `owner` | Full shop management | `/api/v1/shops/me/*` |
| `staff` | Shop operations (no payment credential management) | `/api/v1/shops/me/*` (except payment-credentials) |
| `admin` | Platform-wide | `/api/v1/admin/*` |
| `device` (print agent) | Claim/print jobs, heartbeat | `/api/v1/agents/*` |

### 3.2 Tenant isolation (defense in depth)

Three layers:
1. **Auth layer:** JWT claims include `shopId`; device token resolves to `PrintAgent.shopId`
2. **Query layer:** every repository query filters by `shopId` from the principal
3. **Mutation layer:** `shopId` is forcibly set from the principal, never from the request body

**No raw SQL in route handlers.** All DB access through `src/lib/repositories/*`.

### 3.3 Entitlements (⚠️ not yet implemented)

- `Shop.subscriptionTier` is informational only — no feature gating
- No entitlements checking on any route
- **Phase 2:** add `requireEntitlement('feature')` middleware

---

## 4. Payment security

### 4.1 Credential encryption

- **Algorithm:** AES-256-GCM via `createCipheriv`
- **Key:** `PAYMENT_ENCRYPTION_KEY` env (32 bytes base64)
- **Format:** `v1:<nonceHex>:<ciphertextHex>:<tagHex>` (key versioning for rotation)
- **Production fail-safe:** non-`v1:` credentials in production → FATAL log + empty creds (no plaintext leak)
- **Location:** `src/lib/crypto/credential-encryption.ts`

### 4.2 Webhook verification

| Provider | Verification | Location |
|---|---|---|
| PhonePe v1 | X-VERIFY (SHA-256 + base64 + salt) | `packages/adapters/src/payment/phonepe.adapter.ts` |
| PhonePe v2 | SHA-256(username:password) auth header | `src/lib/payments/phonepe-v2-webhook.ts:55-69` |
| Paytm | CHECKSUMHASH (AES-128-CBC + SHA-256) | `packages/adapters/src/payment/paytm.adapter.ts` |

All verification is fail-closed: if env vars are unset, webhooks are rejected.

### 4.3 Payment idempotency

- `Order.paymentTxnId` `@unique` — DB-level duplicate prevention
- Cache dedup: `pay:done:{provider}:{txnId}` (24h TTL)
- Race-safe transition: `UPDATE WHERE status='awaiting_payment'` (conditional)
- Amount validation: `webhookAmount === order.totalAmountPaise` (MANDATORY)

### 4.4 Amount validation

Every webhook amount is validated against the order total:
```typescript
if (amountPaise === null || amountPaise !== order.totalAmountPaise) {
  throw new Error('Amount mismatch — possible tampering');
}
```
**Location:** `src/lib/payments/webhook.service.ts:187-206`

---

## 5. File storage security

### 5.1 Presigned URLs

- **Upload:** 5-minute expiry, HMAC-signed (in-memory) or S3/R2 presigned
- **Download:** 15-minute default, 60-second for print-url (shopkeeper-only)
- **Key format validation:** `shops/<shopId>/orders/<orderId>/<fileId>` OR `shops/<shopId>/upi-qr/<slug>.<ext>`

### 5.2 Access control

| Route | Auth | File access |
|---|---|---|
| Customer upload/download | `withOrderAccess` (order token) | Own order's files only |
| Shopkeeper download | `withAuth` + tenant-scoped | Own shop's files only |
| Shopkeeper print-url | `withAuth(['owner'])` | Own shop's files, 60s URL |
| Print agent download | `withDeviceAuth` | Own shop's queued jobs only |

### 5.3 Auto-delete

- Files deleted from storage when order is collected (`POST /shops/me/orders/{id}/complete`)
- Deletion is idempotent (storage returns 404 → treated as success)

---

## 6. Network security

### 6.1 Headers (middleware)

- **CSP:** `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`
- **COOP:** `same-origin`
- **COEP:** `credentialless`
- **HSTS:** `max-age=63072000; includeSubDomains; preload`
- **X-Content-Type-Options:** `nosniff`
- **X-Frame-Options:** `DENY`
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** `camera=(), microphone=(), geolocation=()`
- **Location:** `src/middleware.ts`

### 6.2 CORS

- API routes: same-origin (no CORS headers needed for web client)
- PrintLatch/native-printer: loopback only (`127.0.0.1:32191`, `127.0.0.1:32192`) in CSP `connect-src`
- PrintEXE local API (future): `127.0.0.1:8421` loopback, origin-validated

### 6.3 Rate limiting

| Scope | Limit | Window |
|---|---|---|
| Login | 20 | 60s |
| Register | 5 | 60s |
| Checkout | 20 | 60s |
| Upload-url | 30 | 60s |
| Status poll | 120 | 60s |
| Shops list | 60 | 60s |

**⚠️ Vercel serverless limitation:** rate limiting is per-invocation (InMemoryCacheAdapter). Upstash Redis provides distributed rate limiting when configured.

---

## 7. Desktop security (PrintEXE)

### 7.1 Token storage

- **DPAPI (CurrentUser scope)** — only the Windows user who paired can decrypt
- **Path:** `%AppData%\PrintShop\Companion\device.dat`
- **Location:** `PrintEXE/src/.../DeviceTokenStore.cs:34,51`

### 7.2 Log redaction

- `DeviceTokenRedactor` Serilog enricher strips `*Token`/`*Secret`/`*Password`
- HTTP logging handler strips `X-PrintShop-Device-Token` header
- **Location:** `PrintEXE/src/.../DeviceTokenRedactor.cs`

### 7.3 Local SQLite

- **Path:** `%AppData%\PrintShop\Companion\queue.db`
- **Content:** print job metadata (no customer PII beyond filenames)
- **Risk:** if the machine is compromised, the attacker sees queued print jobs
- **Mitigation:** terminal-job purge after 7 days; no payment data in the queue

### 7.4 PrintEXE security gaps

- ❌ No at-rest encryption for SQLite (relying on Windows BitLocker for full-disk encryption)
- ❌ No certificate pinning (HTTPS with system trust store)
- ❌ No tamper detection (if the .exe is modified, no integrity check)

---

## 8. Audit trail

### 8.1 AuditLog model

- **Append-only:** no `updatedAt`, no delete
- **Fields:** `shopId`, `userId`, `action`, `entityType`, `entityId`, `metadata` (JSON), `ip`, `createdAt`
- **Pruned:** entries older than 30 days are deleted on container startup (`src/lib/container.ts:367-386`)

### 8.2 Audited actions

- `auth.login`, `auth.register`, `auth.refresh`
- `order.create`, `order.paid`, `order.cancelled`, `order.collected`
- `webhook.{provider}.paid`, `webhook.{provider}.failed`
- `payment.manual_verify`, `payment.reject`
- `agent.register`, `agent.revoke`
- `sync.push` (future)

### 8.3 Admin audit endpoint

- `GET /api/v1/admin/audit?limit=` — admin-only, no raw webhook bodies or credentials

---

## 9. Vulnerabilities found + fixed

| # | Vulnerability | Severity | Status |
|---|---|---|---|
| SEC-001 | Customer order routes relied on UUID alone (IDOR) | Critical | ✅ Fixed — `withOrderAccess` + `customerToken` |
| SEC-002 | Password leaked to localStorage during registration | Critical | ✅ Fixed — strips password before JSON.stringify |
| SEC-003 | customerToken displayed as visible badge | High | ✅ Fixed — removed badge, only `tokenNumber` shown |
| SEC-004 | Raw Prisma error leaked to customer (DATABASE_URL, stack trace) | High | ✅ Fixed — friendly message, raw error logged only in dev |
| SEC-005 | `--destructive-foreground` referenced but never defined | Medium | ✅ Fixed — token defined in globals.css |
| SEC-006 | Soft-404 on admin login (HTTP 200 for missing routes) | Medium | ⚠️ Documented — admin login returns fake 404 page |
| SEC-007 | `/api/v1/db-health` public — returns env-var presence + masked DATABASE_URL | Medium | ⚠️ Documented — diagnostic endpoint, should be admin-only |
| SEC-008 | Device token stored plaintext in Bun/TS print-agent config | Medium | ⚠️ Documented — PrintEXE uses DPAPI, Bun CLI doesn't |
| SEC-009 | No entitlements enforcement | Medium | ⚠️ Phase 2 |
| SEC-010 | Admin routes accept any authenticated role | Medium | ⚠️ Defense-in-depth gap — `['owner']` not passed to `withAuth` on `/shops/me/*` routes |

---

## 10. Recommendations

1. **Make `/api/v1/db-health` admin-only** — it leaks env-var presence
2. **Add `['owner']` to all `/shops/me/*` `withAuth` calls** — defense-in-depth
3. **Implement entitlements checking** — `requireEntitlement('feature')` middleware
4. **Add certificate pinning to PrintEXE** — prevent MITM on the device token exchange
5. **Encrypt the PrintEXE SQLite queue** — SQLCipher or application-level encryption for PII
6. **Move rate limiting to Upstash Redis** — distributed across serverless invocations
7. **Add CSP report-to header** — collect CSP violations for monitoring
8. **Rotate JWT secrets periodically** — add a key-versioning mechanism to the JWT verifier
