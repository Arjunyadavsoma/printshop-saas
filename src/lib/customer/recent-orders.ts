/**
 * recent-orders — the customer's recent-order list stored on their device.
 *
 * The order tracking link (`/o/[token]`) is the credential: anyone with the
 * token can track the order, and only the customer who placed it has the
 * token (it's 128-bit unguessable). The "My orders" page on `/orders` lists
 * orders placed on THIS device — we save a tiny summary to localStorage at
 * order-placement time, and `/orders` reads it back.
 *
 * The summary stores the token (the credential itself, which is already on
 * the device) + shop name + order number + total + status snapshot. We DO
 * NOT store the customer's name, phone, or files — those stay on the server
 * and are looked up live by token.
 *
 * The list is capped at 20 entries; the most recent is prepended and the
 * oldest is dropped. Duplicates (same token) are de-duplicated to the most
 * recent entry.
 */

const STORAGE_KEY = 'printshop:recent-orders';
const MAX_ENTRIES = 20;

/** A single entry in the device-local recent orders list. */
export interface RecentOrderSummary {
  /** The order token (path credential for /o/[token]). */
  token: string;
  /** The shop's slug — for the "Print again" reorder link back to /s/[slug]. */
  shopSlug: string | null;
  /** The shop's display name. */
  shopName: string;
  /** The shop's internal order number, e.g. "ORD-1042". */
  orderNumber: string | null;
  /** The pickup code, e.g. "A-7". */
  pickupCode: string | null;
  /** Order total in paise. */
  totalPaise: number;
  /** The order status at the time of placement / last poll. */
  status: string;
  /** ISO timestamp of when the order was placed. */
  placedAt: string;
}

/**
 * Read the device-local recent orders list. Returns an empty array when
 * storage is unavailable (SSR / privacy mode) or the JSON is malformed.
 */
export function readRecentOrders(): RecentOrderSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust the shape minimally — drop obviously malformed entries.
    return parsed.filter((e): e is RecentOrderSummary =>
      e && typeof e === 'object' &&
      typeof e.token === 'string' && typeof e.shopName === 'string');
  } catch {
    return [];
  }
}

/**
 * Prepend or update an entry in the device-local list. If an entry with the
 * same token already exists, it is moved to the front and its fields are
 * refreshed (so a re-mount of the tracking page after polling can update the
 * stored status snapshot without duplicating rows).
 *
 * Merging: a `null` `shopSlug` on the new entry does NOT overwrite a
 * previously-saved slug. The order-placement flow (CustomerOrderFlow.place)
 * is the only writer that knows the slug; the tracking-page poll writer
 * passes `null` and the merge preserves the slug set at placement time.
 */
export function saveRecentOrder(entry: RecentOrderSummary): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readRecentOrders();
    const existing = current.find(e => e.token === entry.token);
    // Merge: preserve a previously-saved shopSlug when the new entry has none.
    const merged: RecentOrderSummary = existing && entry.shopSlug === null
      ? { ...entry, shopSlug: existing.shopSlug }
      : entry;
    const without = current.filter(e => e.token !== entry.token);
    const next = [merged, ...without].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage quota exceeded / privacy mode — silently drop; the
    // tracking page still works without the device-local list.
  }
}

/** Remove every entry whose token no longer resolves (call from /orders). */
export function forgetOrder(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = readRecentOrders().filter(e => e.token !== token);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
