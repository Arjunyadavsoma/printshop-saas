import type { Subscription, SubscriptionTier, SubscriptionStatus } from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface SubscriptionRow {
  id: string;
  shopId: string;
  tier: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  provider: string;
  providerSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    shopId: row.shopId,
    tier: row.tier as SubscriptionTier,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    provider: row.provider as Subscription['provider'],
    providerSubscriptionId: row.providerSubscriptionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Subscription repository — one row per shop (`shopId` is unique in the
 * schema). The lifecycle of that row IS the authoritative entitlement
 * state; the `Shop.subscriptionTier` + `subscriptionExpiresAt` fields
 * are denormalised copies for fast UI rendering.
 *
 * Mutations are intentionally narrow: `upsert`, `updateStatus`, and
 * `renew`. Every mutation is paired with an audit-log call at the
 * service layer (not here) so the lifecycle is traceable.
 */
export class SubscriptionRepository extends BaseRepository<SubscriptionRow> {
  /** Find a shop's subscription. Returns null when no row exists. */
  async findByShop(shopId: string): Promise<Subscription | null> {
    const row = await this.findOne({ shopId });
    return row ? toDomain(row) : null;
  }

  /**
   * Create the subscription row if it doesn't already exist. Used by the
   * shop registration flow + admin approval. Idempotent on `shopId`.
   */
  async upsert(input: {
    shopId: string;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    provider?: Subscription['provider'];
    providerSubscriptionId?: string | null;
  }): Promise<Subscription> {
    const existing = await this.findByShop(input.shopId);
    const rowShape: SubscriptionRow = {
      id: existing?.id ?? crypto.randomUUID(),
      shopId: input.shopId,
      tier: input.tier,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      provider: input.provider ?? 'internal',
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    if (existing) {
      const [updated] = await this.updateWhere({ shopId: input.shopId }, rowShape);
      return toDomain(updated ?? rowShape);
    }
    const inserted = await this.insertOne(rowShape);
    return toDomain(inserted);
  }

  /** Update just the status (with `updatedAt` bumped). */
  async updateStatus(shopId: string, status: SubscriptionStatus): Promise<Subscription | null> {
    const [updated] = await this.updateWhere({ shopId }, {
      status,
      updatedAt: new Date(),
    } as Partial<SubscriptionRow>);
    return updated ? toDomain(updated) : null;
  }

  /**
   * Renew the subscription — extend `currentPeriodEnd` and (optionally)
   * change the tier. Caller is responsible for the audit-log entry.
   * `newPeriodEnd` MUST be in the future; the service layer enforces it.
   */
  async renew(shopId: string, newPeriodEnd: Date, tier?: SubscriptionTier): Promise<Subscription | null> {
    const patch: Partial<SubscriptionRow> = {
      currentPeriodEnd: newPeriodEnd,
      status: 'active',
      updatedAt: new Date(),
    };
    if (tier) patch.tier = tier;
    const [updated] = await this.updateWhere({ shopId }, patch);
    return updated ? toDomain(updated) : null;
  }

  /**
   * List subscriptions whose current period has ended but the status is
   * still `active` / `payment_pending` / `trial` — the cron uses this to
   * drive them to `expired` or `grace_period`.
   */
  async listEndedButActive(now: Date): Promise<Subscription[]> {
    const all = await this.findMany({});
    return all
      .map(toDomain)
      .filter(
        (s) =>
          s.currentPeriodEnd <= now &&
          (s.status === 'active' ||
            s.status === 'payment_pending' ||
            s.status === 'trial' ||
            s.status === 'granted_free' ||
            s.status === 'renewed'),
      );
  }
}
