import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Phase 5.2.1 — Provider Adapter Contract Tests
 *
 * Verifies that EVERY adapter (UPI deep-link, PhonePe v1, PhonePe v2, Paytm):
 *   1. Uses the supplied `merchantOrderId` VERBATIM in the provider request
 *      (PhonePe: `merchantTransactionId`; Paytm: `orderId`).
 *   2. Returns a PaymentIntent whose `merchantOrderId` is the SAME as the
 *      supplied one (so the checkout route can persist it before contact).
 *   3. Does NOT generate a replacement reference (no `crypto.randomUUID()`
 *      fallback, no `orderId` fallback).
 *   4. Preserves the original internal attempt when provider initiation FAILS
 *      — the merchantOrderId is still returned so the persisted
 *      PaymentAttempt row remains valid for webhook reconciliation.
 *   5. Rejects a missing `merchantOrderId` at the TypeScript level (verified
 *      via `@ts-expect-error` directives below).
 *
 * No real payments are initiated. The `upipay` SDK is mocked for v1/Paytm;
 * global `fetch` is mocked for PhonePe v2 (OAuth2 + /pg/v2/pay).
 */

// ─── Mock the `upipay` SDK for PhonePe v1 + Paytm tests ────────────────
// The mock factory is hoisted by vitest. It cannot close over outer-scope
// mutable state, so per-test configuration is done via the `__mockClient`
// control object exposed on the mocked module.

const createPaymentMock = vi.fn();
const checkStatusMock = vi.fn();
const createRefundMock = vi.fn();
const verifyWebhookMock = vi.fn();

vi.mock('upipay', () => {
  class MockUPIPay {
    constructor(public config: unknown) {}
    createPayment = createPaymentMock;
    checkStatus = checkStatusMock;
    createRefund = createRefundMock;
    verifyWebhook = verifyWebhookMock;
  }
  return { UPIPay: MockUPIPay };
});

// ─── Mock global fetch for PhonePe v2 (OAuth2 + /pg/v2/pay) ────────────
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

import {
  UpiDeepLinkPaymentAdapter,
  PhonePePaymentAdapter,
  PaytmPaymentAdapter,
} from '@platform/adapters';
import type { PaymentAdapter } from '@platform/core/interfaces';

// ─── Test fixtures ─────────────────────────────────────────────────────

/** A distinct merchantOrderId used across all tests. */
const MOID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = 'order-abc-123';
const AMOUNT_PAISE = 50500; // ₹505.00

const UPI_CREDS = {};
const PHONEPE_V1_CREDS = {
  phonepe: { saltKey: 'test-salt', saltIndex: '1', merchantId: 'TESTMID', env: 'sandbox' as const },
};
const PHONEPE_V2_CREDS = {
  phonepe: { clientId: 'test-client-id', clientSecret: 'test-secret', clientVersion: '1', merchantId: 'TESTMID', env: 'sandbox' as const },
};
const PAYTM_CREDS = {
  paytm: { merchantId: 'TESTMID', merchantKey: 'test-merchant-key', website: 'WEBSTAGING' },
};

beforeEach(() => {
  createPaymentMock.mockReset();
  checkStatusMock.mockReset();
  createRefundMock.mockReset();
  verifyWebhookMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── UPI deep-link adapter ─────────────────────────────────────────────

describe('UpiDeepLinkPaymentAdapter — Phase 5.2.1 contract', () => {
  const adapter = new UpiDeepLinkPaymentAdapter();

  it('returns the supplied merchantOrderId VERBATIM (no fallback)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: UPI_CREDS,
      merchantOrderId: MOID,
    });
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.merchantOrderId).not.toBe(ORDER_ID);
    expect(intent.orderId).toBe(ORDER_ID);
  });

  it('does NOT generate a replacement UUID (merchantOrderId is the supplied value)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: UPI_CREDS,
      merchantOrderId: MOID,
    });
    // The supplied MOID has a fixed pattern; a generated UUID would differ.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.merchantOrderId).toMatch(/^11111111-2222-3333-4444-555555555555$/);
  });
});

// ─── PhonePe v1 (Standard API via UPIPay) ──────────────────────────────

describe('PhonePePaymentAdapter v1 — Phase 5.2.1 contract', () => {
  const adapter = new PhonePePaymentAdapter();

  it('passes the supplied merchantOrderId as `orderId` to UPIPay.createPayment', async () => {
    // Mock UPIPay.createPayment to capture the args + return a success.
    createPaymentMock.mockResolvedValueOnce({
      success: true,
      paymentUrl: 'https://phonepe.example/checkout/test-moid',
      rawResponse: { ok: true },
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V1_CREDS,
      merchantOrderId: MOID,
    });

    // The adapter MUST have called createPayment with orderId === MOID.
    expect(createPaymentMock).toHaveBeenCalledTimes(1);
    const callArg = createPaymentMock.mock.calls[0][0];
    expect(callArg.orderId).toBe(MOID);
    expect(callArg.amount).toBe(AMOUNT_PAISE);

    // The returned intent's merchantOrderId MUST be the same MOID.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBe('https://phonepe.example/checkout/test-moid');
    expect(intent.provider).toBe('phonepe');
  });

  it('does NOT generate a replacement UUID (uses supplied merchantOrderId verbatim)', async () => {
    createPaymentMock.mockResolvedValueOnce({
      success: true,
      paymentUrl: 'https://phonepe.example/checkout/x',
      rawResponse: {},
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V1_CREDS,
      merchantOrderId: MOID,
    });

    // The arg passed to UPIPay MUST be exactly MOID, not a fresh UUID.
    const callArg = createPaymentMock.mock.calls[0][0];
    expect(callArg.orderId).toBe(MOID);
    // The returned intent MUST echo MOID, not a generated UUID.
    expect(intent.merchantOrderId).toBe(MOID);
  });

  it('preserves the internal attempt when createPayment fails (graceful degradation)', async () => {
    // Mock UPIPay.createPayment to throw a network error.
    createPaymentMock.mockRejectedValueOnce(new Error('network timeout'));

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V1_CREDS,
      merchantOrderId: MOID,
    });

    // Even though the provider call failed, the adapter MUST return the
    // merchantOrderId so the persisted PaymentAttempt row remains valid.
    // The customer falls back to manual verify; the internal attempt is preserved.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.orderId).toBe(ORDER_ID);
    expect(intent.amountPaise).toBe(AMOUNT_PAISE);
    // No checkoutUrl because the provider call failed.
    expect(intent.checkoutUrl).toBeUndefined();
  });

  it('preserves the internal attempt when createPayment returns success=false', async () => {
    createPaymentMock.mockResolvedValueOnce({
      success: false,
      paymentUrl: null,
      rawResponse: { code: 'BAD_REQUEST', message: 'invalid amount' },
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V1_CREDS,
      merchantOrderId: MOID,
    });

    // The adapter's catch-block returns a fallback intent with the same MOID.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBeUndefined();
  });
});

// ─── PhonePe v2 (Business API OAuth2) ──────────────────────────────────

describe('PhonePePaymentAdapter v2 — Phase 5.2.1 contract', () => {
  const adapter = new PhonePePaymentAdapter();

  /** Mock the OAuth2 token endpoint + the /pg/v2/pay endpoint. */
  function mockV2Success(suggestedCheckoutUrl: string): void {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/oauth/v1/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'test-bearer-token', expires_in: 600, token_type: 'Bearer' }),
          text: async () => '',
        } as unknown as Response;
      }
      if (u.endsWith('/pg/v2/pay')) {
        // Capture the request body so the test can assert merchantTransactionId.
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { instrumentResponse: { redirectInfo: { url: suggestedCheckoutUrl } } },
          }),
          text: async () => '',
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${u}`);
    });
  }

  it('passes the supplied merchantOrderId as `merchantTransactionId` in the v2 /pg/v2/pay body', async () => {
    mockV2Success('https://phonepe.example/v2/checkout/test-moid');

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V2_CREDS,
      merchantOrderId: MOID,
    });

    // Find the /pg/v2/pay call + inspect its body.
    const payCall = fetchMock.mock.calls.find(
      ([u]) => String(u).endsWith('/pg/v2/pay'),
    );
    expect(payCall).toBeDefined();
    const payBody = JSON.parse(payCall![1].body as string);
    expect(payBody.merchantTransactionId).toBe(MOID);
    expect(payBody.merchantId).toBe('TESTMID');
    expect(payBody.amount).toBe(AMOUNT_PAISE);

    // The returned intent MUST echo the same MOID.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBe('https://phonepe.example/v2/checkout/test-moid');
  });

  it('does NOT generate a replacement UUID for v2 (merchantTransactionId === supplied)', async () => {
    mockV2Success('https://phonepe.example/v2/checkout/x');

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V2_CREDS,
      merchantOrderId: MOID,
    });

    const payCall = fetchMock.mock.calls.find(
      ([u]) => String(u).endsWith('/pg/v2/pay'),
    );
    const payBody = JSON.parse(payCall![1].body as string);
    expect(payBody.merchantTransactionId).toBe(MOID);
    expect(intent.merchantOrderId).toBe(MOID);
  });

  it('preserves the internal attempt when v2 /pg/v2/pay fails (network error)', async () => {
    // OAuth succeeds, /pg/v2/pay throws.
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/oauth/v1/token')) {
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'test-bearer', expires_in: 600 }),
          text: async () => '',
        } as unknown as Response;
      }
      if (u.endsWith('/pg/v2/pay')) {
        throw new Error('ETIMEDOUT');
      }
      throw new Error(`unexpected ${u}`);
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V2_CREDS,
      merchantOrderId: MOID,
    });

    // Graceful degradation: same MOID, no checkoutUrl.
    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBeUndefined();
  });

  it('preserves the internal attempt when v2 returns success=false', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/oauth/v1/token')) {
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'test-bearer', expires_in: 600 }),
          text: async () => '',
        } as unknown as Response;
      }
      if (u.endsWith('/pg/v2/pay')) {
        return {
          ok: true, status: 200,
          json: async () => ({ success: false, code: 'BAD_REQUEST', message: 'invalid merchant' }),
          text: async () => '',
        } as unknown as Response;
      }
      throw new Error(`unexpected ${u}`);
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PHONEPE_V2_CREDS,
      merchantOrderId: MOID,
    });

    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBeUndefined();
  });
});

// ─── Paytm ─────────────────────────────────────────────────────────────

describe('PaytmPaymentAdapter — Phase 5.2.1 contract', () => {
  const adapter = new PaytmPaymentAdapter();

  it('passes the supplied merchantOrderId as `orderId` to UPIPay.createPayment', async () => {
    createPaymentMock.mockResolvedValueOnce({
      success: true,
      paymentUrl: 'https://paytm.example/checkout/test-moid',
      rawResponse: { ok: true },
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PAYTM_CREDS,
      merchantOrderId: MOID,
    });

    expect(createPaymentMock).toHaveBeenCalledTimes(1);
    const callArg = createPaymentMock.mock.calls[0][0];
    expect(callArg.orderId).toBe(MOID);
    expect(callArg.amount).toBe(AMOUNT_PAISE);

    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBe('https://paytm.example/checkout/test-moid');
    expect(intent.provider).toBe('paytm');
  });

  it('does NOT generate a replacement UUID (uses supplied merchantOrderId verbatim)', async () => {
    createPaymentMock.mockResolvedValueOnce({
      success: true,
      paymentUrl: 'https://paytm.example/checkout/x',
      rawResponse: {},
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PAYTM_CREDS,
      merchantOrderId: MOID,
    });

    const callArg = createPaymentMock.mock.calls[0][0];
    expect(callArg.orderId).toBe(MOID);
    expect(intent.merchantOrderId).toBe(MOID);
  });

  it('preserves the internal attempt when createPayment fails (network error)', async () => {
    createPaymentMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PAYTM_CREDS,
      merchantOrderId: MOID,
    });

    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.orderId).toBe(ORDER_ID);
    expect(intent.amountPaise).toBe(AMOUNT_PAISE);
    expect(intent.checkoutUrl).toBeUndefined();
  });

  it('preserves the internal attempt when createPayment returns success=false', async () => {
    createPaymentMock.mockResolvedValueOnce({
      success: false,
      paymentUrl: null,
      rawResponse: { code: 'INVALID_MERCHANT' },
    });

    const intent = await adapter.createPaymentIntent({
      orderId: ORDER_ID,
      amountPaise: AMOUNT_PAISE,
      shopUpiId: 'shop@okaxis',
      shopCredentials: PAYTM_CREDS,
      merchantOrderId: MOID,
    });

    expect(intent.merchantOrderId).toBe(MOID);
    expect(intent.checkoutUrl).toBeUndefined();
  });
});

// ─── TypeScript compile-time contract (all adapters) ───────────────────
//
// These `@ts-expect-error` directives assert that omitting `merchantOrderId`
// is a TypeScript COMPILE ERROR for every adapter. If the contract regresses
// to optional, the directives become unused (TS2578) and the build fails.

// @ts-expect-error — UPI adapter must reject missing merchantOrderId
const _upiOmit = new UpiDeepLinkPaymentAdapter().createPaymentIntent({
  orderId: 'o', amountPaise: 100, shopUpiId: 's', shopCredentials: {},
});

// @ts-expect-error — PhonePe adapter must reject missing merchantOrderId
const _phonepeOmit = new PhonePePaymentAdapter().createPaymentIntent({
  orderId: 'o', amountPaise: 100, shopUpiId: 's', shopCredentials: PHONEPE_V1_CREDS,
});

// @ts-expect-error — Paytm adapter must reject missing merchantOrderId
const _paytmOmit = new PaytmPaymentAdapter().createPaymentIntent({
  orderId: 'o', amountPaise: 100, shopUpiId: 's', shopCredentials: PAYTM_CREDS,
});

// Type-level: the field is `string` (mandatory) on the interface itself.
type _Input = Parameters<PaymentAdapter['createPaymentIntent']>[0];
const _requiredCheck: _Input['merchantOrderId'] extends string ? true : false = true;

describe('Phase 5.2.1 — TypeScript contract (smoke test)', () => {
  it('all three adapters implement PaymentAdapter', () => {
    const upi: PaymentAdapter = new UpiDeepLinkPaymentAdapter();
    const phonepe: PaymentAdapter = new PhonePePaymentAdapter();
    const paytm: PaymentAdapter = new PaytmPaymentAdapter();
    expect(upi.provider).toBe('googlepay');
    expect(phonepe.provider).toBe('phonepe');
    expect(paytm.provider).toBe('paytm');
  });
});
