import type { Shop, ShopPricingConfig, PaymentProvider, SubscriptionTier } from '@platform/core/domain';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@platform/core/errors';
import { encryptCredentials, decryptCredentials } from '@/lib/crypto/credential-encryption';

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
  description: string | null;
  businessHours: string | null;
  logoUrl: string | null;
  upiQrStorageKey: string | null;
  servicesJson: string | null;
  paymentPhone: string | null;
  paymentInstructions: string | null;
  cashOnPickup: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Maps a raw DB row to the domain Shop aggregate. Decrypts payment credentials. */
function toDomain(row: ShopRow): Shop {
  let paymentCredentials: Record<string, unknown>;
  try {
    // Try decrypting (production path — encrypted at rest).
    paymentCredentials = row.paymentCredentials && row.paymentCredentials.startsWith('v1:')
      ? decryptCredentials(row.paymentCredentials)
      : JSON.parse(row.paymentCredentials || '{}'); // dev fallback (plain JSON)
  } catch {
    paymentCredentials = {}; // decryption failed — return empty (fail-safe)
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.ownerUserId,
    upiId: row.upiId,
    paymentProvider: row.paymentProvider as PaymentProvider,
    paymentCredentials,
    pricingConfig: JSON.parse(row.pricingConfig || '{}') as ShopPricingConfig,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    isActive: row.isActive,
    subscriptionTier: row.subscriptionTier as SubscriptionTier,
    subscriptionExpiresAt: row.subscriptionExpiresAt,
    description: row.description,
    businessHours: row.businessHours,
    logoUrl: row.logoUrl,
    upiQrStorageKey: row.upiQrStorageKey,
    servicesJson: row.servicesJson,
    paymentPhone: row.paymentPhone,
    paymentInstructions: row.paymentInstructions,
    cashOnPickup: row.cashOnPickup ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Prepares a domain Shop (or partial) for insert/update — encrypts creds + JSON-stringifies. */
function toRow(input: Partial<Shop>): Partial<ShopRow> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'paymentCredentials') {
      if (v && Object.keys(v as Record<string, unknown>).length > 0) {
        out[k] = encryptCredentials(v as Record<string, unknown>); // encrypt at rest
      } else {
        // The DB column is NOT NULL — store an encrypted empty object instead of undefined.
        out[k] = encryptCredentials({});
      }
    } else if (k === 'pricingConfig') {
      out[k] = v ? JSON.stringify(v) : undefined;
    } else {
      out[k] = v;
    }
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

  /** List active shops (public discovery). Does NOT return credentials. */
  async listActive(limit = 20, offset = 0): Promise<Shop[]> {
    const rows = await this.findMany(
      { isActive: true },
      { limit, offset, order: ['createdAt', 'desc'] },
    );
    return rows.map(toDomain);
  }

  /** List ALL shops (admin only). Includes inactive. */
  async listAll(limit = 100, offset = 0): Promise<Shop[]> {
    const rows = await this.findMany(
      {},
      { limit, offset, order: ['createdAt', 'desc'] },
    );
    return rows.map(toDomain);
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
