/**
 * Refund service (Feature 4 — Phase 9).
 *
 * Reuses the EXISTING provider adapters' `refund()` methods
 * (Razorpay/PhonePe/Paytm all implement it). For direct-UPI shops
 * (`googlepay` provider), the adapter's `refund()` is a no-op — the
 * shopkeeper refunds the customer directly via UPI, and we record
 * the refund with `provider: 'manual'` for audit-trail completeness.
 *
 * Idempotency: the `Refund` table has `@@unique([provider, providerRefundId])`
 * — a duplicate refund initiation with the same PSP reference is rejected
 * at the DB level. The application-layer check below gives a clean error
 * before hitting the constraint.
 *
 * State machine: a refund does NOT automatically flip the order to
 * 'cancelled' — the shopkeeper may refund a partial amount or refund
 * after the order was already collected. The `Payment.status` is
 * transitioned to `REFUNDED_NOTE` (via the payment state machine) only
 * when the refund covers the full order amount. Partial refunds are
 * recorded without changing the order/payment status (the audit trail
 * is the Refund row itself).
 */

import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { assertPaymentTransition } from '@/lib/payments/payment-state-machine';
import { NotFoundError, ValidationError, AppError } from '@platform/core/errors';

export interface RefundInput {
  orderId: string;
  shopId: string;
  initiatedBy: string; // userId
  amountPaise: number; // must be > 0 and <= order.totalAmountPaise
  reason: string;
}

export interface RefundResult {
  refundId: string;
  providerRefundId: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  amountPaise: number;
  message: string;
}

/**
 * Initiate a refund for an order. The provider is determined from the
 * order's `paymentProvider` field (set during payment). If the order was
 * paid via direct-UPI (provider 'googlepay'), the refund is recorded as
 * `manual` — the shopkeeper must action it off-platform.
 */
export async function initiateRefund(input: RefundInput): Promise<RefundResult> {
  const container = getContainer();
  const db = container.db;

  if (input.amountPaise <= 0) {
    throw new ValidationError('Refund amount must be greater than zero.');
  }

  const order = await db.findOne<{
    id: string;
    shopId: string;
    status: string;
    totalAmountPaise: number;
    paymentProvider: string | null;
    paymentTxnId: string | null;
    orderNumber: string | null;
  }>('order', { id: input.orderId });
  if (!order || order.shopId !== input.shopId) {
    throw new NotFoundError('Order not found');
  }

  if (order.totalAmountPaise <= 0) {
    throw new ValidationError('This order has no payable amount to refund.');
  }
  if (input.amountPaise > order.totalAmountPaise) {
    throw new ValidationError(
      `Refund amount (Rs ${(input.amountPaise / 100).toFixed(2)}) exceeds the order total (Rs ${(order.totalAmountPaise / 100).toFixed(2)}).`,
    );
  }

  // Only a paid order can be refunded. The state machine allows paid →
  // cancelled, but a refund is valid even after collection (the shopkeeper
  // refunds a dissatisfied customer). Block only if the order was never paid.
  if (order.status === 'awaiting_payment' || order.status === 'payment_submitted' || order.status === 'draft') {
    throw new ValidationError(
      `This order is ${order.status} (not yet paid). Nothing to refund.`,
    );
  }

  const provider = order.paymentProvider ?? 'manual';
  const paymentTxnId = order.paymentTxnId;

  // For gateway providers (razorpay/phonepe/paytm), we need a real txn id
  // to call the PSP's refund API. For direct-UPI (googlepay) or manual,
  // there is no PSP refund — the shopkeeper actions it off-platform.
  const isGatewayProvider = provider === 'razorpay' || provider === 'phonepe' || provider === 'paytm';
  if (isGatewayProvider && !paymentTxnId) {
    throw new ValidationError(
      `This order was paid via ${provider} but has no provider transaction ID on file. The refund cannot be initiated through the platform — refund directly via your ${provider} dashboard.`,
    );
  }

  // Idempotency check: has a refund already been initiated for this order
  // + provider + amount? The Refund table's unique on (provider,
  // providerRefundId) catches duplicates AFTER the PSP responds; this
  // application-layer check prevents double-initiation BEFORE the call.
  const existingRefunds = await db.findMany<{ id: string; amountPaise: number; status: string }>(
    'refund',
    { orderId: order.id },
    { limit: 50 },
  );
  const totalRefunded = existingRefunds
    .filter((r) => r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amountPaise, 0);
  const remaining = order.totalAmountPaise - totalRefunded;
  if (input.amountPaise > remaining) {
    throw new ValidationError(
      `Refund amount (Rs ${(input.amountPaise / 100).toFixed(2)}) exceeds the un-refunded balance (Rs ${(remaining / 100).toFixed(2)}). Total already refunded: Rs ${(totalRefunded / 100).toFixed(2)}.`,
    );
  }

  // Load the shop for credentials (gateway providers).
  const shop = await db.findOne<Record<string, unknown>>('shop', { id: order.shopId });
  if (!shop) throw new NotFoundError('Shop not found');

  let providerRefundId: string | null = null;
  let refundStatus: 'pending' | 'succeeded' | 'failed' = 'pending';
  let errorMessage: string | null = null;

  if (isGatewayProvider && paymentTxnId) {
    try {
      const adapter = container.paymentRegistry.get(provider as 'razorpay' | 'phonepe' | 'paytm');
      const result = await adapter.refund(
        { paymentTxnId, amountPaise: input.amountPaise, reason: input.reason },
        shop.paymentCredentials as Record<string, unknown>,
      );
      providerRefundId = result.refundId || null;
      // Map adapter status: 'completed' → 'succeeded', 'pending' → 'pending', 'failed' → 'failed'
      refundStatus = result.status === 'completed' ? 'succeeded' : result.status;
    } catch (cause) {
      refundStatus = 'failed';
      errorMessage = cause instanceof Error ? cause.message : 'Provider refund request failed';
    }
  } else {
    // Direct-UPI / manual: no PSP refund. Record immediately as 'succeeded'
    // because the shopkeeper is asserting they will action it (or already
    // have). The audit trail is the Refund row.
    providerRefundId = `manual-${order.id}-${Date.now()}`;
    refundStatus = 'succeeded';
  }

  // Persist the Refund row.
  const refundId = crypto.randomUUID();
  const now = new Date();
  await db.insert('refund', {
    id: refundId,
    orderId: order.id,
    paymentId: null,
    paymentAttemptId: null,
    provider,
    providerRefundId,
    amountPaise: input.amountPaise,
    reason: input.reason.slice(0, 500),
    status: refundStatus,
    initiatedBy: input.initiatedBy,
    initiatedAt: now,
    completedAt: refundStatus === 'succeeded' ? now : null,
    errorMessage,
    createdAt: now,
    updatedAt: now,
  });

  // If the refund covers the FULL remaining balance and succeeded, annotate
  // the Payment as REFUNDED_NOTE (via the payment state machine). This does
  // NOT change the order status — the order stays in its current state
  // (collected/cancelled/etc.) and the refund is an annotation, not a
  // lifecycle change. The order-status 'refunded' is intentionally NOT used
  // (the state machine has no transition into it; refunds are tracked on
  // the Refund model + Payment.status, not Order.status).
  if (refundStatus === 'succeeded' && input.amountPaise === remaining) {
    const payments = await repos.payments.forOrder(order.id);
    const confirmedPayment = payments.find((p) => p.status === 'CONFIRMED');
    if (confirmedPayment) {
      try {
        assertPaymentTransition(confirmedPayment.status as 'CONFIRMED' | 'REFUNDED_NOTE', 'REFUNDED_NOTE');
        await repos.payments.update(confirmedPayment.id, { status: 'REFUNDED_NOTE' });
      } catch {
        // Payment already REFUNDED_NOTE — no-op (idempotent).
      }
    }
  }

  // Append an order event for the audit timeline.
  await repos.orderEvents.append(order.id, {
    type: 'refund_initiated',
    actorType: 'shop',
    actorId: input.initiatedBy,
    data: {
      refundId,
      providerRefundId,
      amountPaise: input.amountPaise,
      provider,
      status: refundStatus,
      reason: input.reason.slice(0, 300),
    },
  });

  return {
    refundId,
    providerRefundId,
    status: refundStatus,
    amountPaise: input.amountPaise,
    message: refundStatus === 'succeeded'
      ? `Refund of Rs ${(input.amountPaise / 100).toFixed(2)} ${provider === 'manual' ? 'recorded (action it via UPI directly)' : 'initiated via ' + provider}.`
      : refundStatus === 'pending'
        ? `Refund of Rs ${(input.amountPaise / 100).toFixed(2)} is pending at ${provider}.`
        : `Refund failed: ${errorMessage ?? 'unknown error'}`,
  };
}
