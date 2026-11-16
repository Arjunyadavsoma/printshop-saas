import type { Notification, NotificationChannel } from '@platform/core/domain';
import type { EnqueueInput } from '@/lib/repositories/notification.repository';
import { getContainer } from '@/lib/container';

/**
 * Notification service — the single entry point for "tell someone
 * about an event". Writes a durable row to the outbox; a cron drains
 * it via `dispatchPending`.
 *
 * The service does NOT send the notification inline. This is the
 * outbox pattern: the row is the source of truth, and a retried
 * event does not create a duplicate (the `dedupKey` is unique).
 *
 * The cron (Phase 7) calls `dispatchPending` to drain the outbox by
 * calling the channel adapter (Email / SMS / in-app).
 */
export class NotificationService {
  /**
   * Enqueue a notification. Idempotent on `dedupKey` (the repository
   * enforces uniqueness; a retried event returns the existing row).
   *
   * `dedupKey` should be a stable hash of (eventType, recipientId,
   * entityId) so the same event retried does not create a duplicate.
   * Leave null for marketing broadcasts (no dedup).
   */
  async enqueue(input: EnqueueInput): Promise<Notification> {
    const { repos } = await import('@/lib/repositories');
    return repos.notifications.enqueue(input);
  }

  /**
   * Drain the outbox — called by the cron. Picks up to `limit`
   * pending notifications whose `nextAttemptAt <= now` and dispatches
   * each via the appropriate channel adapter.
   *
   * Failures are recorded with exponential backoff (the repository
   * does the math). After `maxAttempts`, the row is `failed`.
   *
   * Returns a summary so the cron can log it.
   */
  async dispatchPending(limit: number = 50): Promise<{ dispatched: number; sent: number; failed: number; retried: number }> {
    const { repos } = await import('@/lib/repositories');
    const container = getContainer();
    const now = new Date();
    const pending = await repos.notifications.listReady(now, limit);

    let sent = 0;
    let failed = 0;
    let retried = 0;

    for (const n of pending) {
      try {
        await this.dispatchOne(n);
        await repos.notifications.markSent(n.id);
        sent++;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        const updated = await repos.notifications.recordAttemptFailure(n.id, error);
        if (updated?.status === 'failed') {
          failed++;
        } else {
          retried++;
        }
        container.logger.error('notification dispatch failed', {
          notificationId: n.id,
          channel: n.channel,
          eventType: n.eventType,
          error,
        });
      }
    }

    return { dispatched: pending.length, sent, failed, retried };
  }

  /** Dispatch a single notification via its channel adapter. */
  private async dispatchOne(n: Notification): Promise<void> {
    const container = getContainer();
    switch (n.channel) {
      case 'email': {
        if (!n.recipientEmail) throw new Error('Email notification has no recipientEmail');
        await container.email.send({
          to: n.recipientEmail,
          from: process.env.NOTIFICATION_FROM_EMAIL ?? 'no-reply@printshop.example',
          subject: n.subject ?? n.eventType,
          text: n.body,
        });
        return;
      }
      case 'sms': {
        if (!n.recipientPhone) throw new Error('SMS notification has no recipientPhone');
        await container.sms.send({
          to: n.recipientPhone,
          body: n.body,
        });
        return;
      }
      case 'in_app': {
        // In-app notifications are just rows in the outbox; the
        // client polls /api/v1/me/notifications. No adapter call —
        // the row IS the delivery.
        if (!n.recipientId) throw new Error('In-app notification has no recipientId');
        return;
      }
      case 'push': {
        // Push notifications require a push adapter (FCM / APNS).
        // Not yet implemented — the row stays pending until the
        // adapter is wired. For now, throw so the row backs off
        // instead of being marked sent without delivery.
        throw new Error('Push channel not yet implemented');
      }
      default: {
        const exhaustive: never = n.channel;
        throw new Error(`Unknown notification channel: ${String(exhaustive)}`);
      }
    }
  }
}

/**
 * Helper: build a stable dedupKey for (eventType, recipientId, entityId).
 * Returns null when any of the three is missing (no dedup).
 */
export function buildDedupKey(
  eventType: string,
  recipientId: string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!recipientId || !entityId) return null;
  // Stable, URL-safe, no crypto needed — this is a dedup key, not a
  // secret. We use a simple join because the components are uuids
  // (no delimiter collision risk).
  return `${eventType}:${recipientId}:${entityId}`;
}

/**
 * Convenience: enqueue an in-app notification for a customer or
 * shopkeeper. The row is the delivery — the client polls
 * /api/v1/me/notifications.
 */
export async function notifyInApp(input: {
  recipientId: string;
  eventType: string;
  body: string;
  subject?: string | null;
  entityId?: string | null;
  shopId?: string | null;
  dedupKey?: string | null;
}): Promise<Notification> {
  const service = new NotificationService();
  return service.enqueue({
    channel: 'in_app' satisfies NotificationChannel,
    recipientId: input.recipientId,
    eventType: input.eventType,
    body: input.body,
    subject: input.subject ?? null,
    entityId: input.entityId ?? null,
    shopId: input.shopId ?? null,
    dedupKey: input.dedupKey ?? buildDedupKey(input.eventType, input.recipientId, input.entityId),
  });
}
