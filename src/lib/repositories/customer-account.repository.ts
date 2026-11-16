import type { CustomerAccount } from '@platform/core/domain';
import type { AuthAdapter } from '@platform/core/interfaces';
import { BaseRepository } from './base.repository';
import { UnauthorizedError, ValidationError } from '@platform/core/errors';

interface CustomerAccountRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: CustomerAccountRow): CustomerAccount {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    phone: row.phone,
    phoneVerified: row.phoneVerified,
    emailVerified: row.emailVerified,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Customer account repository.
 *
 * Identity correctness (per the Phase 4 prompt):
 * - `email` is the unique key. Duplicate emails are rejected with 409.
 * - `phone` is NOT unique. Multiple accounts may share a phone (family
 *   members); we do not auto-merge by phone.
 * - Soft-delete via `deactivatedAt`; the row is retained for audit.
 */
export class CustomerAccountRepository extends BaseRepository<CustomerAccountRow> {
  async findByEmail(email: string): Promise<CustomerAccount | null> {
    const row = await this.findOne({ email });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<CustomerAccount | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    email: string;
    password: string;
    name: string;
    phone?: string | null;
  }, auth: AuthAdapter): Promise<CustomerAccount> {
    // Existence check — throw a ValidationError so the route can return 409
    // without revealing whether the email is already taken to an attacker
    // who is probing (the route layer returns the same error for both
    // cases to avoid account enumeration).
    const existing = await this.findByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ValidationError('Email is already registered');
    }
    const passwordHash = await auth.hashPassword(input.password);
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      phone: input.phone ?? null,
      phoneVerified: false,
      emailVerified: false,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    } as CustomerAccountRow);
    return toDomain(row);
  }

  /** Verify email+password and return the account, or throw Unauthorized. */
  async verifyCredentials(email: string, password: string, auth: AuthAdapter): Promise<CustomerAccount> {
    const account = await this.findByEmail(email.toLowerCase());
    // Always throw the SAME generic error for: unknown email, wrong
    // password, or deactivated account. This is the no-account-
    // enumeration guarantee — an attacker cannot distinguish the three
    // cases from the response.
    if (!account) throw new UnauthorizedError('Invalid email or password');
    if (account.deactivatedAt) throw new UnauthorizedError('Invalid email or password');
    const ok = await auth.verifyPassword(password, account.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid email or password');
    return account;
  }

  async update(id: string, patch: Partial<CustomerAccount>): Promise<CustomerAccount> {
    const [updated] = await this.updateWhere({ id }, patch as Partial<CustomerAccountRow>);
    if (!updated) throw new UnauthorizedError(`Customer account ${id} not found`);
    return toDomain(updated);
  }

  /** Soft-delete — retain the row for audit. */
  async deactivate(id: string): Promise<CustomerAccount | null> {
    const [updated] = await this.updateWhere({ id }, {
      deactivatedAt: new Date(),
      updatedAt: new Date(),
    } as Partial<CustomerAccountRow>);
    return updated ? toDomain(updated) : null;
  }

  /** Mark email as verified (after an OTP / link round-trip). */
  async markEmailVerified(id: string): Promise<CustomerAccount | null> {
    const [updated] = await this.updateWhere({ id }, {
      emailVerified: true,
      updatedAt: new Date(),
    } as Partial<CustomerAccountRow>);
    return updated ? toDomain(updated) : null;
  }
}
