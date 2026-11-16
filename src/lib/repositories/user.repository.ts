import type { User, UserRole, AdminPermission } from '@platform/core/domain';
import { ADMIN_PERMISSIONS } from '@platform/core/domain';
import type { AuthAdapter } from '@platform/core/interfaces';
import { BaseRepository } from './base.repository';
import { UnauthorizedError } from '@platform/core/errors';

interface UserRow {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: string;
  shopId: string | null;
  adminPermissions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parse the `adminPermissions` text column into a typed array.
 * Invalid / unknown values are dropped silently (defence in depth) so a
 * hand-edited DB row can't crash the API. Empty / null → null (no perms).
 */
function parsePerms(raw: string | null | undefined): AdminPermission[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = new Set<string>(ADMIN_PERMISSIONS);
    const filtered = parsed.filter((p): p is AdminPermission => typeof p === 'string' && valid.has(p));
    return filtered.length === 0 ? null : filtered;
  } catch {
    return null;
  }
}

/** Serialise permissions for storage. null/empty → null (smaller, clearer). */
function serializePerms(perms: AdminPermission[] | null | undefined): string | null {
  if (!perms || perms.length === 0) return null;
  return JSON.stringify(perms);
}

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    role: row.role as UserRole,
    shopId: row.shopId,
    adminPermissions: parsePerms(row.adminPermissions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class UserRepository extends BaseRepository<UserRow> {
  async findByEmail(email: string): Promise<User | null> {
    const row = await this.findOne({ email });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    email: string;
    phone: string;
    password: string;
    role: UserRole;
    shopId: string | null;
    adminPermissions?: AdminPermission[] | null;
  }, auth: AuthAdapter): Promise<User> {
    const passwordHash = await auth.hashPassword(input.password);
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      shopId: input.shopId,
      adminPermissions: serializePerms(input.adminPermissions ?? null),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserRow);
    return toDomain(row);
  }

  /** Verify email+password and return the user, or throw Unauthorized. */
  async verifyCredentials(email: string, password: string, auth: AuthAdapter): Promise<User> {
    const user = await this.findByEmail(email);
    if (!user) throw new UnauthorizedError('Invalid email or password');
    const ok = await auth.verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid email or password');
    return user;
  }

  /** Update a user — the only mutator the seed service should use. */
  async update(id: string, patch: Partial<User>): Promise<User> {
    const rowPatch: Partial<UserRow> = { ...patch } as Partial<UserRow>;
    if (patch.adminPermissions !== undefined) {
      rowPatch.adminPermissions = serializePerms(patch.adminPermissions);
    }
    const [updated] = await this.updateWhere({ id }, rowPatch);
    if (!updated) throw new UnauthorizedError(`User ${id} not found`);
    return toDomain(updated);
  }
}
