import type { Shop, ShopPricingConfig, PaymentProvider, SubscriptionTier } from '@platform/core/domain';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';

/** Raw Prisma row shape for the Shop model. */
interface ShopRow {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  upiId: string;
  paymentProvider: string;
  paymentCredentials: string; // JSON string
  pricingConfig: string; // JSON string
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  subscriptionTier: string;
  subscriptionExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Maps a raw DB row to the domain Shop aggregate. */
function toDomain(row: ShopRow): Shop {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.ownerUserId,
    upiId: row.upiId,
    paymentProvider: row.paymentProvider as PaymentProvider,
    paymentCredentials: JSON.parse(row.paymentCredentials || '{}'),
    pricingConfig: JSON.parse(row.pricingConfig || '{}') as ShopPricingConfig,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    isActive: row.isActive,
    subscriptionTier: row.subscriptionTier as SubscriptionTier,
    subscriptionExpiresAt: row.subscriptionExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Prepares a domain Shop (or partial) for insert/update — JSON-stringifies. */
function toRow(input: Partial<Shop>): Partial<ShopRow> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'paymentCredentials') out[k] = v ? JSON.stringify(v) : undefined;
    else if (k === 'pricingConfig') out[k] = v ? JSON.stringify(v) : undefined;
    else out[k] = v;
  }
  return out as Partial<ShopRow>;
}

export class ShopRepository extends BaseRepository<ShopRow> {
  async findBySlug(slug: string): Promise<Shop | null> {
    const row = await this.findOne({ slug });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<Shop | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  async findByOwner(ownerUserId: string): Promise<Shop | null> {
    const row = await this.findOne({ ownerUserId });
    return row ? toDomain(row) : null;
  }

  /** Get-or-throw helper for routes. */
  async getByOwner(ownerUserId: string): Promise<Shop> {
    const shop = await this.findByOwner(ownerUserId);
    if (!shop) throw new NotFoundError('Shop not found for this user');
    return shop;
  }

  async create(shop: Shop): Promise<Shop> {
    const row = await this.insertOne(toRow(shop) as ShopRow);
    return toDomain(row);
  }

  async update(id: string, patch: Partial<Shop>): Promise<Shop> {
    const [updated] = await this.updateWhere({ id }, toRow(patch));
    if (!updated) throw new NotFoundError(`Shop ${id} not found`);
    return toDomain(updated);
  }
}
