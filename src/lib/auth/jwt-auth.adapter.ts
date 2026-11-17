import { timingSafeEqual, createHash } from 'node:crypto';
import type {
  AuthAdapter,
} from '@platform/core/interfaces';
import type { AccessTokenClaims, RefreshTokenClaims, User, UserRole } from '@platform/core/domain';
import type { CacheAdapter } from '@platform/core/interfaces';

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation for SHA-256
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

// ── JWT claims ────────────────────────────────────────────────────────────
//
// H5 fix: the JWT now carries `iss` (issuer) and `aud` (audience) claims set
// to `printshop-saas`. On verify we require BOTH to match exactly — this
// rejects tokens minted by a different system that happens to share our
// HMAC secret (e.g. a sister app reusing the env var). The constant lives
// here, not in env, because changing it without a token rotation strategy
// would invalidate every active session; if you ever need to change it,
// ship the change behind a feature flag that accepts both old + new values
// for one TTL window.
const JWT_ISSUER = 'printshop-saas';
const JWT_AUDIENCE = 'printshop-saas';

/** A parsed PBKDF2 hash string: `pbkdf2$<iterations>$<saltB64>$<keyB64>`. */
interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  key: Uint8Array;
}

// ── Standard base64 (used for PBKDF2 password hash storage) ───────────────
//
// The PBKDF2 hash format `pbkdf2$<iter>$<saltB64>$<keyB64>` predates these
// fixes and is already stored in the database with standard base64 (with
// `+`, `/`, and `=` padding). Changing the encoding would break every
// existing password hash. The JWT path (below) uses base64url instead.

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── base64url encoding (used for JWT segments) ────────────────────────────
//
// JWT spec (RFC 7515 §2 + RFC 7519) REQUIRES base64url encoding WITHOUT
// padding for the header, payload, and signature segments. The previous
// implementation used `btoa()` which emits standard base64 (with `+`, `/`,
// `=`) — technically still decodable by `atob()` but NOT spec-compliant,
// and incompatible with third-party JWT libraries that decode strictly.
// Worse, the `+` and `/` characters are URL-unsafe (in some contexts they
// get percent-encoded, breaking signature comparison on the round-trip).
//
// `+` → `-`, `/` → `_`, trailing `=` padding stripped.

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64UrlToBytes(b64url: string): Uint8Array {
  // Re-add the padding (`=`) and convert URL-safe chars back to standard
  // base64 so `atob()` can decode it. Any malformed input throws here →
  // the caller wraps this in try/catch.
  const std = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  return b64ToBytes(std + pad);
}

/**
 * Compare two base64url-encoded strings in constant time.
 *
 * `crypto.timingSafeEqual` requires equal-length Buffer inputs — if the
 * lengths differ, it throws. A naive length check before the call would
 * itself leak length information via timing, so we hash both inputs with
 * SHA-256 (fixed 32-byte output) and compare the digests. This:
 *   1. Eliminates the length leak (every comparison is exactly 32 bytes).
 *   2. Still rejects mismatched inputs (different bytes → different
 *      SHA-256 digests → timingSafeEqual returns false).
 *   3. Runs in time proportional to the SHA-256 cost, not the input
 *      length — so an attacker can't use response timing to brute-force
 *      the signature byte-by-byte.
 */
function safeEqualB64Url(a: string, b: string): boolean {
  // Fast-path: if both are empty, they're equal. (An empty signature is
  // never valid — the caller checks `parts.length === 3` — but defensive.)
  if (a.length === 0 && b.length === 0) return true;
  // SHA-256 over each value, then constant-time compare the 32-byte
  // digests. Both sides get the same fixed-length digest regardless of
  // input length, so timingSafeEqual won't throw on length mismatch.
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  if (da.length !== db.length) return false;
  return timingSafeEqual(da, db);
}

/**
 * JWT (HS256) + PBKDF2 auth adapter built on the Web Crypto SubtleCrypto API.
 *
 * No external dependencies — works in the Next.js Edge/Node runtime. The
 * production target is argon2id (per the spec); swapping is a matter of
 * replacing this concrete, since every caller depends on the {@link AuthAdapter}
 * interface. PBKDF2-SHA256 with 600k iterations is OWASP-recommended and
 * sufficient for the demo backend.
 *
 * H5 fixes applied:
 *   - Signature comparison uses `crypto.timingSafeEqual` (via `safeEqualB64Url`)
 *     instead of `!==` — blocks timing attacks on the HMAC signature.
 *   - JWT segments are base64url-encoded (RFC 7515/7519 compliant) instead
 *     of standard base64 — `+`, `/`, `=` would otherwise break in URLs and
 *     in third-party JWT libraries.
 *   - Every `JSON.parse()` / base64 decode in the verify path is wrapped in
 *     try/catch — a malformed token returns `null` (treated as
 *     "unauthenticated") instead of throwing a 500.
 *   - Tokens carry `iss` + `aud` claims (both set to `printshop-saas`) and
 *     the verifier REQUIRES both to match — rejects tokens minted by a
 *     different system that happens to share the HMAC secret.
 */
export class JwtAuthAdapter implements AuthAdapter {
  readonly provider = 'jwt';

  constructor(
    private readonly config: {
      accessSecret: string;
      refreshSecret: string;
      accessTtlSeconds: number;
      refreshTtlSeconds: number;
    },
    private readonly cache: CacheAdapter,
  ) {}

  // ---------- password hashing (PBKDF2-SHA256) ----------

  async hashPassword(plain: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const key = await this.derive(plain, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(key)}`;
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    const parsed = this.parseHash(hash);
    if (!parsed) return false;
    const candidate = await this.derive(plain, parsed.salt, parsed.iterations);
    return this.constantTimeEqual(candidate, parsed.key);
  }

  private async derive(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plain),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
      keyMaterial,
      KEY_LENGTH_BYTES * 8,
    );
    return new Uint8Array(bits);
  }

  private parseHash(hash: string): ParsedHash | null {
    try {
      const parts = hash.split('$');
      if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
      const iterations = Number(parts[1]);
      if (!Number.isFinite(iterations) || iterations <= 0) return null;
      return {
        iterations,
        salt: b64ToBytes(parts[2]),
        key: b64ToBytes(parts[3]),
      };
    } catch {
      // Malformed hash string (e.g. non-base64 characters in salt/key).
      // Return null so verifyPassword fails closed instead of throwing.
      return null;
    }
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]) as number;
    return diff === 0;
  }

  // ---------- JWT (HS256) ----------

  private async sign(payload: object, secret: string, ttlSeconds: number): Promise<{ token: string; claims: AccessTokenClaims & RefreshTokenClaims }> {
    const now = Math.floor(Date.now() / 1000);
    // H5: iss + aud claims. Both must be present and match on verify.
    const claims = {
      ...payload,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      exp: now + ttlSeconds,
    } as AccessTokenClaims & RefreshTokenClaims;
    const header = { alg: 'HS256', typ: 'JWT' };
    // base64url-encode each segment (NOT standard base64 — see bytesToB64Url).
    const enc = (o: object) => bytesToB64Url(new TextEncoder().encode(JSON.stringify(o)));
    const data = `${enc(header)}.${enc(claims)}`;
    const sig = await crypto.subtle.sign(
      'HMAC',
      await this.hmacKey(secret),
      new TextEncoder().encode(data),
    );
    return { token: `${data}.${bytesToB64Url(new Uint8Array(sig))}`, claims };
  }

  private async verify(token: string, secret: string): Promise<Record<string, unknown> | null> {
    // ── All parsing is wrapped in try/catch so a malformed token returns
    //    null (→ "unauthenticated") instead of throwing a 500. Previously
    //    a token with non-base64 chars in the payload (e.g. a stray `=`)
    //    would throw inside `atob()` and bubble up as a 500 INTERNAL_ERROR,
    //    which (a) leaks that the token was being parsed and (b) is just
    //    wrong — an unparseable token is "not authenticated", not a server
    //    error. ──
    let parts: string[];
    try {
      parts = token.split('.');
    } catch {
      return null;
    }
    if (parts.length !== 3) return null;
    const [headerPart, claimsPart, sigPart] = parts as [string, string, string];
    const data = `${headerPart}.${claimsPart}`;

    // Recompute the HMAC over the header.payload segment.
    let sig: ArrayBuffer;
    try {
      sig = await crypto.subtle.sign('HMAC', await this.hmacKey(secret), new TextEncoder().encode(data));
    } catch {
      return null;
    }
    const expected = bytesToB64Url(new Uint8Array(sig));

    // H5: constant-time signature comparison. Previously this was a `!==`
    // string compare, which short-circuits on the first mismatched byte —
    // a remote timing attack could brute-force the signature byte-by-byte
    // (each correct byte makes the comparison take one cycle longer).
    // safeEqualB64Url hashes both sides with SHA-256 (fixed 32-byte output)
    // then uses crypto.timingSafeEqual on the digests.
    if (!safeEqualB64Url(expected, sigPart)) return null;

    // Decode + parse the claims. Both steps can throw on malformed input.
    let claims: Record<string, unknown>;
    try {
      const claimBytes = b64UrlToBytes(claimsPart);
      const claimJson = new TextDecoder().decode(claimBytes);
      claims = JSON.parse(claimJson) as Record<string, unknown>;
    } catch {
      return null; // malformed payload → not authenticated
    }

    // ── exp (required, must be in the future) ──
    const exp = claims.exp as number | undefined;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    if (Date.now() / 1000 > exp) return null;

    // ── iss + aud (H5) ──
    // Both must be present and match exactly. A token without these claims
    // is rejected — even if the signature is valid, it wasn't minted by
    // this adapter (it might be a token from a different system that
    // happens to share the HMAC secret).
    if (claims.iss !== JWT_ISSUER) return null;
    // `aud` may be a string OR an array of strings per RFC 7519. We always
    // emit a single string, but accept the array form on verify for
    // forward-compat (and to be strict about the spec).
    const aud = claims.aud;
    const audOk =
      aud === JWT_AUDIENCE ||
      (Array.isArray(aud) && aud.every((x) => typeof x === 'string') && aud.includes(JWT_AUDIENCE));
    if (!audOk) return null;

    return claims;
  }

  private async hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }

  // ---------- token issuance ----------

  async issueAccessToken(user: Pick<User, 'id' | 'shopId' | 'role'>): Promise<{ token: string; claims: AccessTokenClaims }> {
    const { token, claims } = await this.sign(
      { sub: user.id, shopId: user.shopId, role: user.role, type: 'access' },
      this.config.accessSecret,
      this.config.accessTtlSeconds,
    );
    return { token, claims: claims as unknown as AccessTokenClaims };
  }

  async issueRefreshToken(user: Pick<User, 'id' | 'shopId' | 'role'>): Promise<{ token: string; claims: RefreshTokenClaims }> {
    const jti = crypto.randomUUID();
    const { token, claims } = await this.sign(
      { sub: user.id, shopId: user.shopId, role: user.role, type: 'refresh', jti },
      this.config.refreshSecret,
      this.config.refreshTtlSeconds,
    );
    // Store the jti so we can revoke / detect replayed rotation.
    await this.cache.set(`refresh:${jti}`, user.id, this.config.refreshTtlSeconds);
    return { token, claims: claims as unknown as RefreshTokenClaims };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    const claims = await this.verify(token, this.config.accessSecret);
    if (!claims || claims.type !== 'access') return null;
    return claims as unknown as AccessTokenClaims;
  }

  /**
   * H16 fix: side-effect-free refresh-token verification.
   *
   * Unlike `rotateRefreshToken`, this does NOT delete the jti from the cache
   * or mint a new token pair — it just returns the claims (or null if the
   * token is malformed, expired, or has the wrong issuer/audience). The
   * logout route uses this to extract `jti` so it can call
   * `revokeRefreshToken(jti)`.
   *
   * Note: we do NOT additionally require the jti to still be live in the
   * cache here. The rotate path does (replay guard), but for logout the
   * caller's intent is "kill this session if it's still alive" — if the jti
   * was already revoked/rotated, `cache.del()` is a no-op and logout still
   * succeeds idempotently. This matches the user's mental model: pressing
   * "Log out" should always work, even if the session was already gone.
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null> {
    const claims = await this.verify(token, this.config.refreshSecret);
    if (!claims || claims.type !== 'refresh' || typeof claims.jti !== 'string') return null;
    return claims as unknown as RefreshTokenClaims;
  }

  async rotateRefreshToken(token: string): Promise<{ access: string; refresh: string } | null> {
    const claims = await this.verify(token, this.config.refreshSecret);
    if (!claims || claims.type !== 'refresh' || typeof claims.jti !== 'string') return null;
    // Replay guard: the jti must still be live.
    const live = await this.cache.get(`refresh:${claims.jti}`);
    if (!live) return null;
    // Rotate: delete the old jti, issue a fresh pair.
    await this.cache.del(`refresh:${claims.jti}`);
    const role = claims.role as UserRole;
    const userId = claims.sub as string;
    const shopId = (claims.shopId as string | null) ?? null;
    const access = await this.issueAccessToken({ id: userId, shopId, role });
    const refresh = await this.issueRefreshToken({ id: userId, shopId, role });
    return { access: access.token, refresh: refresh.token };
  }

  async revokeRefreshToken(jti: string): Promise<void> {
    await this.cache.del(`refresh:${jti}`);
  }
}
