import { repos } from '@/lib/repositories';
import { priceFile, validatePricingConfig, type LineItem } from '@platform/core/pricing';
import { resolveBillablePages } from '@/lib/pricing/page-selection';
import { ValidationError } from '@platform/core/errors';
import type { PrintFile, Shop } from '@platform/core/domain';

/**
 * Shared pricing helper — the SINGLE authoritative way to price a file.
 *
 * Every route that needs to price a file (confirm, PATCH, page-count override,
 * checkout recalculation) MUST call this function. This prevents pricing logic
 * drift across endpoints.
 *
 * Steps:
 *  1. Validate the shop's pricing config (reject ₹0 from missing config).
 *  2. Resolve billable pages from pageRange + pageCount.
 *  3. Call the pricing engine with integer paise arithmetic.
 *
 * @throws {PricingConfigUnavailableError} if the shop has no valid config.
 * @throws {ValidationError} if the page range is invalid.
 */
export function priceFileFromRecord(file: PrintFile, shop: Shop): {
  totalPaise: number;
  billablePages: number;
  lineItems: LineItem[];
} {
  validatePricingConfig(shop.pricingConfig, shop.id);

  const pageCount = file.pageCount ?? 0;
  if (pageCount <= 0) {
    throw new ValidationError(
      `Cannot price "${file.originalFilename}" — page count is unknown. ` +
        'The customer or shopkeeper must set the page count first.',
    );
  }

  const resolved = resolveBillablePages(file.pageRange, pageCount);
  if ('error' in resolved) {
    throw new ValidationError(resolved.error);
  }

  const result = priceFile({
    pages: resolved.billablePages,
    copies: file.copies,
    colorMode: file.colorMode,
    paperSize: file.paperSize,
    duplex: file.duplex,
    shopPricingConfig: shop.pricingConfig,
  });

  return {
    totalPaise: result.totalPaise,
    billablePages: resolved.billablePages,
    lineItems: result.lineItems,
  };
}

/**
 * Recalculate the order total from persisted file records.
 *
 * Sums `pricePaise` across all files in the order and persists the total.
 * Called after any file price change (confirm, PATCH, page-count override).
 */
export async function recalcOrderTotal(orderId: string): Promise<number> {
  const files = await repos.files.findByOrder(orderId);
  const total = files.reduce((acc, f) => acc + f.pricePaise, 0);
  await repos.orders.update(orderId, { totalAmountPaise: total });
  return total;
}
