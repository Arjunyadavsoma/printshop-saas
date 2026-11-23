import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  buildUpiUri,
  paiseToRupees,
  sanitizeNote,
  sanitizeReference,
  assertValidVpa,
  isValidVpa,
  UpiLinkError,
  UPI_APP_SCHEMES,
  resolveAppScheme,
  MAX_PN_LENGTH,
  MAX_TN_LENGTH,
  MAX_TR_LENGTH,
} from './upi-link';

/**
 * UPI deep-link builder unit tests (P8.1).
 *
 * Covers every edge case called out in the brief:
 *   - Valid VPA format (name@bank)
 *   - Shop name with spaces → URL-encoded
 *   - Shop name with Hindi/Devanagari → URL-encoded
 *   - Shop name with Telugu → URL-encoded
 *   - Shop name with ampersand → URL-encoded
 *   - Amount: integer paise → exactly 2 decimal rupees
 *   - Amount: 0 paise → "0.00"
 *   - Amount: 5 paise → "0.05"
 *   - tn (note): length limit + no URI-breaking chars
 *   - tr (transaction reference): alphanumeric only
 *
 * Plus the app-specific scheme registry contract: only the generic `upi://`
 * link is `verified: true` — every app-specific scheme is documented but
 * NOT shipped as a dedicated button (because the public docs don't
 * contract a plain deep-link form).
 */

/** Parse the query string out of a `upi://pay?…` URI. */
function parseUpiUri(uri: string): URLSearchParams {
  if (!uri.startsWith('upi://pay?')) {
    throw new Error(`Not a upi:// URI: ${uri}`);
  }
  return new URLSearchParams(uri.replace(/^upi:\/\/pay\?/, ''));
}

describe('buildUpiUri — VPA (pa parameter)', () => {
  it('accepts a valid VPA in the name@bank format', () => {
    const uri = buildUpiUri({
      pa: 'quickprint@okaxis',
      pn: 'QuickPrint',
      am: 4800,
      tr: 'ORDER123',
    });
    const params = parseUpiUri(uri);
    expect(params.get('pa')).toBe('quickprint@okaxis');
  });

  it('accepts VPA with dots, dashes, and underscores in the name part', () => {
    const uri = buildUpiUri({
      pa: 'quick_print.sv-1@oksbi',
      pn: 'Shop',
      am: 100,
      tr: 'REF1',
    });
    expect(parseUpiUri(uri).get('pa')).toBe('quick_print.sv-1@oksbi');
  });

  it('throws UpiLinkError on an invalid VPA (missing @)', () => {
    expect(() =>
      buildUpiUri({ pa: 'notanid', pn: 'Shop', am: 100, tr: 'R' }),
    ).toThrow(UpiLinkError);
  });

  it('throws UpiLinkError on an invalid VPA (numeric bank part)', () => {
    expect(() =>
      buildUpiUri({ pa: 'shop@123', pn: 'Shop', am: 100, tr: 'R' }),
    ).toThrow(UpiLinkError);
  });

  it('trims whitespace around the VPA before validating', () => {
    const uri = buildUpiUri({
      pa: '  quickprint@okaxis  ',
      pn: 'Shop',
      am: 100,
      tr: 'R',
    });
    expect(parseUpiUri(uri).get('pa')).toBe('quickprint@okaxis');
  });
});

describe('buildUpiUri — payee name (pn parameter)', () => {
  it('URL-encodes spaces in the shop name', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Quick Print Services',
      am: 100,
      tr: 'R1',
    });
    // URLSearchParams encodes spaces as `+` (also valid in URLs).
    // Critically: the URI contains NO raw spaces.
    expect(uri).not.toMatch(/\s/);
    expect(parseUpiUri(uri).get('pn')).toBe('Quick Print Services');
  });

  it('URL-encodes Hindi / Devanagari characters in the shop name', () => {
    const name = 'श्री गणेश प्रिंट स्टोर';
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: name,
      am: 100,
      tr: 'R1',
    });
    // No raw non-ASCII chars in the URI (they're percent-encoded).
    expect(uri).toMatch(/^upi:\/\/pay\?[\x00-\x7F]+$/);
    expect(parseUpiUri(uri).get('pn')).toBe(name);
  });

  it('URL-encodes Telugu characters in the shop name', () => {
    const name = 'శ్రీ గణేష్ ప్రింట్ స్టోర్';
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: name,
      am: 100,
      tr: 'R1',
    });
    expect(uri).toMatch(/^upi:\/\/pay\?[\x00-\x7F]+$/);
    expect(parseUpiUri(uri).get('pn')).toBe(name);
  });

  it('URL-encodes an ampersand in the shop name (critical: & is the URI param delimiter)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop & Sons',
      am: 100,
      tr: 'R1',
    });
    // The ampersand MUST be percent-encoded as %26 — a raw & would split
    // the pn value into a new parameter.
    expect(uri).toContain('Shop+%26+Sons');
    expect(uri).not.toContain('Shop+%26+Sons&pn'); // sanity: only one pn
    expect(parseUpiUri(uri).get('pn')).toBe('Shop & Sons');
  });

  it('URL-encodes parentheses, slashes, and other reserved chars', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop (Pvt) Ltd / Branch-1',
      am: 100,
      tr: 'R1',
    });
    expect(uri).not.toMatch(/\s/);
    expect(parseUpiUri(uri).get('pn')).toBe('Shop (Pvt) Ltd / Branch-1');
  });

  it(`truncates the payee name to ${MAX_PN_LENGTH} characters`, () => {
    const longName = 'A'.repeat(MAX_PN_LENGTH + 20);
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: longName,
      am: 100,
      tr: 'R1',
    });
    const pn = parseUpiUri(uri).get('pn')!;
    expect(pn.length).toBe(MAX_PN_LENGTH);
  });
});

describe('buildUpiUri — amount (am parameter, paise → rupees)', () => {
  it('converts integer paise to exactly 2 decimal rupees (4800 → "48.00")', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 4800,
      tr: 'R1',
    });
    expect(parseUpiUri(uri).get('am')).toBe('48.00');
  });

  it('converts 0 paise to "0.00"', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 0,
      tr: 'R1',
    });
    expect(parseUpiUri(uri).get('am')).toBe('0.00');
  });

  it('converts 5 paise to "0.05" (sub-rupee amounts)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 5,
      tr: 'R1',
    });
    expect(parseUpiUri(uri).get('am')).toBe('0.05');
  });

  it('converts 105 paise to "1.05" (rupee + sub-rupee)', () => {
    expect(parseUpiUri(
      buildUpiUri({ pa: 'shop@okaxis', pn: 'S', am: 105, tr: 'R' }),
    ).get('am')).toBe('1.05');
  });

  it('converts 100000 paise to "1000.00" (large amounts)', () => {
    expect(parseUpiUri(
      buildUpiUri({ pa: 'shop@okaxis', pn: 'S', am: 100000, tr: 'R' }),
    ).get('am')).toBe('1000.00');
  });

  it('always sets cu=INR (currency is hardcoded)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
    });
    expect(parseUpiUri(uri).get('cu')).toBe('INR');
  });

  it('throws UpiLinkError on a negative amount', () => {
    expect(() =>
      buildUpiUri({ pa: 'shop@okaxis', pn: 'S', am: -1, tr: 'R' }),
    ).toThrow(UpiLinkError);
  });

  it('throws UpiLinkError on a non-finite amount (NaN / Infinity)', () => {
    expect(() =>
      buildUpiUri({ pa: 'shop@okaxis', pn: 'S', am: Number.NaN, tr: 'R' }),
    ).toThrow(UpiLinkError);
    expect(() =>
      buildUpiUri({ pa: 'shop@okaxis', pn: 'S', am: Number.POSITIVE_INFINITY, tr: 'R' }),
    ).toThrow(UpiLinkError);
  });

  it('floors a non-integer paise input (defensive against a stray float)', () => {
    // 100.9 paise → floored to 100 paise → "1.00"
    expect(paiseToRupees(100.9)).toBe('1.00');
  });
});

describe('buildUpiUri — transaction note (tn parameter)', () => {
  it('omits tn entirely when not provided (no `tn=` in the URI)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
    });
    expect(uri).not.toContain('tn=');
    expect(parseUpiUri(uri).has('tn')).toBe(false);
  });

  it('omits tn when the note is an empty string', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: '',
    });
    expect(uri).not.toContain('tn=');
  });

  it('includes tn when a non-empty note is provided', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: 'Order for Ravi',
    });
    expect(parseUpiUri(uri).get('tn')).toBe('Order for Ravi');
  });

  it(`truncates tn to ${MAX_TN_LENGTH} characters`, () => {
    const longNote = 'N'.repeat(MAX_TN_LENGTH + 30);
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: longNote,
    });
    expect(parseUpiUri(uri).get('tn')!.length).toBe(MAX_TN_LENGTH);
  });

  it('strips newlines and control chars from tn (they break URI parsing in some UPI apps)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: 'Order\nfor\tRavi\r\n',
    });
    const tn = parseUpiUri(uri).get('tn')!;
    expect(tn).toBe('OrderforRavi');
    // No control chars survive into the URI.
    expect(uri).not.toMatch(/[\u0000-\u001F\u007F]/);
  });

  it('strips angle brackets and backticks from tn (URI-breaking chars)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: 'Order <script>alert(1)</script>`x`',
    });
    const tn = parseUpiUri(uri).get('tn')!;
    expect(tn).not.toContain('<');
    expect(tn).not.toContain('>');
    expect(tn).not.toContain('`');
  });

  it('URL-encodes ampersands in tn (so they do not split into a new param)', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: 'Ravi & Co',
    });
    expect(uri).toContain('Ravi+%26+Co');
    expect(parseUpiUri(uri).get('tn')).toBe('Ravi & Co');
  });

  it('preserves Devanagari characters in tn (URL-encoded)', () => {
    const note = 'ऑर्डर रवि';
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
      tn: note,
    });
    expect(uri).toMatch(/^upi:\/\/pay\?[\x00-\x7F]+$/);
    expect(parseUpiUri(uri).get('tn')).toBe(note);
  });
});

describe('buildUpiUri — transaction reference (tr parameter)', () => {
  it('passes a clean alphanumeric reference through unchanged', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'ORDER123',
    });
    expect(parseUpiUri(uri).get('tr')).toBe('ORDER123');
  });

  it('accepts dashes and underscores in the reference', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'ORDER-123_x',
    });
    expect(parseUpiUri(uri).get('tr')).toBe('ORDER-123_x');
  });

  it('replaces non-alphanumeric chars (spaces, slashes, ampersands) with dashes', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'ORDER 123/A&B',
    });
    const tr = parseUpiUri(uri).get('tr')!;
    expect(tr).toBe('ORDER-123-A-B');
    // The reference must be alphanumeric + dash only.
    expect(tr).toMatch(/^[A-Za-z0-9-_]+$/);
  });

  it('collapses runs of dashes in the reference', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'A   B///C',
    });
    expect(parseUpiUri(uri).get('tr')).toBe('A-B-C');
  });

  it(`truncates the reference to ${MAX_TR_LENGTH} characters`, () => {
    const longRef = 'A'.repeat(MAX_TR_LENGTH + 20);
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: longRef,
    });
    expect(parseUpiUri(uri).get('tr')!.length).toBe(MAX_TR_LENGTH);
  });

  it('falls back to "order" if the sanitized reference is empty', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: '   ///   ',
    });
    expect(parseUpiUri(uri).get('tr')).toBe('order');
  });
});

describe('buildUpiUri — full URI shape', () => {
  it('starts with "upi://pay?"', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
    });
    expect(uri.startsWith('upi://pay?')).toBe(true);
  });

  it('always includes pa, pn, am, cu, tr parameters', () => {
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
    });
    const params = parseUpiUri(uri);
    expect(params.has('pa')).toBe(true);
    expect(params.has('pn')).toBe(true);
    expect(params.has('am')).toBe(true);
    expect(params.has('cu')).toBe(true);
    expect(params.has('tr')).toBe(true);
  });

  it('does not include any application secrets in the URI', () => {
    // The builder only takes the VPA + name + amount + ref + note — there
    // is no `credentials` parameter, so secrets can never leak. This test
    // documents that invariant: the function signature has no secret input.
    const uri = buildUpiUri({
      pa: 'shop@okaxis',
      pn: 'Shop',
      am: 100,
      tr: 'R1',
    });
    expect(uri).not.toContain('SECRET');
    expect(uri).not.toContain('saltKey');
    expect(uri).not.toContain('merchantId');
  });

  it('produces a stable URI for the same inputs (idempotent)', () => {
    const args = {
      pa: 'shop@okaxis',
      pn: 'QuickPrint',
      am: 4800,
      tr: 'ORDER123',
      tn: 'Ravi order',
    };
    const a = buildUpiUri(args);
    const b = buildUpiUri(args);
    expect(a).toBe(b);
  });

  it('round-trips: the URI can be parsed by URLSearchParams without data loss', () => {
    const args = {
      pa: 'shop@okaxis',
      pn: 'Quick Print & Sons',
      am: 4800,
      tr: 'ORDER-123',
      tn: 'Ravi & Co order',
    };
    const uri = buildUpiUri(args);
    const params = parseUpiUri(uri);
    expect(params.get('pa')).toBe(args.pa);
    expect(params.get('pn')).toBe(args.pn);
    expect(params.get('am')).toBe('48.00');
    expect(params.get('cu')).toBe('INR');
    expect(params.get('tr')).toBe(args.tr);
    expect(params.get('tn')).toBe(args.tn);
  });
});

// ── Pure helper unit tests ──────────────────────────────────────────────────

describe('paiseToRupees', () => {
  it('4800 → "48.00"', () => expect(paiseToRupees(4800)).toBe('48.00'));
  it('0 → "0.00"', () => expect(paiseToRupees(0)).toBe('0.00'));
  it('5 → "0.05"', () => expect(paiseToRupees(5)).toBe('0.05'));
  it('105 → "1.05"', () => expect(paiseToRupees(105)).toBe('1.05'));
  it('100 → "1.00"', () => expect(paiseToRupees(100)).toBe('1.00'));
  it('99999 → "999.99"', () => expect(paiseToRupees(99999)).toBe('999.99'));
  it('100000 → "1000.00"', () => expect(paiseToRupees(100000)).toBe('1000.00'));
  it('throws on negative', () => {
    expect(() => paiseToRupees(-1)).toThrow(UpiLinkError);
  });
  it('throws on NaN', () => {
    expect(() => paiseToRupees(Number.NaN)).toThrow(UpiLinkError);
  });
  it('throws on Infinity', () => {
    expect(() => paiseToRupees(Number.POSITIVE_INFINITY)).toThrow(UpiLinkError);
  });
});

describe('sanitizeNote', () => {
  it('returns empty for undefined', () => {
    expect(sanitizeNote(undefined)).toBe('');
  });
  it('returns empty for empty string', () => {
    expect(sanitizeNote('')).toBe('');
  });
  it('preserves plain text', () => {
    expect(sanitizeNote('Hello world')).toBe('Hello world');
  });
  it('strips newlines and tabs', () => {
    expect(sanitizeNote('Hello\nworld\t!')).toBe('Helloworld!');
  });
  it('strips angle brackets and backticks', () => {
    expect(sanitizeNote('<a>`b`</a>')).toBe('ab/a');
  });
  it(`truncates to ${MAX_TN_LENGTH} chars`, () => {
    const long = 'X'.repeat(MAX_TN_LENGTH + 10);
    expect(sanitizeNote(long).length).toBe(MAX_TN_LENGTH);
  });
});

describe('sanitizeReference', () => {
  it('returns empty for undefined', () => {
    expect(sanitizeReference('')).toBe('');
  });
  it('preserves alphanumeric + dash + underscore', () => {
    expect(sanitizeReference('ABC-123_x')).toBe('ABC-123_x');
  });
  it('replaces spaces with dashes', () => {
    expect(sanitizeReference('A B C')).toBe('A-B-C');
  });
  it('replaces slashes with dashes', () => {
    expect(sanitizeReference('A/B/C')).toBe('A-B-C');
  });
  it('replaces ampersands with dashes', () => {
    expect(sanitizeReference('A&B&C')).toBe('A-B-C');
  });
  it('collapses runs of dashes', () => {
    expect(sanitizeReference('A---B')).toBe('A-B');
  });
  it('strips leading/trailing dashes', () => {
    expect(sanitizeReference('--A--')).toBe('A');
  });
  it(`truncates to ${MAX_TR_LENGTH} chars`, () => {
    const long = 'A'.repeat(MAX_TR_LENGTH + 10);
    expect(sanitizeReference(long).length).toBe(MAX_TR_LENGTH);
  });
});

describe('assertValidVpa / isValidVpa', () => {
  it('accepts standard VPA', () => {
    expect(isValidVpa('shop@okaxis')).toBe(true);
    expect(isValidVpa('shop.name@oksbi')).toBe(true);
    expect(isValidVpa('shop-name@ybl')).toBe(true);
    expect(isValidVpa('shop_name@ibl')).toBe(true);
  });
  it('rejects VPA without @', () => {
    expect(isValidVpa('shopokaxis')).toBe(false);
  });
  it('rejects VPA with numeric bank part', () => {
    expect(isValidVpa('shop@123')).toBe(false);
  });
  it('rejects VPA with special chars in bank part', () => {
    expect(isValidVpa('shop@ok-axis')).toBe(false);
  });
  it('assertValidVpa trims and returns the clean VPA', () => {
    expect(assertValidVpa('  shop@okaxis  ')).toBe('shop@okaxis');
  });
  it('assertValidVpa throws on invalid', () => {
    expect(() => assertValidVpa('nope')).toThrow(UpiLinkError);
  });
});

// ── App-specific scheme registry ────────────────────────────────────────────

describe('UPI_APP_SCHEMES — verified scheme registry', () => {
  it('lists the four app-specific schemes + the generic upi:// entry', () => {
    const ids = UPI_APP_SCHEMES.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(['googlepay', 'phonepe', 'paytm', 'bhim', 'other']),
    );
  });

  it('marks EVERY app-specific scheme as NOT verified (we ship only generic upi://)', () => {
    // Per the brief: if a scheme can't be verified from official docs, we
    // DO NOT ship that button — use the generic upi:// link only.
    const appSpecific = UPI_APP_SCHEMES.filter((s) => s.scheme !== 'upi://');
    for (const entry of appSpecific) {
      expect(entry.verified).toBe(false);
      // Every entry (verified or not) MUST carry a source URL so a reviewer
      // can re-check the verification status.
      expect(entry.source).toMatch(/^https?:\/\//);
      expect(entry.source.length).toBeGreaterThan(10);
      expect(entry.notes.length).toBeGreaterThan(10);
    }
  });

  it('marks the generic upi:// entry as verified (always works)', () => {
    const generic = UPI_APP_SCHEMES.find((s) => s.scheme === 'upi://');
    expect(generic).toBeDefined();
    expect(generic!.verified).toBe(true);
    expect(generic!.source).toMatch(/^https?:\/\//);
  });

  it('every entry has a non-empty source URL + notes', () => {
    for (const entry of UPI_APP_SCHEMES) {
      expect(entry.source).toMatch(/^https?:\/\//);
      expect(entry.notes.length).toBeGreaterThan(10);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.scheme.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAppScheme', () => {
  it('returns the generic upi:// URI for the "other" app (verified)', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('other', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
    expect(result.appSpecific).toBe(false);
  });

  it('falls back to generic upi:// for Google Pay (NOT verified)', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('googlepay', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
    expect(result.appSpecific).toBe(false);
  });

  it('falls back to generic upi:// for PhonePe (NOT verified)', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('phonepe', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
    expect(result.appSpecific).toBe(false);
  });

  it('falls back to generic upi:// for Paytm (NOT verified)', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('paytm', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
    expect(result.appSpecific).toBe(false);
  });

  it('falls back to generic upi:// for BHIM (NOT verified)', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('bhim', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
    expect(result.appSpecific).toBe(false);
  });

  it('falls back to generic upi:// for an unknown app ID', () => {
    const upiUri = 'upi://pay?pa=shop@okaxis&pn=Shop&am=1.00&cu=INR&tr=R1';
    const result = resolveAppScheme('does-not-exist', upiUri);
    expect(result.scheme).toBe('upi://');
    expect(result.uri).toBe(upiUri);
  });
});

// ── Type-level contracts ────────────────────────────────────────────────────

describe('buildUpiUri — TypeScript signature contract', () => {
  it('exposes the documented parameter shape', () => {
    // The function signature MUST accept exactly these fields — `tn` is
    // optional, the rest are required. If someone makes `am` optional or
    // adds an unmentioned required field, this type-level check fails.
    expectTypeOf(buildUpiUri)
      .parameter(0)
      .toMatchTypeOf<{
        pa: string;
        pn: string;
        am: number;
        tr: string;
        tn?: string;
      }>();
    expectTypeOf(buildUpiUri).returns.toMatchTypeOf<string>();
  });
});
