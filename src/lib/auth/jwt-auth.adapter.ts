import type {
  AuthAdapter,
} from '@platform/core/interfaces';
import type { AccessTokenClaims, RefreshTokenClaims, User, UserRole } from '@platform/core/domain';
import type { CacheAdapter } from '@platform/core/interfaces';

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation for SHA-256
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

/** A parsed PBKDF2 hash string: `pbkdf2$<iterations>$<saltB64>$<keyB64>`. */
interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  key: Uint8Array;
}

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

/**
 * JWT (HS256) + PBKDF2 auth adapter built on the Web Crypto SubtleCrypto API.
 *
 * No external dependencies — works in the Next.js Edge/Node runtime. The
 * production target is argon2id (per the spec); swapping is a matter of
 * replacing this concrete, since every caller depends on the {@link AuthAdapter}
 * interface. PBKDF2-SHA256 with 600k iterations is OWASP-recommended and
 * sufficient for the demo backend.
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
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
    return {
      iterations: Number(parts[1]),
      salt: b64ToBytes(parts[2]),
      key: b64ToBytes(parts[3]),
    };
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
    const claims = { ...payload, iat: now, exp: now + ttlSeconds } as AccessTokenClaims & RefreshTokenClaims;
    const header = { alg: 'HS256', typ: 'JWT' };
    const enc = (o: object) => bytesToB64(new TextEncoder().encode(JSON.stringify(o)));
    const data = `${enc(header)}.${enc(claims)}`;
    const sig = await crypto.subtle.sign(
      'HMAC',
      await this.hmacKey(secret),
      new TextEncoder().encode(data),
    );
    return { token: `${data}.${bytesToB64(new Uint8Array(sig))}`, claims };
  }

  private async verify(token: string, secret: string): Promise<Record<string, unknown> | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [data, sigPart] = [parts.slice(0, 2).join('.'), parts[2]];
    const sig = await crypto.subtle.sign('HMAC', await this.hmacKey(secret), new TextEncoder().encode(data));
    const expected = bytesToB64(new Uint8Array(sig));
    if (expected !== sigPart) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64ToBytes(parts[1]))) as Record<string, unknown>;
    const exp = claims.exp as number | undefined;
    if (typeof exp !== 'number' || Date.now() / 1000 > exp) return null;
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
