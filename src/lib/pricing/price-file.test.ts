import { describe, it, expect } from 'vitest';
import { priceFileFromRecord } from '@/lib/pricing/price-file';
import {
  PricingConfigUnavailableError,
} from '@platform/core/pricing';
import { ValidationError } from '@platform/core/errors';
import {
  createDefaultPricingConfig,
  type PrintFile,
  type Shop,
  type ShopPricingConfig,
} from '@platform/core/domain';

/**
 * Unit tests for the shared `priceFileFromRecord` helper — the SINGLE
 * authoritative pricing entry point used by the confirm, PATCH, page-count
 * override, and checkout-recalc routes.
 *
 * These tests pin down the three contract obligations the helper enforces
 * (in order):
 *   1. The shop's pricing config must be valid (reject ₹0-from-missing-config).
 *   2. The file must have a trustworthy page count (`pageCount > 0`). A
 *      placeholder (null) file CANNOT be priced — the caller must surface a
 *      ValidationError so the customer/shopkeeper enters the page count.
 *   3. The page range must parse + validate against the file's pageCount.
 *
 * Default pricing config (createDefaultPricingConfig):
 *   - bw_a4_per_page = 200 paise (₹2)
 *   - min_order_value = 500 paise (₹5)
 *   - bulk_threshold = 100 pages, bulk_discount_pct = 5%
 *   - duplex_discount = 10%
 *
 * So 1 page bw/a4 → 200 paise gross, below the ₹5 min → rounded up to 500.
 * 5 pages bw/a4 → 1000 paise gross, above the ₹5 min → 1000 paise total.
 */

// ── Test fixtures ────────────────────────────────────────────────────
// A minimal valid Shop with the default pricing config. Individual tests
// override `pricingConfig` or the file's fields as needed.
function makeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop-test-1',
    name: 'Test Shop',
    slug: 'test-shop',
    ownerUserId: 'owner-test-1',
    upiId: 'shop@okaxis',
    paymentProvider: 'googlepay',
    paymentCredentials: {},
    pricingConfig: createDefaultPricingConfig(),
    address: '123 Test St',
    phone: '5555555555',
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
    paymentMethods: 'both',
    pamphletEnabled: false,
    pamphletPricePaise: 0,
    pamphletName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeFile(overrides: Partial<PrintFile> = {}): PrintFile {
  return {
    id: 'file-test-1',
    orderId: 'order-test-1',
    originalFilename: 'doc.pdf',
    storageKey: 'shops/shop-test-1/orders/order-test-1/file-test-1',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    pageCount: 1,
    pageCountSource: 'auto_extracted',
    copies: 1,
    colorMode: 'bw',
    pageRange: null,
    paperSize: 'a4',
    duplex: false,
    pricePaise: 0,
    status: 'pending',
    processingError: null,
    printedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('priceFileFromRecord', () => {
  describe('happy path — auto-extracted page count', () => {
    it('prices a 1-page bw/a4 PDF at the minimum order value (₹5 = 500 paise)', () => {
      // 1 page × 200 paise = 200 paise gross. Below the ₹5 min order → rounded
      // up to 500 paise. This proves the file was actually priced (the price
      // is the min, not zero) and the min-order adjustment was applied.
      const result = priceFileFromRecord(makeFile(), makeShop());
      expect(result.totalPaise).toBe(500);
      expect(result.billablePages).toBe(1);
      // A line item for the print must exist; a min-order adjustment line
      // tops the subtotal up to the floor.
      expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
      expect(result.lineItems.some((li) => /print/i.test(li.label))).toBe(true);
    });

    it('prices a 5-page bw/a4 PDF above the minimum (5 × 200 = 1000 paise)', () => {
      // 5 pages × 200 paise = 1000 paise. Above the ₹5 min → no adjustment.
      const result = priceFileFromRecord(
        makeFile({ pageCount: 5 }),
        makeShop(),
      );
      expect(result.totalPaise).toBe(1000);
      expect(result.billablePages).toBe(5);
    });
  });

  describe('placeholder / unknown page count', () => {
    it('throws ValidationError when pageCount is null (placeholder)', () => {
      // A file whose page count could not be auto-extracted (legacy .doc,
      // corrupted PDF) has pageCount=null + pageCountSource='placeholder'.
      // It MUST NOT be priced — the customer/shopkeeper must enter the count
      // first. A silent ₹0 bill here would be a revenue leak.
      const placeholderFile = makeFile({
        pageCount: null,
        pageCountSource: 'placeholder',
        originalFilename: 'legacy.doc',
      });
      expect(() => priceFileFromRecord(placeholderFile, makeShop())).toThrow(ValidationError);
      try {
        priceFileFromRecord(placeholderFile, makeShop());
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as Error).message).toMatch(/page count/i);
        // The error must reference the offending file so the customer UI can
        // show which file needs attention (multiple files in one order).
        expect((e as Error).message).toContain('legacy.doc');
      }
    });

    it('throws ValidationError when pageCount is 0', () => {
      // Defensive: a zero pageCount (should never happen for a real file, but
      // could come from a buggy parser) must also be rejected.
      const zeroPageFile = makeFile({ pageCount: 0 });
      expect(() => priceFileFromRecord(zeroPageFile, makeShop())).toThrow(ValidationError);
    });
  });

  describe('shop pricing config validation', () => {
    it('throws PricingConfigUnavailableError when the shop config is empty {}', () => {
      // An un-configured shop has no rates set. The guard fires BEFORE the
      // page-count check — there's no point pricing a file against a shop
      // that hasn't been set up for billing.
      const emptyConfigShop = makeShop({
        pricingConfig: {} as unknown as ShopPricingConfig,
      });
      expect(() =>
        priceFileFromRecord(makeFile(), emptyConfigShop),
      ).toThrow(PricingConfigUnavailableError);
    });

    it('throws PricingConfigUnavailableError when bw_a4_per_page is undefined', () => {
      const partialConfigShop = makeShop({
        pricingConfig: {
          ...createDefaultPricingConfig(),
          bw_a4_per_page: undefined,
        } as unknown as ShopPricingConfig,
      });
      expect(() =>
        priceFileFromRecord(makeFile(), partialConfigShop),
      ).toThrow(PricingConfigUnavailableError);
    });
  });

  describe('page range selection', () => {
    it('prices only the selected pages when pageRange is set (5 of 10 → 1000 paise)', () => {
      // A 10-page document with pageRange="1-5" must bill for 5 pages only,
      // NOT the full 10. This was the P1-15 revenue bug — the PATCH endpoint
      // used to bill for the full page count even when the customer selected
      // a subset.
      const file = makeFile({
        pageCount: 10,
        pageRange: '1-5',
      });
      const result = priceFileFromRecord(file, makeShop());
      expect(result.billablePages).toBe(5);
      // 5 × 200 = 1000 paise. Above the ₹5 min → exact price, no adjustment.
      expect(result.totalPaise).toBe(1000);
    });

    it('handles a sparse comma-separated range ("1,3,5" of 5 → 3 billable pages)', () => {
      const file = makeFile({
        pageCount: 5,
        pageRange: '1,3,5',
      });
      const result = priceFileFromRecord(file, makeShop());
      expect(result.billablePages).toBe(3);
      // 3 × 200 = 600 paise. Above the ₹5 min → 600 paise exact.
      expect(result.totalPaise).toBe(600);
    });

    it('throws ValidationError when the page range is malformed', () => {
      // "abc" is not a valid range expression → resolveBillablePages returns
      // {error} → priceFileFromRecord surfaces it as a ValidationError so
      // the route returns a 400 with a clear, actionable message.
      const file = makeFile({
        pageCount: 10,
        pageRange: 'abc',
      });
      expect(() => priceFileFromRecord(file, makeShop())).toThrow(ValidationError);
      try {
        priceFileFromRecord(file, makeShop());
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        // The error must reference the bad input so the customer can correct it.
        expect((e as Error).message).toContain('abc');
      }
    });

    it('throws ValidationError when the page range references pages outside the document', () => {
      // "1-15" on a 10-page document → out-of-range. The customer may have
      // mis-typed or is attempting to bill for pages that don't exist.
      const file = makeFile({
        pageCount: 10,
        pageRange: '1-15',
      });
      expect(() => priceFileFromRecord(file, makeShop())).toThrow(ValidationError);
    });

    it('throws ValidationError when the page range is reversed ("5-3")', () => {
      const file = makeFile({
        pageCount: 10,
        pageRange: '5-3',
      });
      expect(() => priceFileFromRecord(file, makeShop())).toThrow(ValidationError);
    });
  });
});
