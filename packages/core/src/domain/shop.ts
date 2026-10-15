import { z } from 'zod';
import {
  PAYMENT_PROVIDERS,
  SUBSCRIPTION_TIERS,
  type PaymentProvider,
  type SubscriptionTier,
} from './enums';

/**
 * Per-shop pricing configuration. All monetary values are in **integer paise**
 * (1 INR = 100 paise). We never use floating-point money.
 *
 * The config is keyed by `${colorMode}_${paperSize}_per_page` so the pricing
 * engine can index dynamically for any (color, paper) combination. Letter and
 * legal keys are included for forward-compatibility even if a shop only sets
 * A4/A3 rates (the engine will fall back — see pricing-engine.ts).
 */
export interface ShopPricingConfig {
  bw_a4_per_page: number;
  color_a4_per_page: number;
  bw_a3_per_page: number;
  color_a3_per_page: number;
  bw_letter_per_page: number;
  color_letter_per_page: number;
  bw_legal_per_page: number;
  color_legal_per_page: number;
  /** Percentage (0-100) saved when duplex (both sides) printing is used. */
  duplex_discount: number;
  /** Total-pages threshold above which the bulk discount kicks in. */
  bulk_threshold: number;
  /** Percentage (0-100) bulk discount applied once threshold is met. */
  bulk_discount_pct: number;
  /** Minimum chargeable order value in paise. */
  min_order_value: number;
}

/** Zod mirror of {@link ShopPricingConfig} for runtime validation. */
export const ShopPricingConfigSchema = z.object({
  bw_a4_per_page: z.number().int().nonnegative(),
  color_a4_per_page: z.number().int().nonnegative(),
  bw_a3_per_page: z.number().int().nonnegative(),
  color_a3_per_page: z.number().int().nonnegative(),
  bw_letter_per_page: z.number().int().nonnegative(),
  color_letter_per_page: z.number().int().nonnegative(),
  bw_legal_per_page: z.number().int().nonnegative(),
  color_legal_per_page: z.number().int().nonnegative(),
  duplex_discount: z.number().min(0).max(100),
  bulk_threshold: z.number().int().nonnegative(),
  bulk_discount_pct: z.number().min(0).max(100),
  min_order_value: z.number().int().nonnegative(),
});

/** Sensible Indian-market defaults: ₹2/BW-A4, ₹6/colour-A4. */
export function createDefaultPricingConfig(): ShopPricingConfig {
  return {
    bw_a4_per_page: 200,
    color_a4_per_page: 600,
    bw_a3_per_page: 400,
    color_a3_per_page: 1200,
    bw_letter_per_page: 200,
    color_letter_per_page: 600,
    bw_legal_per_page: 250,
    color_legal_per_page: 700,
    duplex_discount: 10,
    bulk_threshold: 100,
    bulk_discount_pct: 5,
    min_order_value: 500,
  };
}

/**
 * Shop aggregate root.
 * `paymentCredentials` is opaque at this layer (encrypted JSONB at rest);
 * the encryption boundary lives in the repository / adapter layer.
 */
export interface Shop {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  upiId: string;
  paymentProvider: PaymentProvider;
  paymentCredentials: Record<string, unknown>;
  pricingConfig: ShopPricingConfig;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ShopSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  ownerUserId: z.string().uuid(),
  upiId: z.string().regex(/^[\w.\-]+@[\w.\-]+$/),
  paymentProvider: z.enum(PAYMENT_PROVIDERS as [PaymentProvider, ...PaymentProvider[]]),
  paymentCredentials: z.record(z.string(), z.unknown()),
  pricingConfig: ShopPricingConfigSchema,
  address: z.string().max(300),
  phone: z.string().max(20),
  timezone: z.string().max(60),
  isActive: z.boolean(),
  subscriptionTier: z.enum(SUBSCRIPTION_TIERS as [SubscriptionTier, ...SubscriptionTier[]]),
  subscriptionExpiresAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Safe-to-expose public projection of a shop (no credentials). */
export interface PublicShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  paymentProvider: PaymentProvider;
  pricingConfig: ShopPricingConfig;
  timezone: string;
  isActive: boolean;
}
