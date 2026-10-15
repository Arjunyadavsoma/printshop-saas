import type { User } from '../domain';
import type { AccessTokenClaims, RefreshTokenClaims } from '../domain';

/**
 * Auth abstraction so we can swap Lucia ↔ Supabase Auth ↔ a custom JWT impl
 * without touching the route layer.
 */
export interface AuthAdapter {
  readonly provider: string;
  /** Hash a password with argon2id. */
  hashPassword(plain: string): Promise<string>;
  /** Verify a password against a stored hash. Constant-time. */
  verifyPassword(plain: string, hash: string): Promise<boolean>;
  /** Issue a short-lived access token. */
  issueAccessToken(user: Pick<User, 'id' | 'shopId' | 'role'>): Promise<{ token: string; claims: AccessTokenClaims }>;
  /** Issue a rotating refresh token (stores its `jti` for revocation). */
  issueRefreshToken(user: Pick<User, 'id' | 'shopId' | 'role'>): Promise<{ token: string; claims: RefreshTokenClaims }>;
  /** Verify an access token and return its claims, or `null`. */
  verifyAccessToken(token: string): Promise<AccessTokenClaims | null>;
  /** Verify a refresh token AND rotate it (returns the new pair). */
  rotateRefreshToken(token: string): Promise<{ access: string; refresh: string } | null>;
  /** Revoke a refresh token by jti (logout / breach). */
  revokeRefreshToken(jti: string): Promise<void>;
}
