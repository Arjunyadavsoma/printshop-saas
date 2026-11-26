import type { CustomerAccount } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface CustomerAccountRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  clerkId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: CustomerAccountRow): CustomerAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    clerkId: row.clerkId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Customer accounts — the consumer side of Clerk sign-in.
 *
 * This repository ONLY touches the `CustomerAccount` table. It never reads or
 * writes `User`: the same Google account (same email, same Clerk id) can
 * be a shopkeeper and a customer at the same time, and the two identities
 * must stay independent — a customer sign-in must never link a Clerk id
 * onto an owner row, and must never create or overwrite a `User` row.
 */
export class CustomerAccountRepository extends BaseRepository<CustomerAccountRow> {
  /** Find a customer by email (lowercased before lookup, like users). */
  async findByEmail(email: string): Promise<CustomerAccount | null> {
    const row = await this.findOne({ email: email.toLowerCase() });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<CustomerAccount | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  /** Find a customer by their linked Clerk id (`user_…`). */
  async findByClerkId(clerkId: string): Promise<CustomerAccount | null> {
    const row = await this.findOne({ clerkId });
    return row ? toDomain(row) : null;
  }

  async create(input: {
    email: string;
    name?: string | null;
    phone?: string | null;
    clerkId?: string | null;
  }): Promise<CustomerAccount> {
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      phone: input.phone ?? null,
      clerkId: input.clerkId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CustomerAccountRow);
    return toDomain(row);
  }

  async update(id: string, patch: Partial<CustomerAccount>): Promise<CustomerAccount> {
    const [updated] = await this.updateWhere({ id }, patch as Partial<CustomerAccountRow>);
    if (!updated) throw new Error(`Customer ${id} not found`);
    return toDomain(updated);
  }
}
