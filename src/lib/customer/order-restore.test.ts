// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePendingOrder,
  readPendingOrder,
  clearPendingOrder,
  markUpiLaunched,
  consumeUpiReturnFlag,
  PENDING_ORDER_KEY,
  UPI_LAUNCHED_KEY,
  PENDING_ORDER_TTL_MS,
  type PendingOrder,
} from './order-restore';

/**
 * order-restore tests — the durable pending-order record behind the
 * UPI-return fix (see order-restore.ts for the root cause).
 *
 * Covers:
 *   - save / restore round-trip (all fields survive)
 *   - clear removes the record
 *   - stale orders (older than the 24h TTL) are NOT restored, and the
 *     stale record is deleted so it can never resurrect later
 *   - malformed JSON / wrong shape is NOT restored, and is deleted
 *   - a pending order for a different shop is NOT returned for this shop
 *     (but is left stored — the homepage resume card may still need it)
 *   - UPI-launch flag: consumed once, expires with the TTL
 */

const ORDER: PendingOrder = {
  token: 'tok_abc123',
  orderNumber: 'ORD-1042',
  pickupCode: 'A-7',
  totalPaise: 4500,
  shopSlug: 'quickprint-hyd',
  shopName: 'QuickPrint Hyderabad',
  placedAt: 1_800_000_000_000,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('savePendingOrder / readPendingOrder', () => {
  it('round-trips the full record', () => {
    savePendingOrder(ORDER);
    expect(readPendingOrder(undefined, ORDER.placedAt + 1000)).toEqual(ORDER);
  });

  it('returns null when nothing was saved', () => {
    expect(readPendingOrder()).toBeNull();
  });

  it('clear removes the record', () => {
    savePendingOrder(ORDER);
    clearPendingOrder();
    expect(readPendingOrder()).toBeNull();
    expect(window.localStorage.getItem(PENDING_ORDER_KEY)).toBeNull();
  });

  it('overwrites a previous pending order (one in-progress order at a time)', () => {
    savePendingOrder(ORDER);
    savePendingOrder({ ...ORDER, orderNumber: 'ORD-1043', token: 'tok_def456' });
    expect(readPendingOrder()?.orderNumber).toBe('ORD-1043');
  });

  it('returns the order when the shop matches', () => {
    savePendingOrder(ORDER);
    expect(readPendingOrder('quickprint-hyd', ORDER.placedAt + 1000)?.token).toBe('tok_abc123');
  });

  it('does NOT return an order for a different shop — and leaves it stored', () => {
    savePendingOrder(ORDER);
    expect(readPendingOrder('other-shop', ORDER.placedAt + 1000)).toBeNull();
    expect(window.localStorage.getItem(PENDING_ORDER_KEY)).not.toBeNull();
    // …so the homepage resume card can still surface it.
    expect(readPendingOrder(undefined, ORDER.placedAt + 1000)?.shopSlug).toBe('quickprint-hyd');
  });
});

describe('stale-order expiry', () => {
  it('does NOT restore an order older than the TTL, and deletes the stale record', () => {
    savePendingOrder(ORDER);
    const now = ORDER.placedAt + PENDING_ORDER_TTL_MS + 1000;
    expect(readPendingOrder(undefined, now)).toBeNull();
    expect(window.localStorage.getItem(PENDING_ORDER_KEY)).toBeNull();
  });

  it('restores an order just inside the TTL', () => {
    savePendingOrder(ORDER);
    expect(readPendingOrder(undefined, ORDER.placedAt + PENDING_ORDER_TTL_MS - 1000)).toEqual(ORDER);
  });
});

describe('malformed records', () => {
  it('does NOT restore malformed JSON, and deletes it', () => {
    window.localStorage.setItem(PENDING_ORDER_KEY, '{not json');
    expect(readPendingOrder()).toBeNull();
    expect(window.localStorage.getItem(PENDING_ORDER_KEY)).toBeNull();
  });

  it('does NOT restore a wrong-shaped record, and deletes it', () => {
    window.localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ token: 'x' }));
    expect(readPendingOrder()).toBeNull();
    expect(window.localStorage.getItem(PENDING_ORDER_KEY)).toBeNull();
  });

  it('does NOT restore a record with a non-numeric total', () => {
    window.localStorage.setItem(
      PENDING_ORDER_KEY,
      JSON.stringify({ ...ORDER, totalPaise: '4500' }),
    );
    expect(readPendingOrder()).toBeNull();
  });
});

describe('UPI launch flag', () => {
  it('consume returns true once, then false (single-shot)', () => {
    markUpiLaunched(ORDER.placedAt);
    expect(consumeUpiReturnFlag(ORDER.placedAt + 1000)).toBe(true);
    expect(consumeUpiReturnFlag(ORDER.placedAt + 2000)).toBe(false);
  });

  it('consume returns false when no launch was marked', () => {
    expect(consumeUpiReturnFlag()).toBe(false);
  });

  it('an expired launch flag does NOT count as a return', () => {
    markUpiLaunched(ORDER.placedAt);
    expect(consumeUpiReturnFlag(ORDER.placedAt + PENDING_ORDER_TTL_MS + 1000)).toBe(false);
    expect(window.localStorage.getItem(UPI_LAUNCHED_KEY)).toBeNull();
  });
});
