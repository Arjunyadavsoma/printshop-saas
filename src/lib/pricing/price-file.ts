import { repos } from '@/lib/repositories';
import { priceFile, validatePricingConfig, type LineItem } from '@platform/core/pricing';
import { resolveBillablePages } from '@/lib/pricing/page-selection';
import { ValidationError, NotFoundError } from '@platform/core/errors';
import type { PrintFile, Shop, ShopPricingConfig } from '@platform/core/domain';

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
 * H7 fix: the per-shop `min_order_value` is NOT applied here — per-file
 * pricing uses a copy of the config with `min_order_value: 0`. The minimum
 * is enforced once at the ORDER level in {@link recalcOrderTotal}, so a
 * 1-page ₹2 file in a 3-file ₹6 order is billed at ₹6 (not bumped to ₹10
 * thrice). Previously each file got its own min-order bump, inflating small
 * multi-file orders by up to N× the minimum.
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

  // H7: per-file pricing bypasses the min-order check. The config is cloned
  // with min_order_value: 0 so the engine's `subtotal < min_order_value`
  // branch never fires and no min-order adjustment line item is added.
  // The min-order check is applied once at the order level in
  // recalcOrderTotal after summing all file prices.
  const perFileConfig: ShopPricingConfig = {
    ...shop.pricingConfig,
    min_order_value: 0,
  };

  const result = priceFile({
    pages: resolved.billablePages,
    copies: file.copies,
    colorMode: file.colorMode,
    paperSize: file.paperSize,
    duplex: file.duplex,
    shopPricingConfig: perFileConfig,
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
 *
 * H7 fix: the per-shop `min_order_value` is applied HERE, once at the order
 * level, AFTER summing the per-file prices. Previously the min-order bump
 * was applied per file inside `priceFileFromRecord`, so a multi-file order
 * of N small files could be billed at N× the minimum. Now a 3-file order
 * totalling ₹6 against a ₹10 minimum pays ₹10 (the minimum once), not ₹30
 * (the minimum thrice).
 */
export async function recalcOrderTotal(orderId: string): Promise<number> {
  const order = await repos.orders.findById(orderId);
  if (!order) throw new NotFoundError(`Order ${orderId} not found`);
  const shop = await repos.shops.findById(order.shopId);
  if (!shop) throw new NotFoundError(`Shop ${order.shopId} not found`);

  const files = await repos.files.findByOrder(orderId);
  const fileSum = files.reduce((acc, f) => acc + f.pricePaise, 0);

  // Apply the per-order minimum once — but ONLY when there is at least one
  // priced file. If all files are placeholder/needs_review (pricePaise=0),
  // the order total stays 0 so the customer doesn't see a fake minimum charge
  // for files that can't be priced yet.
  const hasPricedFile = files.some((f) => f.pricePaise > 0);
  const minOrderValue = shop.pricingConfig.min_order_value ?? 0;
  const total = hasPricedFile && fileSum < minOrderValue ? minOrderValue : fileSum;

  await repos.orders.update(orderId, { totalAmountPaise: total });
  return total;
}
