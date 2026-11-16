import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { NotificationService, buildDedupKey, notifyInApp } from '@/lib/services/notification.service';

/**
 * Phase 5 — notifications system tests.
 *
 * Verifies:
 *   1. enqueue writes a pending row.
 *   2. enqueue is idempotent on dedupKey — a retried event returns
 *      the existing row, not a duplicate.
 *   3. dispatchPending sends email via the adapter + marks the row
 *      sent.
 *   4. dispatchPending records failures + schedules exponential
 *      backoff; after maxAttempts the row is failed.
 *   5. in-app notifications are delivered as the row itself (no
 *      adapter call).
 *   6. listForRecipient filters by recipientId + channel=in_app.
 *   7. markRead marks an in-app notification as read.
 *   8. buildDedupKey returns a stable key for the same triple.
 */

let emailAdapter: StubEmailAdapter;
let smsAdapter: StubSmsAdapter;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  emailAdapter = new StubEmailAdapter();
  smsAdapter = new StubSmsAdapter();
  const container: Container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: emailAdapter,
    sms: smsAdapter,
    logger: new JsonConsoleLogger(),
    auth,
  };
  setContainerForTesting(container);
});

describe('Phase 5 — enqueue + dedup', () => {
  it('writes a pending notification row', async () => {
    const svc = new NotificationService();
    const n = await svc.enqueue({
      channel: 'in_app',
      recipientId: 'user-1',
      eventType: 'order.paid',
      body: 'Your order is paid',
      entityId: 'order-1',
    });
    expect(n.id).toBeTruthy();
    expect(n.status).toBe('pending');
    expect(n.channel).toBe('in_app');
    expect(n.attempts).toBe(0);
  });

  it('is idempotent on dedupKey — a retried event returns the same row', async () => {
    const svc = new NotificationService();
    const dedupKey = buildDedupKey('order.paid', 'user-1', 'order-1');
    expect(dedupKey).toBe('order.paid:user-1:order-1');

    const first = await svc.enqueue({
      channel: 'in_app',
      recipientId: 'user-1',
      eventType: 'order.paid',
      body: 'Your order is paid',
      entityId: 'order-1',
      dedupKey,
    });
    const second = await svc.enqueue({
      channel: 'in_app',
      recipientId: 'user-1',
      eventType: 'order.paid',
      body: 'Your order is paid',
      entityId: 'order-1',
      dedupKey,
    });

    // Same row — NOT a duplicate.
    expect(second.id).toBe(first.id);
    const all = await repos.notifications.listForRecipient('user-1');
    expect(all.length).toBe(1);
  });

  it('creates two rows when dedupKey differs (different events)', async () => {
    const svc = new NotificationService();
    await svc.enqueue({
      channel: 'in_app',
      recipientId: 'user-1',
      eventType: 'order.paid',
      body: 'Order 1 paid',
      entityId: 'order-1',
      dedupKey: 'order.paid:user-1:order-1',
    });
    await svc.enqueue({
      channel: 'in_app',
      recipientId: 'user-1',
      eventType: 'order.paid',
      body: 'Order 2 paid',
      entityId: 'order-2',
      dedupKey: 'order.paid:user-1:order-2',
    });
    const all = await repos.notifications.listForRecipient('user-1');
    expect(all.length).toBe(2);
  });

  it('buildDedupKey returns null when recipient or entity is missing', () => {
    expect(buildDedupKey('order.paid', null, 'order-1')).toBeNull();
    expect(buildDedupKey('order.paid', 'user-1', null)).toBeNull();
    expect(buildDedupKey('order.paid', null, null)).toBeNull();
  });
});

describe('Phase 5 — dispatchPending (email channel)', () => {
  it('sends an email via the adapter and marks the row sent', async () => {
    const svc = new NotificationService();
    await svc.enqueue({
      channel: 'email',
      recipientEmail: 'customer@example.com',
      eventType: 'order.paid',
      subject: 'Your order is paid',
      body: 'Thanks for your order.',
    });

    const summary = await svc.dispatchPending(10);
    expect(summary.dispatched).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.retried).toBe(0);

    expect(emailAdapter.sent.length).toBe(1);
    expect(emailAdapter.sent[0].to).toBe('customer@example.com');
    expect(emailAdapter.sent[0].subject).toBe('Your order is paid');
    expect(emailAdapter.sent[0].text).toBe('Thanks for your order.');
  });

  it('records a failure and schedules a retry when the adapter throws', async () => {
    // Replace the email adapter with one that always throws.
    const { getContainer } = await import('@/lib/container');
    const failingEmail = {
      provider: 'failing',
      async send() { throw new Error('SMTP down'); },
    };
    (getContainer() as Container).email = failingEmail as never;

    const svc = new NotificationService();
    await svc.enqueue({
      channel: 'email',
      recipientEmail: 'customer@example.com',
      eventType: 'order.paid',
      body: '...',
    });

    const summary = await svc.dispatchPending(10);
    expect(summary.sent).toBe(0);
    expect(summary.retried).toBe(1);
    expect(summary.failed).toBe(0);

    // The row should be pending with attempts=1 + a future nextAttemptAt.
    const rows = await repos.notifications.listByChannel('email');
    const row = rows[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastError).toContain('SMTP down');
  });

  it('marks the row failed after maxAttempts retries', async () => {
    const { getContainer } = await import('@/lib/container');
    const failingEmail = {
      provider: 'failing',
      async send() { throw new Error('SMTP down'); },
    };
    (getContainer() as Container).email = failingEmail as never;

    const svc = new NotificationService();
    await svc.enqueue({
      channel: 'email',
      recipientEmail: 'customer@example.com',
      eventType: 'order.paid',
      body: '...',
      maxAttempts: 2,
    });

    // First dispatch — retries (attempts=1).
    await svc.dispatchPending(10);
    // Force the nextAttemptAt to now so the next dispatch picks it up.
    const rows = await repos.notifications.listByChannel('email');
    await repos.notifications.setNextAttemptAt(rows[0].id, new Date());

    // Second dispatch — fails again, hits maxAttempts=2, status=failed.
    const summary = await svc.dispatchPending(10);
    expect(summary.failed).toBe(1);

    const final = await repos.notifications.findById(rows[0].id);
    expect(final?.status).toBe('failed');
    expect(final?.attempts).toBe(2);
  });
});

describe('Phase 5 — in-app notifications', () => {
  it('notifyInApp writes a row with channel=in_app + dedupKey', async () => {
    const n = await notifyInApp({
      recipientId: 'customer-1',
      eventType: 'order.ready',
      body: 'Your order is ready for pickup.',
      subject: 'Order ready',
      entityId: 'order-1',
    });
    expect(n.channel).toBe('in_app');
    expect(n.recipientId).toBe('customer-1');
    expect(n.dedupKey).toBe('order.ready:customer-1:order-1');
  });

  it('notifyInApp is idempotent — same recipientId+entityId+eventType returns the same row', async () => {
    const first = await notifyInApp({
      recipientId: 'customer-1',
      eventType: 'order.ready',
      body: '...',
      entityId: 'order-1',
    });
    const second = await notifyInApp({
      recipientId: 'customer-1',
      eventType: 'order.ready',
      body: '...',
      entityId: 'order-1',
    });
    expect(second.id).toBe(first.id);
  });

  it('dispatchPending does NOT call any adapter for in_app notifications', async () => {
    await notifyInApp({
      recipientId: 'customer-1',
      eventType: 'order.ready',
      body: '...',
      entityId: 'order-1',
    });
    const svc = new NotificationService();
    const summary = await svc.dispatchPending(10);
    expect(summary.sent).toBe(1);
    expect(emailAdapter.sent.length).toBe(0);
    expect(smsAdapter.sent.length).toBe(0);
  });

  it('listForRecipient returns only the caller’s in-app notifications', async () => {
    await notifyInApp({ recipientId: 'a', eventType: 'e1', body: '...', entityId: 'o1' });
    await notifyInApp({ recipientId: 'b', eventType: 'e1', body: '...', entityId: 'o2' });
    await notifyInApp({ recipientId: 'a', eventType: 'e2', body: '...', entityId: 'o3' });

    const aList = await repos.notifications.listForRecipient('a');
    const bList = await repos.notifications.listForRecipient('b');
    expect(aList.length).toBe(2);
    expect(bList.length).toBe(1);
  });

  it('markRead sets readAt; listForRecipient unreadOnly excludes read rows', async () => {
    const n = await notifyInApp({ recipientId: 'a', eventType: 'e1', body: '...', entityId: 'o1' });
    const unread = await repos.notifications.listForRecipient('a', { unreadOnly: true });
    expect(unread.length).toBe(1);

    await repos.notifications.markRead(n.id);

    const after = await repos.notifications.listForRecipient('a', { unreadOnly: true });
    expect(after.length).toBe(0);
    const all = await repos.notifications.listForRecipient('a');
    expect(all.length).toBe(1);
    expect(all[0].readAt).not.toBeNull();
  });
});

describe('Phase 5 — push channel is deferred', () => {
  it('throws when dispatching a push notification (not yet implemented)', async () => {
    const svc = new NotificationService();
    await svc.enqueue({
      channel: 'push',
      recipientId: 'customer-1',
      eventType: 'order.paid',
      body: '...',
    });
    const summary = await svc.dispatchPending(10);
    expect(summary.sent).toBe(0);
    expect(summary.retried + summary.failed).toBe(1);
  });
});
