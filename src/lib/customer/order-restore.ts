/**
 * order-restore — durable "pending order" record for the UPI return path.
 *
 * ROOT CAUSE (UPI-return bug): after the customer places an order, the
 * payment screen's state lived ONLY in React state + `sessionStorage`
 * (`printshop:placed-order`, see CustomerOrderFlowV2 `PLACED_SESSION_KEY`).
 * Tapping "Pay by UPI" does a full navigation away (`window.location.href
 * = upiUri`, an `upi://` intent) to a heavy external app (GPay / PhonePe).
 * On low-memory Android phones the OS routinely kills the background
 * browser tab while the UPI app is in front — and `sessionStorage` dies
 * with the tab. Worse, relaunching the installed PWA from the launcher
 * always opens `start_url: '/'` (src/app/manifest.ts), so the user lands
 * on the homepage with no trace of the order they were paying for.
 * `localStorage` recent-orders (`printshop:recent-orders`) DID survive,
 * but nothing on the payment flow ever read it back to restore the
 * payment screen — the homepage only showed it as a small "recent order"
 * link.
 *
 * FIX: at placement time the flow ALSO writes a durable `localStorage`
 * record (this module). It survives tab/process death and PWA relaunch.
 * On mount the order flow restores the payment screen from it (falling
 * back from `sessionStorage`), a `visibilitychange` handler reopens the
 * UTR sheet when the customer comes back from the UPI app, and the
 * homepage shows a "Continue paying" resume card when a pending order
 * exists. The record is cleared once the customer submits a UTR or
 * switches to counter payment (both navigate to `/o/[token]`), and it
 * expires after 24h (shop retention default) so a stale order can never
 * resurrect the payment screen days later.
 *
 * No PII beyond what the flow already stores: token (the tracking
 * credential, already on the device), order number, pickup code, total,
 * shop slug/name. No customer name/phone/files.
 */

/** localStorage key for the in-progress (unpaid) order. */
export const PENDING_ORDER_KEY = 'printshop:pending-order';
/** localStorage key marking that a UPI app launch is in flight. */
export const UPI_LAUNCHED_KEY = 'printshop:upi-launched-at';
/** A pending order older than this is stale and never restored. */
export const PENDING_ORDER_TTL_MS = 24 * 60 * 60 * 1000; // 24h — shop retention default

/** Minimal record needed to rebuild the payment screen after a return. */
export interface PendingOrder {
  /** Order tracking token (path credential for /o/[token]). */
  token: string;
  /** Short order number, e.g. "ORD-1042". */
  orderNumber: string;
  /** Pickup code, e.g. "A-7". */
  pickupCode: string;
  /** Order total in paise. */
  totalPaise: number;
  /** Shop slug — the payment screen lives at /s/[shopSlug]. */
  shopSlug: string;
  /** Shop display name — for the homepage resume card. */
  shopName: string;
  /** Epoch ms when the order was placed (drives expiry + pay timer). */
  placedAt: number;
}

function isPendingOrder(v: unknown): v is PendingOrder {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.token === 'string' && o.token.length > 0 &&
    typeof o.orderNumber === 'string' &&
    typeof o.pickupCode === 'string' &&
    typeof o.totalPaise === 'number' && Number.isFinite(o.totalPaise) &&
    typeof o.shopSlug === 'string' && o.shopSlug.length > 0 &&
    typeof o.shopName === 'string' &&
    typeof o.placedAt === 'number' && Number.isFinite(o.placedAt)
  );
}

/** Persist the in-progress order durably (survives tab/process death). */
export function savePendingOrder(order: PendingOrder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));
  } catch {
    // localStorage unavailable (private mode / quota) — the in-memory +
    // sessionStorage path still works for a same-tab return.
  }
}

/**
 * Read the pending order, or null when there is none / it is malformed /
 * stale / for a different shop. A stale or malformed record is deleted so
 * it can never resurrect later. A record for a *different* shop is left
 * in place (that shop's page, or the homepage resume card, may need it).
 * `now` is injectable for tests; defaults to Date.now().
 */
export function readPendingOrder(shopSlug?: string, now: number = Date.now()): PendingOrder | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      window.localStorage.removeItem(PENDING_ORDER_KEY);
      return null;
    }
    if (!isPendingOrder(parsed)) {
      window.localStorage.removeItem(PENDING_ORDER_KEY);
      return null;
    }
    if (now - parsed.placedAt > PENDING_ORDER_TTL_MS) {
      window.localStorage.removeItem(PENDING_ORDER_KEY);
      return null;
    }
    if (shopSlug && parsed.shopSlug !== shopSlug) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Drop the pending-order record (payment submitted / counter chosen). */
export function clearPendingOrder(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // ignore
  }
}

/**
 * Mark that the customer just launched a UPI app. The order flow's
 * `visibilitychange` handler consumes this on return to reopen the UTR
 * sheet — the blind `setTimeout(1500)` in the launch handler fires while
 * the tab is hidden (timers are throttled/killed there) and cannot be
 * relied on.
 */
export function markUpiLaunched(now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UPI_LAUNCHED_KEY, String(now));
  } catch {
    // ignore — return-restore still works via the pending order itself.
  }
}

/**
 * True when a UPI launch was marked recently (within the pending-order
 * TTL). Consumes the flag: a second return must not reopen the sheet.
 */
export function consumeUpiReturnFlag(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(UPI_LAUNCHED_KEY);
    window.localStorage.removeItem(UPI_LAUNCHED_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at <= PENDING_ORDER_TTL_MS;
  } catch {
    return false;
  }
}
