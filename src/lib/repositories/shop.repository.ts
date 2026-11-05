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
  paymentMethods: string | null;
  pamphletEnabled: boolean | null;
  pamphletPricePaise: number | null;
  pamphletName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Maps a raw DB row to the domain Shop aggregate. Decrypts payment credentials. */
function toDomain(row: ShopRow): Shop {
  let paymentCredentials: Record<string, unknown>;
  try {
    if (row.paymentCredentials && row.paymentCredentials.startsWith('v1:')) {
      // Encrypted path (production) — decrypt with AES-256-GCM.
      paymentCredentials = decryptCredentials(row.paymentCredentials);
    } else if (process.env.NODE_ENV === 'production') {
      // ENC-001 fix: in production, a non-encrypted (non-v1: prefixed) credential
      // blob is a SECURITY ERROR — refuse to serve plaintext credentials in prod.
      // Previously this silently parsed as plaintext JSON regardless of NODE_ENV,
      // which could expose credentials if a migration left them un-encrypted.
      console.error('[shop.repository] FATAL: unencrypted paymentCredentials in production — refusing to serve. Shop:', row.id);
      paymentCredentials = {};
    } else {
      // Dev fallback: plaintext JSON (for local dev without PAYMENT_ENCRYPTION_KEY).
      paymentCredentials = JSON.parse(row.paymentCredentials || '{}');
    }
  } catch (e) {
    // ENC-003 fix: log the decrypt failure (without leaking secrets) so
    // key-rotation incidents are visible. Previously this was silent.
    console.error('[shop.repository] credential decrypt failed:', e instanceof Error ? e.message : String(e), '— shop:', row.id);
    paymentCredentials = {}; // fail-safe — empty credentials, no secrets exposed
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
    paymentMethods: row.paymentMethods ?? 'both',
    pamphletEnabled: row.pamphletEnabled ?? false,
    pamphletPricePaise: row.pamphletPricePaise ?? 0,
    pamphletName: row.pamphletName ?? null,
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

  /**
   * Batch fetch shops by id (ARCH-004 fix — admin orders list was doing
   * N+1 sequential findById calls to enrich each order row with its shop
   * name; this does a single WHERE id IN (...) query + returns a Map
   * for easy per-order lookup).
   */
  async findByIds(ids: string[]): Promise<Map<string, Shop>> {
    const result = new Map<string, Shop>();
    if (ids.length === 0) return result;
    const uniqueIds = [...new Set(ids)]; // dedupe — the in-memory adapter's `in` works but no point sending dupes
    const rows = await this.findMany({ id: { in: uniqueIds } });
    for (const row of rows) {
      result.set(row.id, toDomain(row));
    }
    return result;
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
