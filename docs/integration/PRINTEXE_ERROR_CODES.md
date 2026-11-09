# PrintEXE Error Codes

> Every HTTP status + error code PrintEXE can receive, what it means, when it
> fires, and what PrintEXE should do. Source of truth:
> `packages/core/src/errors/app-error.ts` (the error classes),
> `src/lib/api/envelope.ts` (`fail`, `toAppError` — wraps anything into an
> `AppError`), `src/lib/api/with-auth.ts` (auth-guarded paths).

Every response from the PrintShop API follows the same envelope:

```json
// success
{ "success": true, "data": {...}, "meta": {...} }

// error
{ "success": false, "error": { "code": "<CODE>", "message": "<human text>", "details": {...} } }
```

The HTTP status is set to match the error code (`AppError.statusCode`). The
`code` is a stable machine-readable string — PrintEXE should branch on `code`,
NOT on `message` (messages can be reworded; codes never change within v1).

The response also carries an `x-request-id` header (UUID). Always log it
alongside the error — support can trace the request through the server logs.

---

## 1. Error code reference

| HTTP | Code | Class | When it fires | Retry? |
|---|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `ValidationError` | Zod parse failed; field constraint violated | No (fix the request) |
| 401 | `UNAUTHORIZED` | `UnauthorizedError` | Missing / invalid / expired token; device token hash not found | No (refresh token, or revoke) |
| 403 | `FORBIDDEN` | `ForbiddenError` | Wrong role, or accessing another shop's resource | No (programming bug) |
| 404 | `NOT_FOUND` | `NotFoundError` | Resource doesn't exist OR exists in another shop | No (except receipt endpoint on v0.4.7 — see below) |
| 409 | `CONFLICT` | (no class — `AppError` with code) | Duplicate (email, slug, paymentTxnId) | No |
| 429 | `RATE_LIMITED` | `RateLimitError` | Per-IP rate limit exceeded | Yes — with backoff |
| 500 | `INTERNAL_ERROR` | `AppError` | Unhandled exception | Yes — idempotently |
| 502 | `ADAPTER_ERROR` | `AdapterError` | Storage / cache / DB adapter failure | Yes — with backoff |

There is **no `CONFLICT` class** in `app-error.ts` — conflicts are returned as
`AppError` with `code:'CONFLICT'`, statusCode 409. PrintEXE should treat the
HTTP status as the source of truth for conflicts.

---

## 2. 400 VALIDATION_ERROR

**When it fires:**
- Zod schema parse failed (wrong type, missing required field, value out of
  range, enum mismatch).
- The `ReceiptSchema` regex for `checksum` failed (must be 64 lowercase hex).
- The `StatusSchema` `status` field is not one of `'printing'|'completed'|'failed'`.
- The `PushSchema` array length > 100, or a change's `id` is not a UUID.

**Sample response:**
```json
{"success":false,"error":{
  "code":"VALIDATION_ERROR",
  "message":"Invalid request",
  "details":{"issues":[
    {"path":["status"],"message":"Expected 'printing' | 'completed' | 'failed', received 'prtng'"}]}}}
```

**What PrintEXE should do:**
- This is a programming bug — fix the request and retry.
- Do NOT auto-retry the same payload; you'll get the same 400.
- Log the full `details.issues` array — it tells you exactly which field
  failed.
- For the heartbeat endpoint specifically, an empty or malformed body is OK:
  the server does `await req.json().catch(() => ({}))`, so a missing JSON body
  does NOT trigger 400.

---

## 3. 401 UNAUTHORIZED

**When it fires (owner JWT path):**
- `Authorization` header missing or doesn't start with `Bearer `.
- JWT signature invalid, expired (`exp < now`), or `type !== 'access'`.
- The `User` row referenced by `sub` no longer exists.
- `claims.shopId !== user.shopId` (stale scope after shop reassignment).

**When it fires (device token path):**
- `Authorization` header missing or doesn't start with `Bearer `.
- The `PrintAgent` row with the matching `tokenHash` was deleted (revoked).

**Sample response:** `{"success":false,"error":{"code":"UNAUTHORIZED","message":"Unknown device token"}}`

Common messages: `"Missing bearer token"`, `"Invalid or expired token"`, `"User no longer exists"`, `"Token shop scope is stale"` (owner JWT path); `"Missing device token"`, `"Unknown device token"` (device token path — REVOCATION signal).

**What PrintEXE should do:**
- For the device token path: **any 401 is a revocation signal.** The token hash is no longer in the DB → the shopkeeper revoked this device. PrintEXE should: (1) stop all loops (heartbeat, polling); (2) disconnect Socket.IO; (3) wipe the local DPAPI device token; (4) show the "Device revoked" UI.
- Do NOT auto-retry. The shopkeeper must re-pair.

**Edge case — JWT expired on Socket.IO:** the Socket.IO server returns `auth-error` (not HTTP 401) on JWT expiry. Treat as a soft refresh: call `POST /agents/token` for a new JWT and re-emit `auth`. If THAT call returns 401, the device token itself is dead → revoke.

---

## 4. 403 FORBIDDEN

**When it fires:**
- Owner JWT role check failed: `withAuth(handler, ['owner'])` and the JWT's role is `staff` or `admin`.
- Cross-shop access attempt (rare — most queries are shop-scoped by the resolved principal; tenant isolation is enforced in code, not via 403).

**Sample response:** `{"success":false,"error":{"code":"FORBIDDEN","message":"Role 'staff' is not permitted"}}`

**What PrintEXE should do:**
- PrintEXE's device token resolves to `role='staff'` after JWT exchange. Calling owner-only endpoints (`POST /agents/register`, `DELETE /agents/{id}`) from PrintEXE will 403.
- Don't call those endpoints from PrintEXE — they're web-dashboard-only. If you see 403 on a device-token endpoint, you're hitting an owner-only endpoint by mistake; fix the routing.

---

## 5. 404 NOT_FOUND

**When it fires:**
- `POST /agents/jobs/{jobId}/status` — `findByIdAndShop` returned null (job doesn't exist OR belongs to a different shop).
- `POST /agents/jobs/{jobId}/received` — same tenant check.
- `DELETE /agents/{id}` — agent row not in this shop (already revoked).

**Sample response:** `{"success":false,"error":{"code":"NOT_FOUND","message":"Job not found in your shop."}}`

**What PrintEXE should do:**
- For job endpoints: drop the local in-flight copy and remove the job from the local SQLite queue. The server has no record of it — it was either deleted (cloud cleanup) or never existed (race with another agent's claim that already completed).
- **Special case for v0.4.7 clients calling `/agents/jobs/{id}/received`:** the endpoint doesn't exist on v0.4.7 — the path returns 404. v0.4.7 PrintEXE MUST NOT call the receipt endpoint. Gate the call on a feature flag if shipping a v0.5.x build against a v0.4.7 backend.

---

## 6. 409 CONFLICT

**When it fires:** duplicate registration (e.g., same agent name in a unique index — currently not enforced, but reserved) or duplicate `paymentTxnId`/`email`/`slug` from Prisma unique-constraint violations.

**Sample response:** `{"success":false,"error":{"code":"CONFLICT","message":"..."}}`

**What PrintEXE should do:**
- PrintEXE rarely sees this — it doesn't create unique-constrained entities.
- If you see 409 on `/sync/push` for a `Customer` upsert, another device inserted the same `id` between your pull and push. Re-pull, merge, retry.

Note: the job status endpoint's "another agent already claimed" response is NOT a 409 — it's a 200 with `{skipped:true, reason:"..."}`. Don't confuse the two.

---

## 7. 429 RATE_LIMITED

**When it fires:** `withRateLimit(scope, limit, window)` — fixed-window per-IP counter in the cache adapter. Throws `RateLimitError` when count > limit.

**Sample response:** `{"success":false,"error":{"code":"RATE_LIMITED","message":"Rate limit exceeded (120/60s)"}}`

**What PrintEXE should do:**
1. Read the limit from the message (e.g. `120/60s` = 120 hits per 60 s).
2. Compute next attempt: at minimum `windowSeconds / limit` apart. With exponential backoff, double the delay on each successive 429.
3. Jitter ±20% to avoid synchronised retry storms when multiple devices hit the same limit.
4. Don't drop the request — queue it and retry once the window resets.

The fixed-window counter resets at the boundary (start of each 60 s window), NOT from the last request. So a 429 at T+45 of a 60 s window means wait 15 s + backoff.

---

## 8. 500 INTERNAL_ERROR

**When it fires:** any uncaught exception in a route handler. `toAppError` wraps unknown errors as `AppError(message, 'INTERNAL_ERROR', 500)`. The envelope also calls `captureSentry(err)` (no-op without `SENTRY_DSN`).

**Sample response:** `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"<error.message>"}}`

**What PrintEXE should do:**
1. Capture the `x-request-id` response header — include it in the support report.
2. **Retry idempotently** for idempotent endpoints: `/agents/heartbeat` (safe), `/agents/jobs/{id}/status {status:'completed'|'failed'}` (the conditional/unconditional update makes duplicate completion/failure a no-op), `/agents/jobs/{id}/received` (idempotent), `/sync/pull` (re-issue with same cursor).
3. **Retry carefully** for `/agents/jobs/{id}/status {status:'printing'}` (the claim) — atomic and idempotent: retry is safe, but a "successful" 500 might have actually succeeded on the server. The retry will return `{skipped:true}` if so.
4. Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 60 s. After 5 consecutive 500s, surface to the user as "Backend error — retrying."
5. Don't retry 5xx on `/agents/register` — a 500 there may have committed the row; retry would mint a second device token (orphaning the first).

---

## 9. 502 ADAPTER_ERROR

**When it fires:** a storage, cache, or DB adapter call failed. `AdapterError` is wrapped as `{provider, ...context}`.

**Sample response:** `{"success":false,"error":{"code":"ADAPTER_ERROR","message":"[supabase] presigned URL failed","details":{"provider":"supabase"}}}`

**What PrintEXE should do:**
- Treat like 500 (retry idempotently).
- If the error mentions storage (R2/S3/Supabase), the presigned download URL in the previous `/jobs/pending` response may also be invalid — re-poll to get a fresh one before retrying the print.
- If the error mentions database, all subsequent calls in this shop may also fail — back off harder.

---

## 10. Network / non-HTTP errors

These don't come from the server, but PrintEXE must handle them:

| Symptom | Cause | Action |
|---|---|---|
| Connection timeout | Network down, slow storage | Retry with backoff; don't drop the local queue entry |
| DNS resolution failure | Offline, DNS server issue | Don't retry aggressively — wait 30 s, then re-attempt |
| TLS handshake failure | Cert expired, MITM, clock skew | Surface to user — don't silently retry |
| Socket.IO `disconnect` | Network blip | Library auto-reconnects; pause event processing |
| Socket.IO `connect_error` | Auth error, CORS, wrong URL | Check the `auth-error` payload; refresh JWT |

For all of these, the local SQLite queue should buffer status reports and receipts; flush them when connectivity returns (in chronological order). The server's idempotency guarantees (conditional updates, idempotent receipt) make delayed flushes safe.

---

## 11. Error → action summary

```
400 VALIDATION_ERROR   → log details, fix code, don't retry
401 UNAUTHORIZED       → revoke the local device (show "Device revoked" UI)
403 FORBIDDEN          → don't call that endpoint from PrintEXE
404 NOT_FOUND          → drop the local in-flight job; remove from queue
409 CONFLICT           → re-pull + merge + retry (sync.push only)
429 RATE_LIMITED       → backoff 2x, jitter ±20%, retry
500 INTERNAL_ERROR     → capture requestId, retry idempotently (5x max)
502 ADAPTER_ERROR      → retry like 500; re-fetch presigned URL if storage
network error          → buffer locally, flush when reconnected
```

The most common production error is **429 on the polling endpoint**. Poll at 2 s when Socket.IO is down; back off to 5 s after the first 429, 10 s after the second, 30 s after the third. Resume at 2 s only when a 200 confirms the rate limit cleared.
