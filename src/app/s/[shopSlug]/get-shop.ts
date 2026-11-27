import { cache } from 'react';
import { getContainer } from '@/lib/container';

/**
 * Shared, per-request cached shop lookup.
 *
 * React's `cache()` memoizes the result within a single server render
 * pass. Both `layout.tsx` (generateMetadata) and `page.tsx` (the server
 * component) call this for the same slug — WITHOUT this shared cache,
 * they'd issue two identical `SELECT * FROM shop WHERE slug = ?` queries
 * on every shop page load. With it, the second call is a cache hit
 * (zero DB round-trips). This is a standard Next.js App Router pattern
 * for deduplicating data fetches across metadata + page.
 *
 * Returns null on miss OR on DB error (so the caller can `notFound()`
 * rather than surfacing a 500 — the customer sees the themed "Shop not
 * found" page, which is accurate when the DB is unreachable too).
 */

export type ShopRow = {
  id: string; name: string; slug: string; address: string; phone: string;
  isOpen: boolean; acceptingOrders: boolean; openingHours: unknown;
  upiId: string; upiPayeeName: string | null; paymentMode: string;
  paymentMethods: string; minutesPerPageBw: number; minutesPerPageColor: number;
  retentionHours: number; pricingConfig: string | Record<string, number> | null;
  timezone: string | null; logoUrl: string | null; servicesJson: string | null;
  fullAddress: string | null; city: string | null; state: string | null;
  pincode: string | null; description: string | null;
};

export const getShopBySlug = cache(async (shopSlug: string): Promise<ShopRow | null> => {
  try {
    const db = getContainer().db;
    return await db.findOne<ShopRow>('shop', { slug: shopSlug });
  } catch (cause) {
    // DB unreachable / table missing / connection blip — log + treat as
    // "not found" so the customer gets the themed not-found page, not a
    // generic 500 error boundary.
    console.error('[shop-landing] shop lookup failed:', shopSlug, cause instanceof Error ? cause.message : String(cause));
    return null;
  }
});
