import { describe, expect, it } from 'vitest';
import {
  assertPaymentTransition,
  canTransitionPayment,
  isPaymentConfirmed,
  isPaymentActive,
  IllegalPaymentTransitionError,
  type PaymentStatus,
} from '@/lib/payments/payment-state-machine';

/**
 * Feature 4 — Phase 12: Payment state machine tests.
 *
 * The Payment.status lifecycle for the direct-UPI + counter-cash flow.
 * Every illegal transition must throw; every legal transition must return
 * the target. Idempotent same-status transitions (CONFIRMED → CONFIRMED)
 * are no-ops, NOT re-captures.
 */
describe('payment state machine', () => {
  describe('assertPaymentTransition — legal transitions', () => {
    it('PENDING → CONFIRMED (counter payment confirmed)', () => {
      expect(assertPaymentTransition('PENDING', 'CONFIRMED')).toBe('CONFIRMED');
    });
    it('PENDING → REJECTED (counter payment rejected)', () => {
      expect(assertPaymentTransition('PENDING', 'REJECTED')).toBe('REJECTED');
    });
    it('SUBMITTED → CONFIRMED (UTR verified)', () => {
      expect(assertPaymentTransition('SUBMITTED', 'CONFIRMED')).toBe('CONFIRMED');
    });
    it('SUBMITTED → REJECTED (UTR rejected)', () => {
      expect(assertPaymentTransition('SUBMITTED', 'REJECTED')).toBe('REJECTED');
    });
    it('CONFIRMED → REFUNDED_NOTE (full refund annotated)', () => {
      expect(assertPaymentTransition('CONFIRMED', 'REFUNDED_NOTE')).toBe('REFUNDED_NOTE');
    });
  });

  describe('assertPaymentTransition — illegal transitions throw', () => {
    it('CONFIRMED → SUBMITTED (cannot un-verify a confirmed payment)', () => {
      expect(() => assertPaymentTransition('CONFIRMED', 'SUBMITTED')).toThrow(IllegalPaymentTransitionError);
    });
    it('REJECTED → CONFIRMED (a rejected payment cannot become confirmed — a new Payment row is created on re-submit)', () => {
      expect(() => assertPaymentTransition('REJECTED', 'CONFIRMED')).toThrow(IllegalPaymentTransitionError);
    });
    it('REJECTED → PENDING (rejected is terminal for this row)', () => {
      expect(() => assertPaymentTransition('REJECTED', 'PENDING')).toThrow(IllegalPaymentTransitionError);
    });
    it('REFUNDED_NOTE → CONFIRMED (a refunded payment cannot be re-confirmed)', () => {
      expect(() => assertPaymentTransition('REFUNDED_NOTE', 'CONFIRMED')).toThrow(IllegalPaymentTransitionError);
    });
    it('REFUNDED_NOTE → SUBMITTED (refunded is terminal)', () => {
      expect(() => assertPaymentTransition('REFUNDED_NOTE', 'SUBMITTED')).toThrow(IllegalPaymentTransitionError);
    });
    it('PENDING → REFUNDED_NOTE (cannot refund a payment that was never confirmed)', () => {
      expect(() => assertPaymentTransition('PENDING', 'REFUNDED_NOTE')).toThrow(IllegalPaymentTransitionError);
    });
    it('SUBMITTED → REFUNDED_NOTE (cannot refund an unverified payment)', () => {
      expect(() => assertPaymentTransition('SUBMITTED', 'REFUNDED_NOTE')).toThrow(IllegalPaymentTransitionError);
    });
  });

  describe('idempotent same-status transitions are no-ops', () => {
    it('CONFIRMED → CONFIRMED returns CONFIRMED (not a re-capture)', () => {
      expect(assertPaymentTransition('CONFIRMED', 'CONFIRMED')).toBe('CONFIRMED');
    });
    it('REJECTED → REJECTED returns REJECTED', () => {
      expect(assertPaymentTransition('REJECTED', 'REJECTED')).toBe('REJECTED');
    });
    it('PENDING → PENDING returns PENDING', () => {
      expect(assertPaymentTransition('PENDING', 'PENDING')).toBe('PENDING');
    });
  });

  describe('canTransitionPayment', () => {
    it('returns true for legal transitions', () => {
      expect(canTransitionPayment('PENDING', 'CONFIRMED')).toBe(true);
      expect(canTransitionPayment('SUBMITTED', 'REJECTED')).toBe(true);
    });
    it('returns false for illegal transitions', () => {
      expect(canTransitionPayment('REJECTED', 'CONFIRMED')).toBe(false);
      expect(canTransitionPayment('REFUNDED_NOTE', 'CONFIRMED')).toBe(false);
    });
  });

  describe('helpers', () => {
    it('isPaymentConfirmed is true only for CONFIRMED', () => {
      expect(isPaymentConfirmed('CONFIRMED')).toBe(true);
      expect(isPaymentConfirmed('SUBMITTED')).toBe(false);
      expect(isPaymentConfirmed('PENDING')).toBe(false);
    });
    it('isPaymentActive is true for PENDING and SUBMITTED', () => {
      expect(isPaymentActive('PENDING')).toBe(true);
      expect(isPaymentActive('SUBMITTED')).toBe(true);
      expect(isPaymentActive('CONFIRMED')).toBe(false);
      expect(isPaymentActive('REJECTED')).toBe(false);
    });
  });

  describe('IllegalPaymentTransitionError message', () => {
    it('includes from and to in the message', () => {
      try {
        assertPaymentTransition('CONFIRMED' as PaymentStatus, 'PENDING' as PaymentStatus);
      } catch (e) {
        expect(e).toBeInstanceOf(IllegalPaymentTransitionError);
        expect((e as Error).message).toContain('CONFIRMED');
        expect((e as Error).message).toContain('PENDING');
      }
    });
  });
});
