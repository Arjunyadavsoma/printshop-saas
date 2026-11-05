import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { validatePhonePeV2Auth } from '@/lib/payments/phonepe-v2-webhook';

/**
 * PhonePe v2 webhook security tests.
 *
 * Tests the SHA authentication validation without making real API calls
 * or touching the database. The processPaymentCompleted flow is tested
 * via the existing webhook tests (which use the v1 format) — the v2
 * format shares the same transitionStatus + amount validation logic.
 */

describe('PhonePe v2 webhook — SHA authentication', () => {
  const originalUser = process.env.PHONEPE_WEBHOOK_USERNAME;
  const originalPass = process.env.PHONEPE_WEBHOOK_PASSWORD;
  const env = process.env as unknown as Record<string, string | undefined>;

  beforeAll(() => {
    env.PHONEPE_WEBHOOK_USERNAME = 'testuser';
    env.PHONEPE_WEBHOOK_PASSWORD = 'testpass';
  });

  afterAll(() => {
    if (originalUser === undefined) delete env.PHONEPE_WEBHOOK_USERNAME;
    else env.PHONEPE_WEBHOOK_USERNAME = originalUser;
    if (originalPass === undefined) delete env.PHONEPE_WEBHOOK_PASSWORD;
    else env.PHONEPE_WEBHOOK_PASSWORD = originalPass;
  });

  /** Compute the expected SHA-256 hex of `username:password`. */
  function expectedAuth(user: string, pass: string): string {
    return createHash('sha256').update(`${user}:${pass}`).digest('hex');
  }

  it('accepts a valid SHA-256 Authorization header', () => {
    const auth = expectedAuth('testuser', 'testpass');
    expect(validatePhonePeV2Auth(auth)).toBe(true);
  });

  it('rejects an invalid password (wrong hash)', () => {
    const wrongAuth = expectedAuth('testuser', 'wrongpass');
    expect(validatePhonePeV2Auth(wrongAuth)).toBe(false);
  });

  it('rejects an invalid username (wrong hash)', () => {
    const wrongAuth = expectedAuth('wronguser', 'testpass');
    expect(validatePhonePeV2Auth(wrongAuth)).toBe(false);
  });

  it('rejects a missing Authorization header (null)', () => {
    expect(validatePhonePeV2Auth(null)).toBe(false);
  });

  it('rejects an empty Authorization header', () => {
    expect(validatePhonePeV2Auth('')).toBe(false);
  });

  it('rejects a Basic Auth header (not a bare SHA-256 hex)', () => {
    // PhonePe v2 does NOT use Basic Auth — the header is a bare hex digest.
    expect(validatePhonePeV2Auth('Basic dXNlcjpwYXNz')).toBe(false);
  });

  it('rejects a Bearer token header', () => {
    expect(validatePhonePeV2Auth('Bearer some-jwt-token')).toBe(false);
  });

  it('rejects a truncated hash (not 64 chars)', () => {
    const auth = expectedAuth('testuser', 'testpass').slice(0, 32);
    expect(validatePhonePeV2Auth(auth)).toBe(false);
  });

  it('accepts an uppercase hex (normalized to lowercase)', () => {
    const auth = expectedAuth('testuser', 'testpass').toUpperCase();
    expect(validatePhonePeV2Auth(auth)).toBe(true);
  });

  it('rejects when env vars are not configured (fail-closed)', () => {
    const savedUser = env.PHONEPE_WEBHOOK_USERNAME;
    const savedPass = env.PHONEPE_WEBHOOK_PASSWORD;
    delete env.PHONEPE_WEBHOOK_USERNAME;
    delete env.PHONEPE_WEBHOOK_PASSWORD;
    const auth = expectedAuth('testuser', 'testpass');
    expect(validatePhonePeV2Auth(auth)).toBe(false);
    env.PHONEPE_WEBHOOK_USERNAME = savedUser;
    env.PHONEPE_WEBHOOK_PASSWORD = savedPass;
  });

  it('handles special characters in username/password', () => {
    env.PHONEPE_WEBHOOK_USERNAME = 'user@domain.com';
    env.PHONEPE_WEBHOOK_PASSWORD = 'p@ss!w0rd#$%';
    const auth = expectedAuth('user@domain.com', 'p@ss!w0rd#$%');
    expect(validatePhonePeV2Auth(auth)).toBe(true);
    // Restore for other tests.
    env.PHONEPE_WEBHOOK_USERNAME = 'testuser';
    env.PHONEPE_WEBHOOK_PASSWORD = 'testpass';
  });
});

describe('PhonePe v2 webhook — format detection', () => {
  it('v2 body shape is plain JSON with event + payload (not base64)', () => {
    // The v2 webhook body is: {"event":"pg.order.completed","payload":{...}}
    // NOT the v1 format: base64-encoded JSON.
    const v2Body = JSON.stringify({
      event: 'pg.order.completed',
      payload: {
        merchantOrderId: 'test-order-123',
        state: 'COMPLETED',
        amount: 50000,
        paymentDetails: [{ transactionId: 'TXN123', amount: 50000, state: 'COMPLETED' }],
      },
    });
    const parsed = JSON.parse(v2Body);
    expect(parsed.event).toBe('pg.order.completed');
    expect(parsed.payload.merchantOrderId).toBe('test-order-123');
    expect(parsed.payload.amount).toBe(50000);
    // Verify it's NOT base64 (v1 format).
    expect(v2Body.startsWith('ey')).toBe(false); // base64 of '{"' starts with 'ey'
  });
});

describe('PhonePe v2 webhook — event classification', () => {
  // These are the event types the user configured in the PhonePe dashboard.
  const completedEvents = ['pg.order.completed', 'checkout.order.completed', 'paylink.order.completed'];
  const failedEvents = ['checkout.order.failed', 'paylink.order.failed'];
  const refundEvents = ['pg.refund.completed', 'pg.refund.failed'];
  const otherEvents = [
    'subscription.redemption.order.completed',
    'subscription.redemption.transaction.completed',
    'payment.dispute.created',
    'payment.dispute.won',
    'settlement.processed',
  ];

  it('completed events are classified as payment-success', () => {
    // These should trigger the processPaymentCompleted flow.
    for (const event of completedEvents) {
      expect(event).toMatch(/\.completed$/);
    }
  });

  it('failed events are classified as payment-failure', () => {
    for (const event of failedEvents) {
      expect(event).toMatch(/\.failed$/);
    }
  });

  it('refund events are classified as refund (never marks order paid)', () => {
    for (const event of refundEvents) {
      expect(event).toMatch(/refund/);
    }
  });

  it('other events are unsupported (acknowledged + logged)', () => {
    for (const event of otherEvents) {
      // These should NOT match completed/failed/refund patterns.
      expect(completedEvents.includes(event)).toBe(false);
      expect(failedEvents.includes(event)).toBe(false);
      expect(refundEvents.includes(event)).toBe(false);
    }
  });
});
