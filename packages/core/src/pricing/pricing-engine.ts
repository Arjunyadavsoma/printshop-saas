import type { LineItem, PricingInput, PricingResult } from './types';
import type { PricingBehaviour } from './types';
import { DEFAULT_PRICING_BEHAVIOUR } from './breakdown';
import { computeBreakdown } from './breakdown';
import { colorLabel } from './resolve-rate';

/**
 * The pricing engine entry point.
 *
 * Rules (see §9 of the spec):
 *  - Base rate = config[`${colorMode}_${paperSize}_per_page`]
 *  - Duplex: if duplex AND config.duplex_discount > 0 → discount % off gross
 *  - Bulk: if totalPages >= config.bulk_threshold AND bulk_discount_pct > 0
 *          → discount % off the post-duplex subtotal
 *  - Min order: if subtotal < min_order_value → round up (default) or reject
 *  - All math in integer paise, round half-up at each step
 *
 * @param input - the file to price
 * @param behaviour - optional min-order handling
 * @returns the total + itemised line items
 */
export function priceFile(
  input: PricingInput,
  behaviour: PricingBehaviour = DEFAULT_PRICING_BEHAVIOUR,
): PricingResult {
  const b = computeBreakdown(input);
  const subtotal = b.grossPaise - b.duplexSavingPaise - b.bulkSavingPaise;

  if (subtotal < input.shopPricingConfig.min_order_value) {
    if (behaviour.onBelowMin === 'reject') {
      throw new PricingBelowMinimumError(subtotal, input.shopPricingConfig.min_order_value);
    }
  }

  const items: LineItem[] = [
    {
      label: `Print (${colorLabel(input.colorMode)}, ${input.paperSize.toUpperCase()})`,
      quantity: b.totalPages,
      unitPaise: b.baseRatePaise,
      subtotalPaise: b.grossPaise,
    },
  ];
  if (b.duplexSavingPaise > 0) {
    items.push({
      label: 'Duplex (both-side) discount',
      quantity: 1,
      unitPaise: -b.duplexSavingPaise,
      subtotalPaise: -b.duplexSavingPaise,
    });
  }
  if (b.bulkSavingPaise > 0) {
    items.push({
      label: 'Bulk discount',
      quantity: 1,
      unitPaise: -b.bulkSavingPaise,
      subtotalPaise: -b.bulkSavingPaise,
    });
  }
  if (b.minOrderAdjPaise > 0) {
    items.push({
      label: 'Minimum order adjustment',
      quantity: 1,
      unitPaise: b.minOrderAdjPaise,
      subtotalPaise: b.minOrderAdjPaise,
    });
  }
  const totalPaise = subtotal + b.minOrderAdjPaise;
  return { totalPaise, lineItems: items };
}

/** Thrown when `behaviour.onBelowMin = 'reject'` and the order is too small. */
export class PricingBelowMinimumError extends Error {
  constructor(
    public readonly subtotalPaise: number,
    public readonly minOrderValuePaise: number,
  ) {
    super(
      `Order subtotal ${subtotalPaise} paise is below the minimum ${minOrderValuePaise} paise`,
    );
    this.name = 'PricingBelowMinimumError';
  }
}
