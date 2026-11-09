# PrintEXE Authentication

> The three auth systems PrintEXE must use: owner JWT, device token, and JWT
> exchange. Source of truth: `src/lib/api/with-auth.ts` (`withAuth`,
> `withDeviceAuth`), `src/lib/auth/jwt-auth.adapter.ts`,
> `src/app/api/v1/agents/register/route.ts`, `src/app/api/v1/agents/token/route.ts`,
> `mini-services/realtime-service/index.ts`.

PrintEXE never logs in with email + password itself. The shopkeeper does that on
the web dashboard. PrintEXE receives a one-time **device token** at pairing time
and uses that for every REST call. A short-lived JWT is minted only for the
Socket.IO handshake.

---

## 1. The three tokens

| Token | Lifetime | Algorithm | Issued by | Used for |
|---|---|---|---|---|
| Owner JWT (access) | 15 min (900 s) | HS256 with `JWT_ACCESS_SECRET` | `POST /api/v1/auth/login` | Registration + revoke (web only) |
| Device token | Until revoked | None (opaque UUID pair) | `POST /api/v1/agents/register` | All PrintEXE REST calls |
| Socket JWT | 15 min (900 s) | HS256 with `JWT_ACCESS_SECRET` | `POST /api/v1/agents/token` | Socket.IO `auth` emit |

Refresh tokens (`JWT_REFRESH_SECRET`) exist in the system but PrintEXE does NOT
use them — the device token is long-lived and never rotates.

---

## 2. Owner JWT (registration + revocation only)

### 2.1 Format

HS256 JWT with three base64url segments separated by `.`:
```
header  = {"alg":"HS256","typ":"JWT"}
payload = {"sub":"<userId>","shopId":"<shopId>","role":"owner","type":"access","iat":<epoch>,"exp":<epoch+900>}
```

### 2.2 Verification (`withAuth` in `src/lib/api/with-auth.ts`)

1. Strip `Bearer ` prefix from `Authorization`.
2. Verify signature with `JWT_ACCESS_SECRET` (`crypto.subtle.verify` HMAC-SHA-256).
3. Reject if `exp < now`, `type !== 'access'`, or signature mismatches.
4. Load `User` row by `sub`. If missing → 401 `User no longer exists`.
5. **Stale-scope guard:** if `claims.shopId !== user.shopId` → 401
   `Token shop scope is stale` (catches a shop reassignment after token issue).
6. Role gate: optional `allowedRoles` array — `register` requires `owner`.

### 2.3 PrintEXE use

PrintEXE never holds the owner JWT. The shopkeeper calls `POST /agents/register`
from the web dashboard; the resulting `deviceToken` is hand-pasted into PrintEXE.
The only PrintEXE-visible artifact from the JWT flow is the agent ID printed on
the dashboard's agent list.

---

## 3. Device token (all PrintEXE REST calls)

### 3.1 Format

```
crypto.randomUUID() + '-' + crypto.randomUUID()
// e.g. 550e8400-e29b-41d4-a716-446655440000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
```

A 73-character ASCII string (two lower-case UUIDs joined by `-`). It is NOT a
JWT, has no embedded claims, and carries no metadata. The server stores a
deterministic **hash** of it, never the plaintext.

### 3.2 Storage on the server (HMAC-SHA256)

```ts
const tokenHash = createHmac('sha256', 'print-agent-salt').update(token).digest('hex');
```

The salt is the **literal string `"print-agent-salt"`** — it is a domain
separator, not a secret. Real security comes from the 122-bit entropy of the UUID
pair (≈ 6 × 10^36 possibilities; infeasible to brute-force or guess). The hash is
stored in `PrintAgent.tokenHash` (unique column).

### 3.3 Verification (`withDeviceAuth`)

Every device-token call does, server-side:
1. Strip `Bearer ` prefix.
2. Compute `HMAC-SHA256('print-agent-salt', token)` → hex.
3. `SELECT * FROM "PrintAgent" WHERE "tokenHash" = $1 LIMIT 1`.
4. If no row → 401 `Unknown device token`.
5. On success, refresh presence: `UPDATE "PrintAgent" SET "isOnline"=true, "lastSeenAt"=NOW()`. (Every authenticated call doubles as a heartbeat.)
6. Pass `{agent, shopId: agent.shopId}` to the route handler.

The tenant scope (`shopId`) comes **exclusively** from the agent row — never from
the request. PrintEXE never sends a `shopId` field in any body.

### 3.4 Token rotation

There is no automatic rotation. The shopkeeper rotates by:
1. `DELETE /api/v1/agents/{id}` (revokes — see §5 below).
2. `POST /api/v1/agents/register` (mints a new token).
3. Paste the new token into PrintEXE.

### 3.5 Local storage (Windows)

PrintEXE MUST store the device token with **Windows DPAPI (CurrentUser scope)**:

```csharp
byte[] plaintext = Encoding.UTF8.GetBytes(deviceToken);
byte[] encrypted = ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
File.WriteAllBytes(deviceTokenPath, encrypted);
```

Only the Windows user who paired can decrypt it. Never log the plaintext token;
redact as `token[..4] + "..." + token[^4..]`.

---

## 4. JWT exchange (device token → Socket.IO JWT)

### 4.1 Why a separate JWT?

The Socket.IO mini-service (`mini-services/realtime-service/index.ts`) verifies
HS256 JWTs with `JWT_ACCESS_SECRET`. It does NOT have a Postgres connection and
cannot hash device tokens itself. So PrintEXE trades its device token for a JWT
at the Next.js API (`POST /agents/token`) and presents that JWT to Socket.IO.

### 4.2 The exchange

```
POST /api/v1/agents/token
Authorization: Bearer <deviceToken>
```
Server handler (`src/app/api/v1/agents/token/route.ts`):
```ts
const access = await container.auth.issueAccessToken({
  id: `agent:${agent.id}`,   // <-- sub is "agent:<agentId>"
  shopId,
  role: 'staff',
});
return ok({ accessToken: access.token, expiresIn: ..., shopId });
```

Resulting JWT payload:
```json
{"sub":"agent:<agentId>","shopId":"<shopId>","role":"staff","type":"access","iat":...,"exp":...+900}
```

### 4.3 Verification by Socket.IO server

```ts
function verifyJwt(token): JwtClaims | null {
  // 3-part split, base64url decode, HMAC-SHA256 verify with JWT_SECRET,
  // exp check, type==='access' check.
  if (!claims || !claims.shopId) → emit 'auth-error', disconnect.
}
```

### 4.4 Refresh strategy

Cache the JWT in memory. Refresh when `now > issuedAt + (expiresIn - 60)`. On
`auth-error` from Socket.IO, re-exchange + reconnect. Never persist the JWT — it
is short-lived and re-issuable from the device token at any time.

---

## 5. Revocation

The shopkeeper revokes via `DELETE /api/v1/agents/{agentId}` (owner JWT, web
dashboard). The server:

1. Verifies the agent belongs to the calling shop.
2. Returns queued jobs assigned to that agent to the pool (`agentId=null`).
3. **Deletes the PrintAgent row** — the token hash is gone.

Effect on PrintEXE: every future device-token REST call returns 401
`Unknown device token` (the `findByTokenHash` lookup misses). The Socket.IO
server, if still connected, broadcasts `agent.revoked` to the shop room BEFORE
the row is deleted — PrintEXE listening for that event can show a graceful
"Device revoked" UI instead of silently failing.

### 5.1 Hard logout procedure for PrintEXE

On receiving `agent.revoked` with `payload.agentId === myAgentId`:
1. Stop all polling + heartbeat loops.
2. Disconnect Socket.IO.
3. Wipe the locally stored device token (DPAPI blob).
4. Show the "This PC was revoked from the dashboard" screen.

### 5.2 Soft "logged out" detection

If a single REST call returns 401 (without a prior `agent.revoked` event), it
usually means the device token is corrupted or the agent row was deleted
out-of-band. Treat identically to revocation.

---

## 6. Security rules

1. **Never transmit the device token over a non-TLS channel.** Production is HTTPS
   only; Caddy terminates TLS at 443.
2. **Never send the device token to a URL other than `https://printshop-saas-three.vercel.app`.**
   The presigned `downloadUrl` is fetched with NO auth header (the signature is
   in the URL itself).
3. **Never log the full device token or JWT.** Redact to first/last 4 chars.
4. **Never share the device token between devices.** Each PrintEXE install gets
   its own agent row + token — concurrent use causes claim conflicts and audit
   confusion.
5. **The shopkeeper JWT is never in PrintEXE's memory.** Don't ask for the
   shopkeeper's password — direct them to the web dashboard.
6. **DPAPI CurrentUser scope, not LocalMachine.** LocalMachine would let any
   Windows user on the box impersonate the printer.
7. **Constant-time verification on the server** for both JWT (`timingSafeEqual`)
   and order access tokens — PrintEXE doesn't need to do anything, this is
   informational.
