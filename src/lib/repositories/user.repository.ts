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
  clerkId: string | null;
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
    clerkId: row.clerkId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class UserRepository extends BaseRepository<UserRow> {
  /**
   * Find a user by email.
   *
   * H-2 fix: emails are NORMALISED TO LOWERCASE before lookup. Previously
   * the lookup was case-sensitive (Postgres `=` on a text column is
   * case-sensitive by default), so a user who registered as
   * `User@Example.com` could NOT log in as `user@example.com` — the lookup
   * returned null and `verifyCredentials` threw `Invalid email or password`.
   * Registration now stores emails lowercased (see /api/v1/auth/register);
   * this lookup also lowercases the input so legacy mixed-case rows are
   * still found by their lowercased equivalent (which is the value users
   * type in most of the time).
   */
  async findByEmail(email: string): Promise<User | null> {
    const row = await this.findOne({ email: email.toLowerCase() });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  /** Find a user by their linked Clerk id (`user_…`). */
  async findByClerkId(clerkId: string): Promise<User | null> {
    const row = await this.findOne({ clerkId });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    email: string;
    phone: string;
    password: string;
    role: UserRole;
    shopId: string | null;
    /** Clerk user id to link at creation (Clerk sign-up path). */
    clerkId?: string | null;
  }, auth: AuthAdapter): Promise<User> {
    const passwordHash = await auth.hashPassword(input.password);
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      // H-2 fix: store emails lowercased so lookups are case-insensitive.
      // A UNIQUE constraint on `email` would otherwise treat
      // `User@Example.com` and `user@example.com` as two different rows,
      // letting the same person register twice.
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash,
      role: input.role,
      shopId: input.shopId,
      clerkId: input.clerkId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserRow);
    return toDomain(row);
  }

  /** Verify email+password and return the user, or throw Unauthorized.
   *
   * H-2 fix: the email is lowercased before lookup (see {@link findByEmail}). */
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

  /** Delete a user by id. Used only as best-effort cleanup when a
      registration fails after the owner row was created, so a failed
      attempt does not poison every retry with EMAIL_TAKEN. */
  async deleteById(id: string): Promise<void> {
    await this.deleteWhere({ id });
  }
}
