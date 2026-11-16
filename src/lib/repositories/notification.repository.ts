import type {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from '@platform/core/domain';
import { BaseRepository } from './base.repository';

interface NotificationRow {
  id: string;
  shopId: string | null;
  recipientId: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  channel: string;
  eventType: string;
  entityId: string | null;
  subject: string | null;
  body: string;
  payload: string | null;
  dedupKey: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: NotificationRow): Notification {
  return {
    id: row.id,
    shopId: row.shopId,
    recipientId: row.recipientId,
    recipientEmail: row.recipientEmail,
    recipientPhone: row.recipientPhone,
    channel: row.channel as NotificationChannel,
    eventType: row.eventType,
    entityId: row.entityId,
    subject: row.subject,
    body: row.body,
    payload: row.payload,
    dedupKey: row.dedupKey,
    status: row.status as NotificationStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    sentAt: row.sentAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface EnqueueInput {
  shopId?: string | null;
  recipientId?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  channel: NotificationChannel;
  eventType: string;
  entityId?: string | null;
  subject?: string | null;
  body: string;
  payload?: Record<string, unknown> | null;
  dedupKey?: string | null;
  maxAttempts?: number;
}

/**
 * Notification outbox repository.
 *
 * The `enqueue` method is idempotent on `dedupKey` (the column has a
 * unique constraint) — a retried event with the same dedupKey does
 * not create a duplicate row. The repository returns the existing
 * row in that case so the caller can observe "we already queued
 * this".
 */
export class NotificationRepository extends BaseRepository<NotificationRow> {
  /**
   * Enqueue a notification. Idempotent on `dedupKey` — if a row with
   * the same dedupKey already exists, returns it without creating a
   * duplicate. The caller treats both cases the same: "the
   * notification is queued".
   */
  async enqueue(input: EnqueueInput): Promise<Notification> {
    if (input.dedupKey) {
      const existing = await this.findOne({ dedupKey: input.dedupKey });
      if (existing) return toDomain(existing);
    }
    const now = new Date();
    const row = await this.insertOne({
      id: crypto.randomUUID(),
      shopId: input.shopId ?? null,
      recipientId: input.recipientId ?? null,
      recipientEmail: input.recipientEmail ?? null,
      recipientPhone: input.recipientPhone ?? null,
      channel: input.channel,
      eventType: input.eventType,
      entityId: input.entityId ?? null,
      subject: input.subject ?? null,
      body: input.body,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      dedupKey: input.dedupKey ?? null,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextAttemptAt: now,
      lastError: null,
      sentAt: null,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    } as NotificationRow);
    return toDomain(row);
  }

  /** Find by id (for the in-app read endpoint). */
  async findById(id: string): Promise<Notification | null> {
    const row = await this.findOne({ id });
    return row ? toDomain(row) : null;
  }

  /** List a recipient's in-app notifications. */
  async listForRecipient(recipientId: string, opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {}): Promise<Notification[]> {
    const filter: Record<string, unknown> = { recipientId, channel: 'in_app' };
    if (opts.unreadOnly) filter.readAt = null;
    const rows = await this.findMany(filter, {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      order: ['createdAt', 'desc'],
    });
    return rows.map(toDomain);
  }

  /** List notifications ready to dispatch (nextAttemptAt <= now, status=pending). */
  async listReady(now: Date, limit: number = 50): Promise<Notification[]> {
    const all = await this.findMany({ status: 'pending' }, { limit: 1000 });
    return all
      .map(toDomain)
      .filter((n) => n.nextAttemptAt <= now)
      .slice(0, limit);
  }

  /** Mark a notification as sent. */
  async markSent(id: string): Promise<Notification | null> {
    const [updated] = await this.updateWhere({ id }, {
      status: 'sent',
      sentAt: new Date(),
      updatedAt: new Date(),
    } as Partial<NotificationRow>);
    return updated ? toDomain(updated) : null;
  }

  /** Mark a notification as failed (terminal — no more retries). */
  async markFailed(id: string, error: string): Promise<Notification | null> {
    const [updated] = await this.updateWhere({ id }, {
      status: 'failed',
      lastError: error,
      updatedAt: new Date(),
    } as Partial<NotificationRow>);
    return updated ? toDomain(updated) : null;
  }

  /**
   * Record an attempt failure and schedule the next retry with
   * exponential backoff. Returns the updated row, or null if the
   * notification has exhausted its retries (the caller should then
   * call `markFailed`).
   */
  async recordAttemptFailure(id: string, error: string): Promise<Notification | null> {
    const current = await this.findOne({ id });
    if (!current) return null;
    const attempts = current.attempts + 1;
    if (attempts >= current.maxAttempts) {
      // Final attempt — mark failed AND increment attempts so the
      // row records how many tries were made.
      const [updated] = await this.updateWhere({ id }, {
        attempts,
        status: 'failed',
        lastError: error,
        updatedAt: new Date(),
      } as Partial<NotificationRow>);
      return updated ? toDomain(updated) : null;
    }
    // Exponential backoff: 30s, 2m, 8m, 32m, 128m (capped).
    const backoffMs = Math.min(30_000 * Math.pow(4, attempts), 128 * 60 * 1000);
    const [updated] = await this.updateWhere({ id }, {
      attempts,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + backoffMs),
      updatedAt: new Date(),
    } as Partial<NotificationRow>);
    return updated ? toDomain(updated) : null;
  }

  /** Mark an in-app notification as read. */
  async markRead(id: string): Promise<Notification | null> {
    const [updated] = await this.updateWhere({ id }, {
      readAt: new Date(),
      updatedAt: new Date(),
    } as Partial<NotificationRow>);
    return updated ? toDomain(updated) : null;
  }
}
