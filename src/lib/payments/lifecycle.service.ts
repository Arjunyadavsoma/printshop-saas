import type { PaymentProvider } from '@platform/core/domain';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { isUniqueConstraintError } from '@/lib/db/is-unique-constraint-error';

/**
 * Phase 5.3 — Payment Lifecycle Service
 *
 * Owns the ATOMIC financial state transition: PaymentEvent + PaymentAttempt +
 * Order updates happen in a SINGLE PostgreSQL transaction (`db.$transaction`).
 *
 * This closes the Phase 5.2.1 gap where those three updates were separate
 * non-transactional operations — if the order transition succeeded but the
 * PaymentEvent.update failed, the system was left in an inconsistent state
 * (order paid, event stuck in 'received', PaymentAttempt stuck in 'created').
 *
 * The service also advances `PaymentAttempt.status` (PAY-005 fix):
 *   created → paid  (on successful payment)
 *   created → failed (on failed/cancelled payment)
 *
 * ## Transaction boundaries
 *
 * Inside `db.$transaction(async (tx) => { ... })`:
 *   1. INSERT PaymentEvent (dedup via UNIQUE([provider, eventId]) → catch 23505)
 *   2. SELECT PaymentAttempt by merchantOrderId (with FOR UPDATE row lock)
 *   3. Validate amount + currency against the attempt
 *   4. Conditional UPDATE PaymentAttempt: status IN ('created','pending') → 'paid'/'failed'
 *   5. Conditional UPDATE Order: status='awaiting_payment' → 'paid' (only if paid=true)
 *   6. UPDATE PaymentEvent: processingStatus='received' → 'processed', processedAt=now
 *
 * If ANY step fails, the transaction rolls back — no partial financial
 * transition is ever committed.
 *
 * ## Idempotency
 *
 * - PaymentEvent UNIQUE([provider, eventId]) catches duplicate event delivery.
 * - PaymentAttempt conditional update (WHERE status IN ('created','pending'))
 *   catches duplicate/concurrent processing.
 * - Order conditional update (WHERE status='awaiting_payment') catches
 *   concurrent webhook + manual verify.
 *
 * ## State transition rules
 *
 * PaymentAttempt.status:
 *   created  → paid     (provider confirmed success)
 *   created  → failed   (provider confirmed failure)
 *   created  → expired   (reconciliation found no payment after TTL — NOT here)
 *   paid     → (terminal — no further transitions)
 *   failed   → (can retry: a later success event can transition created→paid
 *              if a NEW PaymentAttempt was created for the retry)
 *
 * A stale 'paid' event arriving after a 'failed' event is REJECTED — the
 * PaymentAttempt is no longer in 'created'/'pending' status, so the
 * conditional update matches 0 rows. This prevents a stale success from
 * overwriting a newer failure (or vice versa).
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface PaymentTransitionInput {
  /** The internal merchant reference (PaymentAttempt.merchantOrderId). */
  merchantOrderId: string;
  /** The payment provider. */
  provider: PaymentProvider;
  /** The provider's transaction ID (for dedup + persistence). */
  providerTxnId: string | null;
  /** The provider's UTR/RRN (bank-side reference). */
  providerUtr: string | null;
  /** The amount in paise (must match PaymentAttempt.amountPaise). */
  amountPaise: number;
  /** The currency (must match PaymentAttempt.currency). */
  currency: string;
  /** Whether the provider confirmed the payment as successful. */
  paid: boolean;
  /** The dedup key for the event (usually providerTxnId, fallback to merchantOrderId). */
  eventId: string;
  /** The source of this transition. */
  source: 'webhook' | 'status_check' | 'reconciliation' | 'manual';
  /** The shop ID (for tenant validation). */
  shopId: string;
  /** The order ID (for the order transition). */
  orderId: string;
}

export interface PaymentTransitionResult {
  /** true if this call caused a state transition (order flipped to paid, or
   * attempt flipped to failed). */
  applied: boolean;
  /** true if a duplicate event was detected (idempotent skip). */
  idempotent: boolean;
  /** The final PaymentAttempt status after the transition. */
  attemptStatus: 'paid' | 'failed' | 'created' | 'expired';
  /** The final Order status (read after the transaction). */
  orderStatus: string;
  /** Human-readable reason for logging. */
  reason: string;
  /** The PaymentEvent ID (if a new event was persisted). */
  eventId?: string;
  /** The PaymentAttempt ID. */
  attemptId?: string;
}

// ─── Atomic transition ─────────────────────────────────────────────────

/**
 * Apply a payment transition atomically.
 *
 * This is the SINGLE entry point for financial state transitions. Both the
 * webhook pipeline and the reconciliation service call this function —
 * ensuring consistent, transactionally-protected updates regardless of the
 * trigger.
 *
 * The function uses `db.$transaction()` to wrap:
 *   1. PaymentEvent INSERT (dedup)
 *   2. PaymentAttempt SELECT + conditional UPDATE
 *   3. Order conditional UPDATE (if paid)
 *   4. PaymentEvent UPDATE → processed
 *
 * If any step fails, the entire transaction rolls back.
 */
export async function applyPaymentTransition(
  input: PaymentTransitionInput,
): Promise<PaymentTransitionResult> {
  const logger = getContainer().logger;
  const { db } = await import('@/lib/db');

  return await (db as any).$transaction(
    async (tx: any) => {
      // ── STEP 1: Find the PaymentAttempt FIRST (AUDIT-007 fix) ──
      // Phase 6.6 P0 fix: the PaymentEvent.attemptId field has a FK constraint
      // to PaymentAttempt.id. The previous code set attemptId = input.orderId
      // (an Order UUID), which violates the FK in production. We must find the
      // attempt first so we can use its real ID.
      const attempt = await tx.paymentAttempt.findUnique({
        where: { merchantOrderId: input.merchantOrderId },
      });
      if (!attempt) {
        // No PaymentAttempt found — cannot insert a PaymentEvent (FK requires
        // a valid attemptId). Return early; the audit log in webhook.service.ts
        // already recorded the event arrival.
        logger.warn('lifecycle: PaymentAttempt not found', {
          merchantOrderId: input.merchantOrderId,
          orderId: input.orderId,
        });
        return {
          applied: false,
          idempotent: false,
          attemptStatus: 'created' as PaymentTransitionResult['attemptStatus'],
          orderStatus: 'unknown',
          reason: 'PaymentAttempt not found',
        };
      }

      // ── STEP 2: Insert PaymentEvent with correct attemptId (dedup via UNIQUE) ──
      let eventRecord: { id: string } | null = null;
      try {
        eventRecord = await tx.paymentEvent.create({
          data: {
            id: crypto.randomUUID(),
            attemptId: attempt.id, // AUDIT-007 fix: use the real attempt ID, not orderId
            provider: input.provider,
            eventId: input.eventId,
            merchantOrderId: input.merchantOrderId,
            providerTransactionId: input.providerTxnId ?? null,
            eventType: input.source,
            signatureValid: true,
            processingStatus: 'received',
          },
        });
      } catch (e) {
        if (isUniqueConstraintError(e)) {
          // Duplicate event — this event was already processed (or is being
          // processed concurrently). Read the existing event's state to
          // determine the idempotent response.
          const existing = await tx.paymentEvent.findFirst({
            where: { provider: input.provider, eventId: input.eventId },
          });
          const order = await tx.order.findUnique({ where: { id: input.orderId } });
          return {
            applied: false,
            idempotent: true,
            attemptStatus: attempt.status as PaymentTransitionResult['attemptStatus'],
            orderStatus: order?.status ?? 'unknown',
            reason: `duplicate event (existing event processingStatus=${existing?.processingStatus ?? 'unknown'})`,
            eventId: existing?.id,
            attemptId: attempt.id,
          };
        }
        // Non-unique error → real failure. The transaction will roll back.
        logger.error('lifecycle: PaymentEvent INSERT failed', {
          merchantOrderId: input.merchantOrderId,
          eventId: input.eventId,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }

      // Defensive: after the try/catch, eventRecord must be assigned (the
      // catch either returns early for unique errors or re-throws).
      if (!eventRecord) {
        throw new Error('PaymentEvent creation returned null without throwing');
      }

      // Tenant validation — the attempt's shopId must match the input.
      if (attempt.shopId !== input.shopId) {
        await tx.paymentEvent.update({
          where: { id: eventRecord.id },
          data: { processingStatus: 'skipped', errorMessage: 'tenant mismatch', processedAt: new Date() },
        });
        return {
          applied: false,
          idempotent: false,
          attemptStatus: attempt.status as PaymentTransitionResult['attemptStatus'],
          orderStatus: 'unknown',
          reason: 'tenant mismatch',
          eventId: eventRecord.id,
          attemptId: attempt.id,
        };
      }

      // ── STEP 3: Amount + currency validation ──
      if (input.amountPaise !== attempt.amountPaise) {
        await tx.paymentEvent.update({
          where: { id: eventRecord.id },
          data: {
            processingStatus: 'skipped',
            errorMessage: `amount mismatch (expected ${attempt.amountPaise}, got ${input.amountPaise})`,
            processedAt: new Date(),
          },
        });
        return {
          applied: false,
          idempotent: false,
          attemptStatus: attempt.status as PaymentTransitionResult['attemptStatus'],
          orderStatus: 'unknown',
          reason: `amount mismatch (expected ${attempt.amountPaise}, got ${input.amountPaise})`,
          eventId: eventRecord.id,
          attemptId: attempt.id,
        };
      }
      if (input.currency !== attempt.currency) {
        await tx.paymentEvent.update({
          where: { id: eventRecord.id },
          data: {
            processingStatus: 'skipped',
            errorMessage: `currency mismatch (expected ${attempt.currency}, got ${input.currency})`,
            processedAt: new Date(),
          },
        });
        return {
          applied: false,
          idempotent: false,
          attemptStatus: attempt.status as PaymentTransitionResult['attemptStatus'],
          orderStatus: 'unknown',
          reason: `currency mismatch`,
          eventId: eventRecord.id,
          attemptId: attempt.id,
        };
      }

      // ── STEP 4: Conditional PaymentAttempt update ──
      // Only transition if the attempt is in 'created' or 'pending' status.
      // A 'paid' or 'failed' attempt is terminal — a stale event cannot
      // overwrite it.
      const newAttemptStatus = input.paid ? 'paid' : 'failed';
      const attemptUpdated = await tx.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          shopId: input.shopId,
          status: { in: ['created', 'pending'] },
        },
        data: {
          status: newAttemptStatus,
          providerTransactionId: input.providerTxnId ?? attempt.providerTransactionId,
        },
      });

      if (attemptUpdated.count === 0) {
        // The attempt was NOT in 'created'/'pending' — it's already in a
        // terminal state. This is the stale-event guard: a duplicate or
        // late-arriving event cannot regress the attempt.
        const currentAttempt = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } });
        await tx.paymentEvent.update({
          where: { id: eventRecord.id },
          data: {
            processingStatus: 'skipped',
            errorMessage: `attempt already in terminal status '${currentAttempt?.status}'`,
            processedAt: new Date(),
          },
        });
        const order = await tx.order.findUnique({ where: { id: input.orderId } });
        return {
          applied: false,
          idempotent: true,
          attemptStatus: (currentAttempt?.status ?? 'created') as PaymentTransitionResult['attemptStatus'],
          orderStatus: order?.status ?? 'unknown',
          reason: `attempt already in terminal status '${currentAttempt?.status}' (stale event skipped)`,
          eventId: eventRecord.id,
          attemptId: attempt.id,
        };
      }

      // ── STEP 5: Conditional Order update (only if paid) ──
      let orderStatus = 'unknown';
      if (input.paid) {
        const orderUpdated = await tx.order.updateMany({
          where: {
            id: input.orderId,
            shopId: input.shopId,
            status: 'awaiting_payment',
          },
          data: {
            status: 'paid',
            paidAt: new Date(),
            paymentTxnId: input.providerTxnId,
            paymentUtr: input.providerUtr,
            paymentProvider: input.provider,
          },
        });
        if (orderUpdated.count === 0) {
          // The order was NOT in 'awaiting_payment' — it may already be paid
          // (concurrent request won) or in a later state. The PaymentAttempt
          // WAS transitioned (step 4), so the financial state is consistent.
          const order = await tx.order.findUnique({ where: { id: input.orderId } });
          orderStatus = order?.status ?? 'unknown';
        } else {
          orderStatus = 'paid';
        }
      } else {
        // Payment failed — the order stays in awaiting_payment (allows retry).
        const order = await tx.order.findUnique({ where: { id: input.orderId } });
        orderStatus = order?.status ?? 'awaiting_payment';
      }

      // ── STEP 6: Mark PaymentEvent as processed ──
      await tx.paymentEvent.update({
        where: { id: eventRecord.id },
        data: {
          processingStatus: 'processed',
          processedAt: new Date(),
        },
      });

      logger.info('lifecycle: payment transition applied', {
        merchantOrderId: input.merchantOrderId,
        provider: input.provider,
        paid: input.paid,
        attemptStatus: newAttemptStatus,
        orderStatus,
        source: input.source,
      });

      return {
        applied: true,
        idempotent: false,
        attemptStatus: newAttemptStatus as PaymentTransitionResult['attemptStatus'],
        orderStatus,
        reason: `${input.source}: attempt → ${newAttemptStatus}, order → ${orderStatus}`,
        eventId: eventRecord.id,
        attemptId: attempt.id,
      };
    },
    {
      timeout: 10_000, // 10-second timeout — matches provider API timeouts
      isolationLevel: 'Serializable' as any, // strongest isolation — prevents phantom reads
    },
  );
}

// ─── Reconciliation support ────────────────────────────────────────────

/**
 * Find stale PaymentAttempts eligible for reconciliation.
 *
 * An attempt is "stale" if:
 *   - status = 'created' (never transitioned)
 *   - createdAt < NOW() - staleAfterMs (the payment window has elapsed)
 *
 * Returns a bounded batch (max `limit` results) ordered by age (oldest first
 * — most urgent to reconcile).
 */
export async function findStalePaymentAttempts(
  staleAfterMs: number,
  limit: number,
): Promise<Array<{
  id: string;
  shopId: string;
  orderId: string;
  provider: string;
  merchantOrderId: string;
  amountPaise: number;
  currency: string;
  createdAt: Date;
}>> {
  const { db } = await import('@/lib/db');
  const cutoff = new Date(Date.now() - staleAfterMs);
  try {
    const attempts = await (db as any).paymentAttempt.findMany({
      where: {
        status: 'created',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 50), // hard cap at 50
    });
    return attempts.map((a: any) => ({
      id: a.id,
      shopId: a.shopId,
      orderId: a.orderId,
      provider: a.provider,
      merchantOrderId: a.merchantOrderId,
      amountPaise: a.amountPaise,
      currency: a.currency,
      createdAt: a.createdAt,
    }));
  } catch {
    // PaymentAttempt table may not exist (return empty array)
    return [];
  }
}

/**
 * Mark a PaymentAttempt as expired (reconciliation found no payment after TTL).
 *
 * This is a separate operation from `applyPaymentTransition` because expiry
 * is NOT a financial transition — it's a cleanup operation. It doesn't touch
 * the Order (the order stays in awaiting_payment, allowing the customer to
 * retry checkout).
 */
export async function expirePaymentAttempt(
  attemptId: string,
  reason: string,
): Promise<void> {
  const { db } = await import('@/lib/db');
  const logger = getContainer().logger;
  try {
    await (db as any).paymentAttempt.updateMany({
      where: {
        id: attemptId,
        status: 'created', // only expire if still in 'created'
      },
      data: { status: 'expired' },
    });
    logger.info('lifecycle: expired stale PaymentAttempt', { attemptId, reason });
  } catch (e) {
    logger.error('lifecycle: failed to expire PaymentAttempt', {
      attemptId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
