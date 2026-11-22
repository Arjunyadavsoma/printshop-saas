import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RazorpayPaymentAdapter } from './razorpay.adapter';
import { createHmac } from 'node:crypto';

/**
 * RazorpayPaymentAdapter — contract + crypto tests (no network: fetch mocked).
 * Mirrors adapter-contract expectations: merchantOrderId used VERBATIM,
 * honest verification, idempotent webhook handling.
 */

const CREDENTIALS = {
  razorpay: { keyId: 'rzp_test_key123', keySecret: 'testsecret123', webhookSecret: 'whsec456', env: 'test' },
};

function signWebhook(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function capturedBody(txn = 'pay_ABC123', amount = 3600) {
  return JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: txn, order_id: 'order_XYZ789', amount, status: 'captured', receipt: 'mo-1', notes: { merchantOrderId: 'mo-1' }, acquirer_data: { rrn: '123456789012' } } } },
  });
}

describe('RazorpayPaymentAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('createPaymentIntent posts the merchantOrderId verbatim as receipt and returns gateway fields', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'order_XYZ789', status: 'created' }), { status: 200 }));
    const adapter = new RazorpayPaymentAdapter();
    const intent = await adapter.createPaymentIntent({
      orderId: 'ord-1',
      amountPaise: 3600,
      shopUpiId: 'shop@upi',
      shopCredentials: CREDENTIALS,
      merchantOrderId: '11111111-2222-3333-4444-555555555555',
      customerToken: 'B5EY7Y',
    });
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody.receipt).toBe('11111111-2222-3333-4444-555555555555');
    expect(sentBody.amount).toBe(3600);
    expect(intent.merchantOrderId).toBe('11111111-2222-3333-4444-555555555555');
    expect(intent.gatewayOrderId).toBe('order_XYZ789');
    expect(intent.publishableKey).toBe('rzp_test_key123');
    expect(intent.provider).toBe('razorpay');
  });

  it('createPaymentIntent rejects missing credentials', async () => {
    const adapter = new RazorpayPaymentAdapter();
    await expect(adapter.createPaymentIntent({
      orderId: 'ord-1', amountPaise: 100, shopUpiId: 'x@upi',
      shopCredentials: {}, merchantOrderId: 'mo-x',
    })).rejects.toThrow(/not configured/);
  });

  it('handleWebhook verifies a valid payment.captured signature', async () => {
    const adapter = new RazorpayPaymentAdapter();
    const raw = capturedBody();
    const result = await adapter.handleWebhook(
      { rawBody: raw, headers: { 'x-razorpay-signature': signWebhook(raw, 'whsec456') }, path: '/x' },
      CREDENTIALS,
    );
    expect(result.ok).toBe(true);
    expect(result.verification?.paid).toBe(true);
    expect(result.verification?.txnId).toBe('pay_ABC123');
    expect(result.verification?.utr).toBe('123456789012');
    expect(result.verification?.amountPaise).toBe(3600);
  });

  it('handleWebhook rejects a forged signature', async () => {
    const adapter = new RazorpayPaymentAdapter();
    const raw = capturedBody();
    const result = await adapter.handleWebhook(
      { rawBody: raw, headers: { 'x-razorpay-signature': signWebhook(raw, 'WRONG-SECRET') }, path: '/x' },
      CREDENTIALS,
    );
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.verification).toBeNull();
  });

  it('handleWebhook returns 503 without a webhook secret (not a silent pass)', async () => {
    const adapter = new RazorpayPaymentAdapter();
    const result = await adapter.handleWebhook(
      { rawBody: capturedBody(), headers: { 'x-razorpay-signature': 'x' }, path: '/x' },
      { razorpay: { keyId: 'k', keySecret: 's' } },
    );
    expect(result.statusCode).toBe(503);
    expect(result.verification).toBeNull();
  });

  it('handleWebhook records refund events without marking paid', async () => {
    const adapter = new RazorpayPaymentAdapter();
    const raw = JSON.stringify({ event: 'refund.processed', payload: { payment: { entity: { id: 'pay_R1' } } } });
    const result = await adapter.handleWebhook(
      { rawBody: raw, headers: { 'x-razorpay-signature': signWebhook(raw, 'whsec456') }, path: '/x' },
      CREDENTIALS,
    );
    expect(result.ok).toBe(true);
    expect(result.verification?.paid).toBe(false);
  });

  it('verifyPayment finds a captured payment by gateway order id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ id: 'pay_ABC123', status: 'captured', amount: 3600, acquirer_data: { rrn: '999888777666' } }],
    }), { status: 200 }));
    const adapter = new RazorpayPaymentAdapter();
    const verification = await adapter.verifyPayment({
      merchantOrderId: 'mo-1',
      gatewayOrderId: 'order_XYZ789',
      shopCredentials: CREDENTIALS,
    });
    expect(verification.paid).toBe(true);
    expect(verification.txnId).toBe('pay_ABC123');
    expect(verification.utr).toBe('999888777666');
  });

  it('verifyPayment reports not-paid when no captured payment exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ id: 'pay_P1', status: 'created', amount: 3600 }],
    }), { status: 200 }));
    const adapter = new RazorpayPaymentAdapter();
    const verification = await adapter.verifyPayment({
      merchantOrderId: 'mo-1', gatewayOrderId: 'order_XYZ789', shopCredentials: CREDENTIALS,
    });
    expect(verification.paid).toBe(false);
    expect(verification.txnId).toBeNull();
  });
});
