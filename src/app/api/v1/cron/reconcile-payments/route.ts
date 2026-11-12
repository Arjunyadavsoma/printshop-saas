import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import {
  findStalePaymentAttempts,
  applyPaymentTransition,
} from '@/lib/payments/lifecycle.service';

/**
 * GET /api/v1/cron/reconcile-payments — Vercel Cron endpoint.
 *
 * Reconciles stale PaymentAttempts (status='created', older than 10 min) by
 * polling each provider's status API. If the provider confirms the payment
 * was actually paid (and the amount matches), the lifecycle service atomically
 * transitions the attempt → 'paid' + the order → 'paid'.
 *
 * Authentication: CRON_SECRET env var (Authorization: Bearer <secret> header
 * ONLY). Vercel Cron automatically sends the Authorization header.
 * Fails CLOSED — returns 401 if `CRON_SECRET` is unset OR if the token doesn't
 * match (same pattern as the cleanup route). Query-string `?secret=` fallback
 * was REMOVED in Phase 6.7 — the secret MUST NOT travel in the URL (it would
 * be logged by every proxy, Vercel, and the application itself).
 *
 * This endpoint is SAFE:
 *   - Idempotent: `applyPaymentTransition` deduplicates via the PaymentEvent
 *     UNIQUE([provider, eventId]) constraint + conditional updates. A cron
 *     retry (or two overlapping invocations) cannot double-process a payment.
 *   - Bounded batch: max 10 per invocation (configurable via `?limit=`,
 *     hard-capped at 50).
 *   - Per-attempt try/catch: one failure does NOT abort the whole batch.
 *   - 15-second per-attempt verification timeout via `Promise.race` — a
 *     hung provider cannot stall the cron.
 *   - Never logs credentials, merchantKey, saltKey, auth headers, or raw
 *     webhook bodies. Audit metadata records only {provider, outcome, reason,
 *     attemptId}.
 *
 * Scheduling:
 *   - Vercel Hobby cron: daily at 02:00 UTC (safety net)
 *   - GitHub Actions: every 10 minutes (primary scheduler)
 * Both invoke the same idempotent endpoint — duplicate execution is safe.
 *
 * Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`.
 */

const MAX_BATCH = 50; // Vercel Hobby: daily cron processes ALL stale attempts in one run
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes — same threshold (attempts stale after payment window expires)
const VERIFY_TIMEOUT_MS = 15_000; // 15-second per-attempt timeout

/** Outcome categories recorded in audit_logs + returned in the response. */
type ReconciliationOutcome =
  | 'paid' // provider confirmed + amount matched → lifecycle applied
  | 'amount_mismatch' // provider said paid, but amount differs → left pending
  | 'not_paid' // provider said NOT paid → left pending for manual review
  | 'verify_error' // verifyPayment threw (timeout/network) → left pending
  | 'shop_missing' // shop lookup failed → skipped
  | 'adapter_missing' // no adapter registered for the provider → skipped
  | 'transition_failed'; // lifecycle threw after a successful verify → left pending

interface ReconciliationDetail {
  attemptId: string;
  provider: string;
  outcome: ReconciliationOutcome;
}

interface ReconciliationStats {
  processed: number;
  paid: number;
  skipped: number;
  errors: number;
  details: ReconciliationDetail[];
}

export async function GET(req: Request) {
  // ── Authenticate — Vercel Cron sends Authorization: Bearer <CRON_SECRET> ──
  // Phase 6.7: ?secret= query-string fallback was REMOVED. The secret MUST NOT
  // travel in the URL — every proxy, Vercel, and the app itself logs URLs.
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedSecret = process.env.CRON_SECRET ?? process.env.SETUP_KEY ?? '';

  // Fail CLOSED: if CRON_SECRET is unset OR the token doesn't match → 401.
  if (!expectedSecret || token !== expectedSecret) {
    return Response.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
      },
      { status: 401 },
    );
  }

  // ── Parse optional limit (max 50 per invocation, default 10) ──
  const limitParam = parseInt(
    new URL(req.url).searchParams.get('limit') ?? String(MAX_BATCH),
    10,
  );
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : MAX_BATCH, 50);

  const container = getContainer();
  const logger = container.logger;

  // ── Find stale PaymentAttempts (status='created', older than 10 min) ──
  let staleAttempts: Awaited<ReturnType<typeof findStalePaymentAttempts>>;
  try {
    staleAttempts = await findStalePaymentAttempts(STALE_THRESHOLD_MS, limit);
  } catch (e) {
    logger.error('reconciliation: findStalePaymentAttempts failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return Response.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: e instanceof Error ? e.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }

  const stats: ReconciliationStats = {
    processed: staleAttempts.length,
    paid: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  // ── Process each stale attempt — wrap in try/catch so one failure doesn't abort the batch ──
  for (const attempt of staleAttempts) {
    const detail: ReconciliationDetail = {
      attemptId: attempt.id,
      provider: attempt.provider,
      outcome: 'verify_error', // overwritten below
    };

    try {
      // a. Load the shop — skip if not found.
      const shop = await repos.shops.findById(attempt.shopId);
      if (!shop) {
        detail.outcome = 'shop_missing';
        stats.skipped++;
        stats.details.push(detail);
        await safeAudit(attempt, 'shop_missing', 'shop not found');
        continue;
      }

      // b. Get the payment adapter from the registry — skip if unregistered.
      let adapter: { verifyPayment: (input: { merchantOrderId: string; shopCredentials: Record<string, unknown> }) => Promise<{ paid: boolean; txnId: string | null; utr: string | null; amountPaise: number | null }> };
      try {
        adapter = container.paymentRegistry.get(
          attempt.provider as Parameters<typeof container.paymentRegistry.get>[0],
        ) as unknown as typeof adapter;
      } catch {
        detail.outcome = 'adapter_missing';
        stats.skipped++;
        stats.details.push(detail);
        await safeAudit(attempt, 'adapter_missing', `no adapter for provider '${attempt.provider}'`);
        continue;
      }

      // c. Verify with a 15-second timeout (Promise.race).
      let verification: { paid: boolean; txnId: string | null; utr: string | null; amountPaise: number | null };
      try {
        verification = await Promise.race([
          adapter.verifyPayment({
            merchantOrderId: attempt.merchantOrderId,
            shopCredentials: shop.paymentCredentials,
          }),
          timeoutAfter(VERIFY_TIMEOUT_MS),
        ]);
      } catch (e) {
        // g. verifyPayment threw (timeout, network error) → leave pending.
        detail.outcome = 'verify_error';
        stats.errors++;
        stats.details.push(detail);
        await safeAudit(
          attempt,
          'verify_error',
          e instanceof Error ? e.message : 'verify threw',
        );
        logger.warn('reconciliation: verifyPayment threw', {
          attemptId: attempt.id,
          provider: attempt.provider,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      // d. Provider confirmed paid AND amount matches → apply lifecycle transition.
      if (verification.paid && verification.amountPaise === attempt.amountPaise) {
        const providerTxnId = verification.txnId ?? null;
        const providerUtr = verification.utr ?? null;
        const eventId = verification.txnId ?? attempt.merchantOrderId;

        try {
          const result = await applyPaymentTransition({
            merchantOrderId: attempt.merchantOrderId,
            provider: attempt.provider as Parameters<typeof applyPaymentTransition>[0]['provider'],
            providerTxnId,
            providerUtr,
            amountPaise: attempt.amountPaise,
            currency: attempt.currency,
            paid: true,
            eventId,
            source: 'reconciliation',
            shopId: attempt.shopId,
            orderId: attempt.orderId,
          });

          // Whether applied or idempotent-skip, the payment is reconciled.
          detail.outcome = 'paid';
          stats.paid++;
          stats.details.push(detail);
          await safeAudit(attempt, 'paid', result.reason);
        } catch (e) {
          // Lifecycle threw after a successful verify — leave pending for the
          // next cron tick. Record + audit + log; do NOT abort the batch.
          detail.outcome = 'transition_failed';
          stats.errors++;
          stats.details.push(detail);
          await safeAudit(
            attempt,
            'transition_failed',
            e instanceof Error ? e.message : 'lifecycle threw',
          );
          logger.error('reconciliation: applyPaymentTransition threw', {
            attemptId: attempt.id,
            provider: attempt.provider,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        continue;
      }

      // e. Paid but amount mismatch → leave pending, flag for manual review.
      if (verification.paid && verification.amountPaise !== attempt.amountPaise) {
        detail.outcome = 'amount_mismatch';
        stats.skipped++;
        stats.details.push(detail);
        await safeAudit(
          attempt,
          'amount_mismatch',
          `expected ${attempt.amountPaise}, got ${verification.amountPaise}`,
        );
        logger.warn('reconciliation: amount mismatch — left pending for review', {
          attemptId: attempt.id,
          provider: attempt.provider,
          expected: attempt.amountPaise,
          got: verification.amountPaise,
        });
        continue;
      }

      // f. !verification.paid → leave pending for manual review (do NOT expire
      // automatically; the customer may still complete the payment).
      detail.outcome = 'not_paid';
      stats.skipped++;
      stats.details.push(detail);
      await safeAudit(attempt, 'not_paid', 'provider reports not paid');
    } catch (e) {
      // Outer per-attempt guard: any unexpected error leaves the attempt
      // pending + records the failure. The cron continues with the next one.
      detail.outcome = 'verify_error';
      stats.errors++;
      stats.details.push(detail);
      await safeAudit(
        attempt,
        'verify_error',
        e instanceof Error ? e.message : 'unexpected error',
      );
      logger.error('reconciliation: per-attempt failure', {
        attemptId: attempt.id,
        provider: attempt.provider,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({
    success: true,
    data: {
      ...stats,
      timestamp: new Date().toISOString(),
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Reject after `ms` — used to bound `verifyPayment` calls. */
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`verify timed out after ${ms}ms`)), ms);
  });
}

/**
 * Audit-log a reconciliation outcome — NEVER throws (audit must never break
 * the flow) + NEVER logs credentials, merchantKey, saltKey, or auth headers.
 * Records ONLY {provider, outcome, reason, attemptId}.
 */
async function safeAudit(
  attempt: { id: string; shopId: string; provider: string; orderId: string },
  outcome: ReconciliationOutcome,
  reason: string,
): Promise<void> {
  try {
    await repos.audit.log({
      shopId: attempt.shopId,
      userId: null,
      action: 'reconciliation.attempt',
      entityType: 'payment',
      entityId: attempt.id,
      metadata: {
        provider: attempt.provider,
        outcome,
        reason,
        attemptId: attempt.id,
      },
      ip: null,
    });
  } catch {
    // Audit logging is best-effort — swallow.
  }
}
