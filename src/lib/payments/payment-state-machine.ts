/**
 * Payment state machine (Feature 4 — Checkout & Payments).
 *
 * Models the `Payment.status` lifecycle for the direct-UPI + counter-cash
 * flow (the `Payment` Prisma model). The gateway flow (`PaymentAttempt`) is
 * already governed by `applyPaymentTransition()` in lifecycle.service.ts;
 * this file brings the same rigor to the manual-verification path.
 *
 * Statuses (plain strings — the schema has zero enums by convention):
 *   PENDING      — counter payment chosen, awaiting shopkeeper confirmation.
 *   SUBMITTED    — customer submitted a UTR (UPI), awaiting shopkeeper verify.
 *   CONFIRMED    — shopkeeper verified the payment (order flips to `paid`).
 *   REJECTED     — shopkeeper rejected the UTR (order back to awaiting_payment).
 *   REFUNDED_NOTE— shopkeeper annotated a refund was issued out-of-band.
 *
 * Legal transitions:
 *   PENDING    → CONFIRMED | REJECTED
 *   SUBMITTED  → CONFIRMED | REJECTED
 *   CONFIRMED  → REFUNDED_NOTE            (a confirmed payment can be annotated as refunded)
 *   REJECTED   → (terminal for this row; a new Payment row is created on re-submit)
 *   REFUNDED_NOTE → (terminal)
 *
 * NOT allowed (enforced):
 *   - FAILED → SUCCESS without verification (there is no FAILED state in this
 *     model — rejection is the failure path, and it cannot become CONFIRMED).
 *   - REFUNDED → SUCCESS (a refunded payment cannot be re-confirmed).
 *   - Duplicate successful confirmations (CONFIRMED → CONFIRMED is a no-op,
 *     not a re-capture).
 *   - A pending/submitted payment treated as successful (CONFIRMED is the only
 *     success state, and it requires an explicit shopkeeper action).
 */

export type PaymentStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'REFUNDED_NOTE';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'REFUNDED_NOTE',
];

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['CONFIRMED', 'REJECTED'],
  SUBMITTED: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['REFUNDED_NOTE'],
  REJECTED: [],
  REFUNDED_NOTE: [],
};

export class IllegalPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Illegal payment transition: ${from} → ${to}`);
    this.name = 'IllegalPaymentTransitionError';
  }
}

/** Throws on an illegal transition; returns the target on success. */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): PaymentStatus {
  if (from === to) return from; // idempotent no-op (e.g. re-confirm an already-confirmed payment)
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) {
    throw new IllegalPaymentTransitionError(from, to);
  }
  return to;
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Is this status a "success" state (the customer's money is confirmed)? */
export function isPaymentConfirmed(status: string): boolean {
  return status === 'CONFIRMED';
}

/** Is this status an "active" state (awaiting shopkeeper action)? */
export function isPaymentActive(status: string): boolean {
  return status === 'PENDING' || status === 'SUBMITTED';
}
