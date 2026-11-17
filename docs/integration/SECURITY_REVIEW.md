# Security Review — Companion Integration

**Date:** 2026-11-16
**Reviewer:** Automated audit
**Scope:** Companion pairing, device authentication, remote commands, device management

## 1. Pairing Security

| Control | Status | Evidence |
|---|---|---|
| High-entropy ticket (256-bit) | ✅ Pass | `crypto.randomBytes(32).toString('hex')` |
| Only ticket hash stored | ✅ Pass | `createHash('sha256').update(ticket).digest('hex')` |
| Short expiry (5 minutes) | ✅ Pass | `expiresAt = new Date(Date.now() + 5 * 60 * 1000)` |
| Atomic single-use consumption | ✅ Pass | Conditional `WHERE status='active'` update — first-wins |
| Replay protection | ✅ Pass | Consumed ticket → status='consumed' → 409 on reuse |
| Rate limiting | ✅ Pass | `withRateLimit('pairing-begin', 5, 60)` |
| Shopkeeper authorization | ✅ Pass | `withAuth(['owner', 'staff'])` |
| Shop binding from JWT (not client) | ✅ Pass | `shopId` derived from `principal.shopId` |
| No token in pairing URL | ✅ Pass | URL contains ticket only, not device token |
| No ticket/token in logs | ✅ Pass | Audit log stores hash prefix only |

## 2. Device-Token Security

| Control | Status | Evidence |
|---|---|---|
| High-entropy token (256-bit) | ✅ Pass | `crypto.randomBytes(32).toString('hex')` |
| Only HMAC hash stored | ✅ Pass | `createHmac('sha256', 'print-agent-salt').update(token).digest('hex')` |
| Token returned once | ✅ Pass | Only in pairing response, never again |
| Revocation enforcement | ✅ Pass | DELETE removes PrintAgent → hash lookup fails |
| Disable enforcement | ✅ Pass | `isEnabled=false` → `withDeviceAuth` returns 403 |
| Shop ID from agent record | ✅ Pass | Never from client input |
| No token in URLs/logs | ✅ Pass | Token only in `Authorization` header |

### Known Limitation: Literal Salt
The `print-agent-salt` is a fixed string in source code, not an environment variable. It serves as a domain separator (distinguishing device tokens from other HMAC uses), NOT as a secret. An attacker would still need the raw token to authenticate. 

**Recommendation:** For defense-in-depth, migrate to an environment-variable pepper in a future protocol version. This requires a backward-compatible migration plan for existing device tokens.

### Token Rotation
**Status:** Not implemented in protocol v1. The contract documents this as a known limitation. Revocation + re-pairing is the current rotation mechanism.

## 3. Remote Command Security

| Control | Status | Evidence |
|---|---|---|
| Command allowlist | ✅ Pass | 7 types: refresh_printers, pause, resume, cancel_job, retry_job, test_print, diagnostics |
| Unknown commands rejected | ✅ Pass | Zod enum validation → 400 |
| Payload validation | ✅ Pass | Per-command schema validation |
| Command expiry | ✅ Pass | 5-minute `expiresAt` |
| Idempotency key | ✅ Pass | Unique constraint on `idempotencyKey` |
| Device ownership check | ✅ Pass | `agentId` must match authenticated device |
| Shop scoping | ✅ Pass | `shopId` from authenticated principal |
| No shell/file/URL execution | ✅ Pass | Only structured commands in allowlist |
| Disabled device rejected | ✅ Pass | `isEnabled=false` → 403 |

## 4. Authorization

| Control | Status | Evidence |
|---|---|---|
| All companion routes require device token | ✅ Pass | `withDeviceAuth` wrapper |
| All shopkeeper routes require JWT | ✅ Pass | `withAuth` wrapper |
| Cross-shop access prevented | ✅ Pass | `shopId` always from server-side identity |
| Cross-device command access prevented | ✅ Pass | `agentId` from `withDeviceAuth` |
| Role-based access (owner vs staff) | ✅ Pass | `withAuth(['owner'])` for destructive ops |

## 5. Rate Limiting

| Endpoint | Limit | Key |
|---|---|---|
| POST /companion/pairing/begin | 5/60s | IP (x-forwarded-for) |
| POST /companion/pair | 10/60s | IP |
| All /agents/* routes | Various | IP |
| All /shops/me/* routes | Various | IP |

**Test architecture:** Tests use unique `x-forwarded-for` IPs per test to isolate rate limit buckets without disabling rate limiting.

## 6. Migration Safety

| Control | Status | Evidence |
|---|---|---|
| Additive migration (IF NOT EXISTS) | ✅ Pass | All ALTER/CREATE use IF NOT EXISTS |
| No destructive changes | ✅ Pass | No DROP, no rename, no data modification |
| Backward compatible | ✅ Pass | Existing PrintAgent records get `isEnabled=true` default |
| Foreign keys with CASCADE | ✅ Pass | PairingTicket/DeviceCommand cascade on Shop/Agent delete |

## 7. Remaining Vulnerabilities

1. **Literal salt** — `print-agent-salt` is in source code (domain separator, not secret). Low severity.
2. **No token rotation** — Tokens are long-lived until revocation. Medium severity (operational).
3. **No HTTPS enforcement in code** — Relies on Vercel/Caddy for TLS. Low severity (infrastructure handles this).
4. **No CSRF protection on companion routes** — Companion uses Bearer token (not cookies), so CSRF is not applicable. N/A.
5. **Rate limiting is IP-based** — Could be bypassed with rotating IPs. Low severity for authenticated routes (JWT provides identity).
