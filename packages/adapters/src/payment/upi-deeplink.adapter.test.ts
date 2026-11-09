import { describe, expect, it } from 'vitest';
import { UpiDeepLinkPaymentAdapter } from './upi-deeplink.adapter';

/**
 * UPI deep-link URI regression tests — verifies the `upi://pay?...` URI is
 * constructed correctly per the NPCI BHIM spec, with:
 *   - The shop's actual UPI ID + shop name (NOT hardcoded 'PrintShop').
 *   - The exact server-calculated amount (in rupees, 2 decimal places).
 *   - Currency = INR.
 *   - Order-specific transaction note + reference (using the customerToken).
 *   - All parameters URL-encoded (no unescaped user-controlled values).
 *   - No application secrets in the URI.
 *
 * Phase 5.2.1 contract: `merchantOrderId` is MANDATORY on every call. The
 * adapter MUST return it verbatim as `PaymentIntent.merchantOrderId`. These
 * tests supply a distinct merchantOrderId on every call (NOT equal to the
 * orderId) so any silent fallback to `orderId` would be caught.
 */

/** A fixed merchantOrderId used across tests — distinct from any orderId. */
const MOID = '11111111-2222-3333-4444-555555555555';

describe('UpiDeepLinkPaymentAdapter — UPI URI construction', () => {
  const adapter = new UpiDeepLinkPaymentAdapter();

  function parseUpiUri(uri: string): URLSearchParams {
    // upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...&tr=...
    expect(uri).toMatch(/^upi:\/\/pay\?/);
    const query = uri.replace(/^upi:\/\/pay\?/, '');
    return new URLSearchParams(query);
  }

  it('constructs a valid upi://pay? URI with all required NPCI parameters', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'order-123',
      amountPaise: 5050, // ₹50.50
      shopUpiId: 'quickprint@okaxis',
      shopName: 'QuickPrint Demo Shop',
      customerToken: 'B5EY7Y',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    expect(intent.upiUri).toBeTruthy();
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('pa')).toBe('quickprint@okaxis');
    expect(params.get('pn')).toBe('QuickPrint Demo Shop');
    expect(params.get('am')).toBe('50.50');
    expect(params.get('cu')).toBe('INR');
    expect(params.get('tn')).toBe('PrintShop order B5EY7Y');
    expect(params.get('tr')).toBe('B5EY7Y');
  });

  it('uses the exact server-calculated amount (paise → rupees, 2 decimals)', async () => {
    const cases: { paise: number; expected: string }[] = [
      { paise: 100, expected: '1.00' },
      { paise: 105, expected: '1.05' },
      { paise: 5050, expected: '50.50' },
      { paise: 99999, expected: '999.99' },
      { paise: 100000, expected: '1000.00' },
      { paise: 0, expected: '0.00' },
    ];
    for (const c of cases) {
      const intent = await adapter.createPaymentIntent({
        orderId: 'o',
        amountPaise: c.paise,
        shopUpiId: 'shop@okaxis',
        shopName: 'Shop',
        customerToken: 'TOK1',
        shopCredentials: {},
        merchantOrderId: MOID,
      });
      const params = parseUpiUri(intent.upiUri!);
      expect(params.get('am')).toBe(c.expected);
    }
  });

  it('uses the shop actual name as pn (NOT hardcoded "PrintShop")', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'My Custom Shop Name',
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('pn')).toBe('My Custom Shop Name');
    expect(params.get('pn')).not.toBe('PrintShop');
  });

  it('falls back to "PrintShop" as pn if shopName is not provided', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('pn')).toBe('PrintShop');
  });

  it('uses the customerToken as the transaction reference (tr) + note (tn)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      amountPaise: 200,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'XYZ789',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('tr')).toBe('XYZ789');
    expect(params.get('tn')).toBe('PrintShop order XYZ789');
  });

  it('falls back to the orderId as tr if customerToken is not provided', async () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440000';
    const intent = await adapter.createPaymentIntent({
      orderId,
      amountPaise: 200,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('tr')).toBe(orderId);
    expect(params.get('tn')).toBe(`PrintShop order ${orderId.slice(0, 8)}`);
  });

  it('URL-encodes all parameters (no unescaped user-controlled values)', async () => {
    // Shop name with special characters that MUST be URL-encoded
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 'shop@okaxis',
      shopName: 'Shop & Sons (Pvt) Ltd',
      customerToken: 'TOK/with special',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    expect(intent.upiUri).toBeTruthy();
    // The URI must not contain raw spaces or unescaped & (the shop name has &)
    // URLSearchParams.toString() encodes & as %26, spaces as +
    expect(intent.upiUri).not.toMatch(/\s/); // no raw spaces
    // Verify the URI can be parsed back correctly
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('pn')).toBe('Shop & Sons (Pvt) Ltd');
    expect(params.get('tr')).toBe('TOK/with special');
  });

  it('sets cu=INR always (currency is hardcoded, not user-supplied)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    expect(params.get('cu')).toBe('INR');
  });

  it('does NOT include any application secrets in the URI', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: { saltKey: 'SECRET_KEY_123', merchantId: 'MERCHANT_ID' },
      merchantOrderId: MOID,
    });
    // The shopCredentials are NOT in the URI — they're for server-side
    // provider API calls (PhonePe/Paytm), NOT for the client-side UPI URI.
    expect(intent.upiUri).not.toContain('SECRET_KEY_123');
    expect(intent.upiUri).not.toContain('MERCHANT_ID');
    expect(intent.upiUri).not.toContain('saltKey');
    expect(intent.upiUri).not.toContain('merchantId');
  });

  it('sets qrPayload = upiUri (for desktop QR rendering)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    expect(intent.qrPayload).toBe(intent.upiUri);
  });

  it('sets expiresAt to 10 minutes from now', async () => {
    const before = Date.now();
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const after = Date.now();
    const expiresAt = intent.expiresAt.getTime();
    // 10 minutes = 600_000 ms. Allow a small delta for test execution time.
    expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 600_000 + 1000);
  });

  it('Phase 5.2.1: returns the supplied merchantOrderId VERBATIM (no fallback to orderId)', async () => {
    // The supplied merchantOrderId is distinct from the orderId. The adapter
    // MUST return it verbatim — NOT fall back to orderId, NOT generate a UUID.
    const intent = await adapter.createPaymentIntent({
      orderId: 'order-abc-123',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    expect(intent.merchantOrderId).toBe(MOID);
    // Critical: the adapter must NOT silently substitute the orderId.
    expect(intent.merchantOrderId).not.toBe('order-abc-123');
    // And it must NOT generate a random UUID (which would have a different format).
    expect(intent.merchantOrderId).toMatch(/^11111111-2222-3333-4444-555555555555$/);
    // The orderId is preserved separately.
    expect(intent.orderId).toBe('order-abc-123');
  });

  it('Phase 5.2.1: each call with a different merchantOrderId returns that exact value', async () => {
    // Verify the adapter doesn't cache or reuse a previous merchantOrderId.
    const moidA = 'aaaaaaaa-0000-0000-0000-000000000000';
    const moidB = 'bbbbbbbb-0000-0000-0000-000000000000';
    const intentA = await adapter.createPaymentIntent({
      orderId: 'o', amountPaise: 100, shopUpiId: 's@okaxis', shopCredentials: {}, merchantOrderId: moidA,
    });
    const intentB = await adapter.createPaymentIntent({
      orderId: 'o', amountPaise: 100, shopUpiId: 's@okaxis', shopCredentials: {}, merchantOrderId: moidB,
    });
    expect(intentA.merchantOrderId).toBe(moidA);
    expect(intentB.merchantOrderId).toBe(moidB);
    expect(intentA.merchantOrderId).not.toBe(intentB.merchantOrderId);
  });

  it('handles a shop name with non-ASCII characters (Unicode)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'श्री गणेश प्रिंट स्टोर', // Hindi shop name
      customerToken: 'TOK',
      shopCredentials: {},
      merchantOrderId: MOID,
    });
    const params = parseUpiUri(intent.upiUri!);
    // URLSearchParams.toString() encodes non-ASCII as UTF-8 percent-encoding
    expect(params.get('pn')).toBe('श्री गणेश प्रिंट स्टोर');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Phase 5.2.1: TypeScript compile-time contract verification
//
// The following type-level assertions verify that `merchantOrderId` is
// MANDATORY at the TypeScript level — omitting it is a COMPILE ERROR, not a
// runtime fallback. These are NOT runtime tests; they're type checks that
// would fail to compile if the contract regressed to optional.
//
// We use `// @ts-expect-error` to assert that omitting merchantOrderId IS
// an error. If someone makes the field optional again, the @ts-expect-error
// would become unused → TS2578 "unused @ts-expect-error" → compile failure.
// ──────────────────────────────────────────────────────────────────────────
import type { PaymentAdapter } from '@platform/core/interfaces';

describe('UpiDeepLinkPaymentAdapter — Phase 5.2.1 TypeScript contract', () => {
  it('omitting merchantOrderId is a TypeScript compile error (not a runtime fallback)', () => {
    // Type-level check: the following call MUST NOT type-check.
    // We verify this by asserting that the error exists via @ts-expect-error
    // in the helper below. This runtime test just confirms the adapter exists.
    const adapter: PaymentAdapter = new UpiDeepLinkPaymentAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.createPaymentIntent).toBe('function');
  });
});

// @ts-expect-error — omitting merchantOrderId MUST be a compile error.
// If the contract regresses to optional, this line would compile cleanly
// and the @ts-expect-error directive would become unused (TS2578), failing
// the build. This is the type-level guard for the mandatory contract.
const _typeCheckOmit = (a: PaymentAdapter) => a.createPaymentIntent({
  orderId: 'o',
  amountPaise: 100,
  shopUpiId: 's',
  shopCredentials: {},
  // merchantOrderId intentionally omitted — must be a compile error
});

// Type-level check: the field is `string` (not `string | undefined`).
type CreateIntentInput = Parameters<PaymentAdapter['createPaymentIntent']>[0];
type MerchantOrderIdType = CreateIntentInput['merchantOrderId'];
// `string` does NOT include `undefined` as a type-level optionality.
// This expression is always true at runtime; the real guard is that
// `Exclude<MerchantOrderIdType, undefined>` resolves to `string`.
const _typeCheckRequired: MerchantOrderIdType extends string ? true : false = true;
