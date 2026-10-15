import type { User, UserRole } from '@platform/core/domain';
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
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    role: row.role as UserRole,
    shopId: row.shopId,
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
  }, auth: AuthAdapter): Promise<User> {
    const passwordHash = await auth.hashPassword(input.password);
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      shopId: input.shopId,
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
    const [updated] = await this.updateWhere({ id }, patch as Partial<UserRow>);
    if (!updated) throw new UnauthorizedError(`User ${id} not found`);
    return toDomain(updated);
  }
}
