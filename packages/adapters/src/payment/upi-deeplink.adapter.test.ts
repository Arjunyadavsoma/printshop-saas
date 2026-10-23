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
 */
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
    });
    const after = Date.now();
    const expiresAt = intent.expiresAt.getTime();
    // 10 minutes = 600_000 ms. Allow a small delta for test execution time.
    expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 600_000 + 1000);
  });

  it('returns merchantOrderId = orderId (used as the payment reference)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'order-abc-123',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'Shop',
      customerToken: 'TOK',
      shopCredentials: {},
    });
    expect(intent.merchantOrderId).toBe('order-abc-123');
    expect(intent.orderId).toBe('order-abc-123');
  });

  it('handles a shop name with non-ASCII characters (Unicode)', async () => {
    const intent = await adapter.createPaymentIntent({
      orderId: 'o',
      amountPaise: 100,
      shopUpiId: 's@okaxis',
      shopName: 'श्री गणेश प्रिंट स्टोर', // Hindi shop name
      customerToken: 'TOK',
      shopCredentials: {},
    });
    const params = parseUpiUri(intent.upiUri!);
    // URLSearchParams.toString() encodes non-ASCII as UTF-8 percent-encoding
    expect(params.get('pn')).toBe('श्री गणेश प्रिंट स्टोर');
  });
});
