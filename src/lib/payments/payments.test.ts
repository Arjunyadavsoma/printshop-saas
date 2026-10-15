import { describe, expect, it, beforeEach } from 'vitest';
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
  generatePaytmChecksum,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { processWebhook, rememberPaymentSession } from '@/lib/payments/webhook.service';
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig, type Shop, type ShopPricingConfig } from '@platform/core/domain';

const SALT_KEY = 'test-salt-key';
const MERCHANT_KEY = 'test-merchant-key';
const PHONEPE_CREDS = { phonepe: { saltKey: SALT_KEY, saltIndex: '1', merchantId: 'TESTMID', env: 'sandbox' as const } };
const PAYTM_CREDS = { paytm: { merchantId: 'TESTMID', merchantKey: MERCHANT_KEY, website: 'WEBSTAGING' } };

let shopId: string;

beforeEach(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
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
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth: new JwtAuthAdapter({ accessSecret: 'a', refreshSecret: 'b', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 }, cache),
  };
  setContainerForTesting(container);

  // Create a shop with both providers' credentials.
  const shop = await repos.shops.create({
    id: crypto.randomUUID(),
    name: 'Test Shop',
    slug: 'test-' + crypto.randomUUID().slice(0, 8),
    ownerUserId: crypto.randomUUID(),
    upiId: 'test@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: { ...PHONEPE_CREDS, ...PAYTM_CREDS },
    pricingConfig: createDefaultPricingConfig() as ShopPricingConfig,
    address: 'x',
    phone: 'x',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Shop);
  shopId = shop.id;
});

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeOrder(amountPaise: number): Promise<string> {
  const order = await repos.orders.create({ shopId, customerToken: 'T' + crypto.randomUUID().slice(0, 5) });
  await repos.orders.update(order.id, { totalAmountPaise: amountPaise });
  return order.id;
}

describe('PhonePe webhook — real X-VERIFY verification', () => {
  it('marks the order paid when the signature is valid', async () => {
    const orderId = await makeOrder(50000); // ₹500
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 50000, provider: 'phonepe' });

    const txnId = 'TXN' + Date.now();
    const payload = { data: { merchantTransactionId: orderId, transactionId: txnId, amount: 50000, state: 'COMPLETED', paymentInstrument: { type: 'UPI', utr: txnId }, responseCode: 'PAYMENT_SUCCESS' } };
    const base64Body = btoa(JSON.stringify(payload));
    const xVerify = (await sha256Hex(base64Body + '/pg/v1/status' + SALT_KEY)) + '###1';

    const result = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/api/v1/payments/phonepe/webhook', ip: null });
    expect(result.statusCode).toBe(200);
    expect(result.applied).toBe(true);
    expect(result.summary).toContain('marked paid');

    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe(txnId);
  });

  it('rejects a tampered payload (bad signature → 401, order stays awaiting_payment)', async () => {
    const orderId = await makeOrder(30000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 30000, provider: 'phonepe' });

    const payload = { data: { merchantTransactionId: orderId, transactionId: 'T1', amount: 30000, state: 'COMPLETED', paymentInstrument: { type: 'UPI', utr: 'T1' } } };
    const base64Body = btoa(JSON.stringify(payload));
    // Wrong salt key → signature won't match.
    const xVerify = (await sha256Hex(base64Body + '/pg/v1/status' + 'WRONG-SALT')) + '###1';

    const result = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/api/v1/payments/phonepe/webhook', ip: null });
    expect(result.statusCode).toBe(401);
    expect(result.applied).toBe(false);

    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
  });

  it('is idempotent: the same txnId twice does not double-process', async () => {
    const orderId = await makeOrder(20000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 20000, provider: 'phonepe' });

    const txnId = 'IDEMP' + Date.now();
    const payload = { data: { merchantTransactionId: orderId, transactionId: txnId, amount: 20000, state: 'COMPLETED', paymentInstrument: { type: 'UPI', utr: txnId } } };
    const base64Body = btoa(JSON.stringify(payload));
    const xVerify = (await sha256Hex(base64Body + '/pg/v1/status' + SALT_KEY)) + '###1';

    const r1 = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/x', ip: null });
    const r2 = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/x', ip: null });

    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(false);
    expect(r2.summary).toMatch(/idempotent|already/);
  });

  it('rejects a wrong salt index', async () => {
    const orderId = await makeOrder(10000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 10000, provider: 'phonepe' });
    const payload = { data: { merchantTransactionId: orderId, transactionId: 'X', amount: 10000, state: 'COMPLETED', paymentInstrument: { type: 'UPI', utr: 'X' } } };
    const base64Body = btoa(JSON.stringify(payload));
    const xVerify = (await sha256Hex(base64Body + '/pg/v1/status' + SALT_KEY)) + '###99';
    const r = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/x', ip: null });
    expect(r.statusCode).toBe(401);
  });

  it('leaves order in awaiting_payment when state=FAILED', async () => {
    const orderId = await makeOrder(15000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 15000, provider: 'phonepe' });
    const payload = { data: { merchantTransactionId: orderId, transactionId: 'F1', amount: 15000, state: 'FAILED', paymentInstrument: { type: 'UPI', utr: 'F1' } } };
    const base64Body = btoa(JSON.stringify(payload));
    const xVerify = (await sha256Hex(base64Body + '/pg/v1/status' + SALT_KEY)) + '###1';
    const r = await processWebhook({ provider: 'phonepe', rawBody: base64Body, headers: { 'x-verify': xVerify }, path: '/x', ip: null });
    expect(r.applied).toBe(false);
    expect(r.summary).toContain('not completed');
    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('awaiting_payment');
  });
});

describe('Paytm webhook — real CHECKSUMHASH verification', () => {
  it('marks the order paid when the checksum is valid', async () => {
    const orderId = await makeOrder(75000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 75000, provider: 'paytm' });

    const txnId = 'P' + Date.now();
    const params: Record<string, string> = {
      MID: 'TESTMID', ORDERID: orderId, TXNID: txnId, BANKNAME: 'B', TXNAMOUNT: '750.00', CURRENCY: 'INR', STATUS: 'TXN_SUCCESS', RESPMSG: 'ok', BANKTXNID: txnId,
    };
    const checksum = await generatePaytmChecksum(params, MERCHANT_KEY);
    params.CHECKSUMHASH = checksum;
    const formBody = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

    const r = await processWebhook({ provider: 'paytm', rawBody: formBody, headers: { 'content-type': 'application/x-www-form-urlencoded' }, path: '/api/v1/payments/paytm/callback', ip: null });
    expect(r.statusCode).toBe(200);
    expect(r.applied).toBe(true);
    expect(r.responseBody).toContain('Payment Successful');

    const order = await repos.orders.findById(orderId);
    expect(order?.status).toBe('paid');
    expect(order?.paymentTxnId).toBe(txnId);
  });

  it('rejects a tampered amount (checksum covers all fields)', async () => {
    const orderId = await makeOrder(60000);
    await rememberPaymentSession(orderId, { orderId, shopId, amountPaise: 60000, provider: 'paytm' });
    const txnId = 'P' + Date.now();
    const params: Record<string, string> = { MID: 'TESTMID', ORDERID: orderId, TXNID: txnId, BANKNAME: 'B', TXNAMOUNT: '600.00', CURRENCY: 'INR', STATUS: 'TXN_SUCCESS', RESPMSG: 'ok', BANKTXNID: txnId };
    const checksum = await generatePaytmChecksum(params, MERCHANT_KEY);
    // Tamper: change the amount AFTER signing → checksum no longer matches.
    params.TXNAMOUNT = '999.00';
    params.CHECKSUMHASH = checksum;
    const formBody = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const r = await processWebhook({ provider: 'paytm', rawBody: formBody, headers: {}, path: '/x', ip: null });
    expect(r.statusCode).toBe(401);
    expect(r.applied).toBe(false);
    expect(r.responseBody).toContain('Checksum verification failed');
  });
});
