import type { ColorMode, PaperSize } from '../domain';
import type { ShopPricingConfig } from '../domain';

/** Input handed to the pricing engine — one file's worth of work. */
export interface PricingInput {
  pages: number;
  copies: number;
  colorMode: ColorMode;
  paperSize: PaperSize;
  duplex: boolean;
  shopPricingConfig: ShopPricingConfig;
}

/** One priced line on the bill. */
export interface LineItem {
  label: string;
  quantity: number;
  unitPaise: number;
  subtotalPaise: number;
}

/** Output of the pricing engine. All values integer paise. */
export interface PricingResult {
  totalPaise: number;
  lineItems: LineItem[];
}

/** Internal: a bag of the raw numbers before rounding/min-order enforcement. */
interface PricingBreakdown {
  baseRatePaise: number;
  totalPages: number;
  grossPaise: number;
  duplexSavingPaise: number;
  bulkSavingPaise: number;
  minOrderAdjPaise: number;
}

/** Behaviour flags — kept out of ShopPricingConfig so shopkeepers can't fiddle. */
export interface PricingBehaviour {
  /** When subtotal < min_order_value: round up to min (default) or reject. */
  onBelowMin: 'round_up' | 'reject';
}
