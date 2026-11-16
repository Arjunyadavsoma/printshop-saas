import { z } from 'zod';
import { USER_ROLES, ADMIN_PERMISSIONS, type UserRole, type AdminPermission } from './enums';

/** A user account (shop owner, staff, or platform admin). */
export interface User {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  shopId: string | null;
  /**
   * JSON-encoded array of {@link AdminPermission} values. Only meaningful
   * when `role === 'admin'`. `null` for non-admin roles. Stored as a JSON
   * string in Postgres (text column) and parsed on read.
   */
  adminPermissions: AdminPermission[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().max(20),
  passwordHash: z.string(),
  role: z.enum(USER_ROLES as [UserRole, ...UserRole[]]),
  shopId: z.string().uuid().nullable(),
  adminPermissions: z.array(z.enum(ADMIN_PERMISSIONS as [AdminPermission, ...AdminPermission[]])).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Payload embedded in a JWT access token. */
export interface AccessTokenClaims {
  sub: string;
  shopId: string | null;
  role: UserRole;
  /**
   * Admin permissions carried in the JWT so middleware can authorize
   * admin actions without a DB lookup. `null` for non-admin roles.
   * The DB is the source of truth — `withAdminPermission` re-checks
   * the user row so a revoked permission takes effect on the next
   * request even if the JWT is still valid.
   */
  perms: AdminPermission[] | null;
  type: 'access';
  iat: number;
  exp: number;
}

/** Payload embedded in a rotating refresh token. */
export interface RefreshTokenClaims {
  sub: string;
  shopId: string | null;
  role: UserRole;
  type: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Returns true if `perms` grants `required`.
 *
 * - A `'*'` (super-admin) entry matches every permission.
 * - An empty list or `null` matches nothing — fail-closed.
 * - The `required` permission itself is matched exactly.
 *
 * Pure function; safe to use in middleware, tests, and the client.
 */
export function hasAdminPermission(
  perms: AdminPermission[] | null | undefined,
  required: AdminPermission,
): boolean {
  if (!perms || perms.length === 0) return false;
  if (perms.includes('*')) return true;
  return perms.includes(required);
}
