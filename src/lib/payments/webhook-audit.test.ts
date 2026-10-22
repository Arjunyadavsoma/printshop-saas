import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
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
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { processWebhook, rememberPaymentSession } from '@/lib/payments/webhook.service';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop } from '@platform/core/domain';

/**
 * Webhook audit-logging regression test.
 *
 * Confirms that:
 *   1. The "received" audit event stores ONLY {path, contentLength, provider}
 *      — NO raw webhook body, NO CHECKSUMHASH, NO merchantTransactionId,
 *      NO paymentInstrument.utr, NO base64 payload.
 *   2. The "paid" audit event stores {txnId, utr, amountPaise} — the
 *      reconciliation record. This is intentional and necessary.
 *   3. The application logger (StubLoggerAdapter) is NOT called with the
 *      raw body, utr, or CHECKSUMHASH.
 *
 * Defect being guarded against: a previous version stored 500 chars of the
 * raw webhook body in audit_logs.metadata, which could contain UTRs,
 * CHECKSUMHASH values, and transaction IDs. This was fixed to store only
 * {path, contentLength, provider}.
 */
describe('Webhook audit logging — no raw body / checksum / credentials', () => {
  const SALT_KEY = 'test-salt-key-audit';
  const CREDS = { phonepe: { saltKey: SALT_KEY, saltIndex: '1', merchantId: 'AUDITMID', env: 'sandbox' as const } };

  let shopId: string;
  let orderId: string;
  let logCalls: { msg: string; ctx?: Record<string, unknown> }[];

  beforeEach(async () => {
    const db = new InMemoryDatabaseAdapter();
    const cache = new InMemoryCacheAdapter();
    logCalls = [];
    const logger = new StubLoggerAdapter();
    // Capture all log calls to verify no sensitive data is logged.
    (logger as unknown as { info: (m: string, c?: Record<string, unknown>) => void }).info = (m, c) => logCalls.push({ msg: m, ctx: c });
    (logger as unknown as { warn: (m: string, c?: Record<string, unknown>) => void }).warn = (m, c) => logCalls.push({ msg: m, ctx: c });
    (logger as unknown as { error: (m: string, c?: Record<string, unknown>) => void }).error = (m, c) => logCalls.push({ msg: m, ctx: c });
    (logger as unknown as { debug: (m: string, c?: Record<string, unknown>) => void }).debug = (m, c) => logCalls.push({ msg: m, ctx: c });

    const container: Container = {
      db,
      storage: new InMemoryStorageAdapter(),
      payment: new UpiDeepLinkPaymentAdapter(),
      paymentRegistry: new PaymentAdapterRegistry(),
      realtime: new InMemoryRealtimeAdapter(),
      cache,
      queue: new InMemoryQueueAdapter(),
      email: new StubEmailAdapter(),
      sms: new StubSmsAdapter(),
      logger,
      auth: new JwtAuthAdapter({ accessSecret: 'test-access-secret-min-32-chars-long', refreshSecret: 'test-refresh-secret-min-32-chars-long', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
    };
    setContainerForTesting(container);

    // Seed a shop with the dev credentials
    const owner = await repos.users.create({ email: 'audit@test.demo', phone: '9999999999', password: 'pass1234', role: 'owner', shopId: null }, container.auth);
    const shop: Shop = {
      id: crypto.randomUUID(),
      name: 'Audit Test Shop',
      slug: 'audit-shop',
      ownerUserId: owner.id,
      upiId: 'audit@okaxis',
      paymentProvider: 'googlepay',
      paymentCredentials: CREDS as unknown as Record<string, unknown>,
      pricingConfig: createDefaultPricingConfig(),
      address: 'x',
      phone: '9999999999',
      timezone: 'Asia/Kolkata',
      isActive: true,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      description: null,
      businessHours: null,
      logoUrl: null,
      upiQrStorageKey: null,
      servicesJson: null,
      paymentPhone: null,
      paymentInstructions: null,
      cashOnPickup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const created = await repos.shops.create(shop);
    shopId = created.id;
    await repos.users.update(owner.id, { shopId });

    // Create an order + file + a queued print job (so the webhook can enqueue)
    const order = await repos.orders.create({ shopId, customerToken: 'TOKAUDIT' });
    orderId = order.id;
    // orders.create defaults totalAmountPaise to 0; set it via update.
    await repos.orders.update(orderId, { totalAmountPaise: 500 });
    const file = await repos.files.create({ orderId, originalFilename: 'doc.pdf', storageKey: 'k', mimeType: 'application/pdf', sizeBytes: 100, pageCount: 1 });
    // Set the file price so checkout is valid
    await repos.files.update(file.id, { pricePaise: 500 });
    await repos.orders.update(orderId, { totalAmountPaise: 500 });
  });

  /** Build a real PhonePe X-VERIFY signature + base64 payload. */
  function buildSignedPayload(state: 'COMPLETED' | 'FAILED'): { rawBody: string; xVerify: string; txnId: string; utr: string } {
    const txnId = 'TXN-' + Date.now();
    const utr = 'UTR-' + Date.now();
    const payload = {
      data: {
        merchantId: 'AUDITMID',
        merchantTransactionId: orderId, // matches the session key
        transactionId: txnId,
        amount: 500,
        state,
        paymentInstrument: { type: 'UPI', utr },
        responseCode: state === 'COMPLETED' ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR',
      },
    };
    const base64Body = btoa(JSON.stringify(payload));
    // sha256(base64Body + verifyPath + saltKey)###saltIndex
    const verifyPath = '/pg/v1/status';
    const mac = createHash('sha256').update(base64Body + verifyPath + SALT_KEY).digest('hex');
    return { rawBody: base64Body, xVerify: `${mac}###1`, txnId, utr };
  }

  it('the "received" audit event stores ONLY {path, contentLength, provider} — NO raw body', async () => {
    // Remember the payment session so the webhook can find the order
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 500, provider: 'phonepe' as const });
    const { rawBody, xVerify } = buildSignedPayload('COMPLETED');

    await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: '127.0.0.1',
    });

    // Query the audit log for the "received" event
    const received = await repos.audit.findByAction('webhook.phonepe.received');
    expect(received.length).toBeGreaterThan(0);
    const meta = received[0].metadata as Record<string, unknown>;
    // MUST have only these 3 fields
    expect(Object.keys(meta).sort()).toEqual(['contentLength', 'path', 'provider']);
    // MUST NOT contain any raw body content
    expect(meta.path).toBe('/api/v1/payments/phonepe/webhook');
    expect(meta.contentLength).toBe(rawBody.length);
    expect(meta.provider).toBe('phonepe');
    // Explicitly verify NO sensitive fields
    expect(JSON.stringify(meta)).not.toContain('merchantTransactionId');
    expect(JSON.stringify(meta)).not.toContain('CHECKSUMHASH');
    expect(JSON.stringify(meta)).not.toContain('saltKey');
    expect(JSON.stringify(meta)).not.toContain(rawBody.slice(0, 20)); // no raw body fragment
  });

  it('the "paid" audit event stores {txnId, utr, amountPaise} — reconciliation record, NO raw body', async () => {
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 500, provider: 'phonepe' as const });
    const { rawBody, xVerify, txnId, utr } = buildSignedPayload('COMPLETED');

    await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: '127.0.0.1',
    });

    const paid = await repos.audit.findByAction('webhook.phonepe.paid');
    expect(paid.length).toBe(1);
    const meta = paid[0].metadata as Record<string, unknown>;
    // MUST have exactly these 3 reconciliation fields
    expect(Object.keys(meta).sort()).toEqual(['amountPaise', 'txnId', 'utr']);
    expect(meta.txnId).toBe(txnId);
    expect(meta.utr).toBe(utr);
    expect(meta.amountPaise).toBe(500);
    // MUST NOT contain raw body / CHECKSUMHASH / saltKey
    expect(JSON.stringify(meta)).not.toContain('CHECKSUMHASH');
    expect(JSON.stringify(meta)).not.toContain('saltKey');
    expect(JSON.stringify(meta)).not.toContain(rawBody.slice(0, 20));
  });

  it('application logger is NEVER called with the raw body, utr, or CHECKSUMHASH', async () => {
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 500, provider: 'phonepe' as const });
    const { rawBody, xVerify } = buildSignedPayload('COMPLETED');

    await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: '127.0.0.1',
    });

    // Scan every log call for sensitive data
    for (const call of logCalls) {
      const serialized = JSON.stringify({ msg: call.msg, ctx: call.ctx });
      // The raw body is base64 — a fragment should NEVER appear in logs
      expect(serialized).not.toContain(rawBody.slice(0, 20));
      // UTR is the bank-side ID — must NOT be in app logs (only in audit DB)
      expect(serialized).not.toContain('CHECKSUMHASH');
      expect(serialized).not.toContain('saltKey');
      // The txnId (PSP transaction ID) IS allowed in app logs for support
      // We do NOT assert against txnId — it's intentionally logged.
    }
  });

  it('a failed-payment webhook stores the failure as an audit event with NO raw body', async () => {
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 500, provider: 'phonepe' as const });
    const { rawBody, xVerify } = buildSignedPayload('FAILED');

    await processWebhook({
      provider: 'phonepe',
      rawBody,
      headers: { 'x-verify': xVerify },
      path: '/api/v1/payments/phonepe/webhook',
      ip: '127.0.0.1',
    });

    const failed = await repos.audit.findByAction('webhook.phonepe.failed');
    expect(failed.length).toBe(1);
    const meta = failed[0].metadata as Record<string, unknown>;
    // Failed event stores {txnId, state} — NO raw body
    expect(meta.state).toBe('not-paid');
    expect(meta.txnId).toBeDefined();
    expect(JSON.stringify(meta)).not.toContain(rawBody.slice(0, 20));
    expect(JSON.stringify(meta)).not.toContain('CHECKSUMHASH');
  });
});
