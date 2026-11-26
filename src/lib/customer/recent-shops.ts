/**
 * Recently viewed shops — customer-side tracking.
 *
 * A net-new, REAL-data feature: records shops the customer actually
 * visited (mount of /s/[slug]), stored in localStorage with a 30-day TTL.
 * Powers the "Recently viewed" discovery section on /find-a-shop.
 *
 * No fabrication: a shop only appears here if the customer opened its page.
 */

export interface RecentShop {
  slug: string;
  name: string;
  image?: string | null;
  visitedAt: number;
}

const KEY = 'printelyx:recent-shops';
const MAX_ENTRIES = 10;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function readRecentShops(): RecentShop[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentShop[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((s) => s && typeof s.slug === 'string' && now - s.visitedAt < TTL_MS)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function trackShopVisit(shop: { slug: string; name: string; image?: string | null }): void {
  try {
    const list = readRecentShops().filter((s) => s.slug !== shop.slug);
    list.unshift({ slug: shop.slug, name: shop.name, image: shop.image ?? null, visitedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal.
  }
}

export function clearRecentShops(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
