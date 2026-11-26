'use client';

import dynamic from 'next/dynamic';
import { SkeletonBox } from '@/components/clear/skeleton';
import type { ShopCapabilities } from '@/components/studio/types';

/**
 * SmartPrintStudioLazy — client-only dynamic import of the Smart Print
 * Studio (the 5-step premium upload → settings → review → payment →
 * confirmation flow). SSR is disabled because the studio reads localStorage
 * draft state on mount (restoring an in-progress order) and uses browser
 * APIs (crypto.subtle for chunk checksums, drag-and-drop).
 *
 * Matches the CustomerOrderFlowV2Lazy pattern so the shop landing page can
 * swap between them without changing its mount logic.
 *
 * Plumb note (Feature 4 / P128): the studio's `ShopCapabilities` should be
 * built from the shop's REAL DB fields. The RSC page (`/s/[shopSlug]/page.tsx`)
 * already loads `paymentMethods`, `pricingConfig`, the active price rules
 * (which expose `paperSizes`), and the addon catalog. ShopOrderPage doesn't
 * thread every one of those through today, so we accept them as OPTIONAL
 * props here — when present we use the real value; when absent we fall back
 * to a safe default (rather than fabricating data). This keeps the existing
 * prop interface backwards-compatible and lets the landing page progressively
 * enrich the studio without breaking older callers.
 */
const SmartPrintStudioInner = dynamic(
  () => import('@/components/studio/SmartPrintStudio').then((m) => m.SmartPrintStudio),
  {
    ssr: false,
    loading: () => <SkeletonBox className="min-h-[400px]" />,
  },
);

/** Allowed values for `shop.paymentMethods` (matches Prisma enum). */
type PaymentMethods = ShopCapabilities['paymentMethods'];

/** The shop's pricingConfig JSON object, parsed from its stored string. */
interface PricingConfigJson {
  bw_a4_per_page?: number;
  color_a4_per_page?: number;
  bw_a4_double_per_page?: number;
  min_order_value?: number;
}

export interface SmartPrintStudioLazyProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  colorPerPagePaise: number | null;
  bwPerPagePaise: number | null;
  doubleBwPrice: string | null;
  paymentMode: string;
  closed: boolean;
  /** Real shop.paymentMethods value ('upi' | 'cash' | 'both' | 'split'). Falls back to 'both'. */
  paymentMethods?: PaymentMethods;
  /** The shop's parsed pricingConfig JSON. Used for min_order_value + per-page rates. */
  pricingConfig?: PricingConfigJson | null;
  /** Paper sizes the shop actually supports (from its price rules). Defaults to ['A4']. */
  paperSizes?: string[];
  /** The shop's addon catalog. Empty array when the shop has no addons. */
  addons?: ShopCapabilities['addons'];
}

/** Safely parse `pricingConfig` if it arrives as a string. */
function coercePricingConfig(raw: PricingConfigJson | string | null | undefined): PricingConfigJson | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as PricingConfigJson; } catch { return null; }
  }
  return raw;
}

/** Coerce `paymentMethods` to the studio's union, falling back to 'both'. */
function coercePaymentMethods(raw: PaymentMethods | string | null | undefined): PaymentMethods {
  if (raw === 'upi' || raw === 'cash' || raw === 'both' || raw === 'split') return raw;
  return 'both';
}

export function SmartPrintStudioLazy(props: SmartPrintStudioLazyProps) {
  // ── Derive ShopCapabilities from the (real, optional) shop data ────────
  const supportsColor = props.colorPerPagePaise != null && props.colorPerPagePaise > 0;
  const supportsDuplex = props.doubleBwPrice != null;

  // `paymentMethods` — real field, plumbed through if the landing page
  // passes it. Otherwise default to 'both' (the Prisma column default).
  const paymentMethods = coercePaymentMethods(props.paymentMethods);

  // `paperSizes` — from the shop's active price rules when available,
  // else ['A4']. Never fabricated.
  const paperSizes = props.paperSizes && props.paperSizes.length > 0 ? props.paperSizes : ['A4'];

  // `addons` — only the shop's real catalog. Never fabricated.
  const addons = props.addons ?? [];

  // `pricingSummary` — built from the parsed pricingConfig when available,
  // else from the per-page paise values the landing page already derived.
  const pricingConfig = coercePricingConfig(props.pricingConfig);
  const bwA4PerPage = props.bwPerPagePaise ?? pricingConfig?.bw_a4_per_page ?? 200;
  const colorA4PerPage = props.colorPerPagePaise ?? pricingConfig?.color_a4_per_page ?? 500;
  const minOrderValue = pricingConfig?.min_order_value ?? 500;

  return (
    <SmartPrintStudioInner
      shop={{
        slug: props.shopSlug,
        name: props.shopName,
        supportsColor,
        supportsDuplex,
        paperSizes,
        addons,
        upiId: props.upiId,
        paymentMethods,
        isOpen: !props.closed,
        acceptingOrders: !props.closed,
        pricingSummary: {
          bwA4PerPage,
          colorA4PerPage,
          minOrderValue,
        },
      }}
      shopName={props.shopName}
    />
  );
}
