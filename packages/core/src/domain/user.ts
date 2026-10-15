import { z } from 'zod';
import { USER_ROLES, type UserRole } from './enums';

/** A user account (shop owner, staff, or platform admin). */
export interface User {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  shopId: string | null;
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
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Payload embedded in a JWT access token. */
export interface AccessTokenClaims {
  sub: string;
  shopId: string | null;
  role: UserRole;
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
