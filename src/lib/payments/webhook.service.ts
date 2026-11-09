import type { PaymentProvider } from '@platform/core/domain';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ensurePrintHandler, enqueueFilePrint } from '@/lib/services/print.service';
import { ValidationError, NotFoundError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { shopChannel } from '@platform/core/interfaces';
import { isUniqueConstraintError } from '@/lib/db/is-unique-constraint-error';
import { applyPaymentTransition } from '@/lib/payments/lifecycle.service';

/** A merchant-order-id → order mapping stored at checkout so the webhook
 *  can find the order without trusting the (unverified) payload. */
const SESSION_TTL = 600; // 10 minutes — covers a typical UPI/PSP payment flow

export interface StoredPaymentSession {
  orderId: string;
  shopId: string;
  amountPaise: number;
  provider: PaymentProvider;
  merchantOrderId?: string; // added for PaymentAttempt DB fallback
}

/** Called by the checkout route — remembers which order a merchantOrderId maps to. */
export async function rememberPaymentSession(merchantOrderId: string, session: StoredPaymentSession): Promise<void> {
  await getContainer().cache.set(`pay:moid:${merchantOrderId}`, JSON.stringify(session), SESSION_TTL);
}

/** Look up the payment session by the merchantOrderId extracted from the payload.
 *  Tries cache first (10-min TTL), then falls back to PaymentAttempt DB table
 *  for durability (survives Vercel cold starts + delayed webhooks >10 min).
 */
export async function lookupPaymentSession(merchantOrderId: string): Promise<StoredPaymentSession | null> {
  // 1. Try cache (fast — 10-min TTL)
  const raw = await getContainer().cache.get(`pay:moid:${merchantOrderId}`);
  if (raw) {
    try {
      return JSON.parse(raw) as StoredPaymentSession;
    } catch {
      // corrupt cache entry — fall through to DB
    }
  }

  // 2. Cache miss — try PaymentAttempt DB table (durable)
  try {
    const { db } = await import('@/lib/db');
    const attempt = await (db as any).paymentAttempt.findUnique({
      where: { merchantOrderId },
    });
    if (attempt) {
      const session: StoredPaymentSession = {
        orderId: attempt.orderId,
        shopId: attempt.shopId,
        amountPaise: attempt.amountPaise,
        provider: attempt.provider,
        merchantOrderId: attempt.merchantOrderId,
      };
      // Re-populate cache for future lookups
      await getContainer().cache.set(`pay:moid:${merchantOrderId}`, JSON.stringify(session), SESSION_TTL);
      return session;
    }
  } catch {
    // PaymentAttempt table may not exist — graceful degradation
  }

  return null;
}

/**
 * Extract the merchantOrderId reference from a webhook payload WITHOUT
 * trusting it — used to find the shop's credentials before verification.
 * Provider-specific.
 */
export function extractReference(provider: PaymentProvider, rawBody: string): string | null {
  if (provider === 'phonepe') {
    try {
      const decoded = JSON.parse(atob(rawBody));
      const data = decoded?.data ?? decoded;
      return data?.merchantTransactionId ?? null;
    } catch {
      return null;
    }
  }
  if (provider === 'paytm') {
    for (const pair of rawBody.split('&')) {
      const [k, v] = pair.split('=').map(decodeURIComponent);
      if (k === 'ORDERID') return v ?? null;
    }
    return null;
  }
  return null;
}

export interface ProcessWebhookInput {
  provider: PaymentProvider;
  rawBody: string;
  headers: Record<string, string>;
  path: string;
  ip?: string | null;
}

export interface ProcessWebhookResult {
  statusCode: number;
  responseBody?: string;
  /** Human-readable summary for the log/UI. */
  summary: string;
  /** Whether the order was newly marked paid by this call (vs idempotent skip). */
  applied: boolean;
  orderId?: string;
}

/**
 * The webhook processing pipeline (spec §6):
 *  1. Log the raw payload to audit_logs BEFORE processing.
 *  2. Extract the (untrusted) merchantOrderId → find the payment session.
 *  3. Load the shop → its payment credentials.
 *  4. Verify the signature via the adapter (real crypto).
 *  5. Idempotency check: if this txnId was already processed, skip (return 200).
 *  6. Validate amount + state transition.
 *  7. Flip the order to `paid` (paymentTxnId has a UNIQUE constraint — replay
 *     guard). Enqueue print jobs.
 *  8. Mark processed.
 */
export async function processWebhook(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
  const container = getContainer();
  const logger = container.logger;

  // 1. Audit-log the raw payload BEFORE processing (spec requirement).
  await repos.audit.log({
    shopId: null,
    userId: null,
    action: `webhook.${input.provider}.received`,
    entityType: 'payment',
    entityId: 'pending',
    metadata: { path: input.path, contentLength: input.rawBody.length, provider: input.provider },
    ip: input.ip ?? null,
  });

  // 2. Find the payment session → order → shop.
  const merchantOrderId = extractReference(input.provider, input.rawBody);
  if (!merchantOrderId) {
    return { statusCode: 400, summary: 'no merchantOrderId in payload', applied: false };
  }
  const session = await lookupPaymentSession(merchantOrderId);
  if (!session) {
    logger.warn('webhook: payment session not found (expired or unknown)', { merchantOrderId });
    return { statusCode: 404, summary: `session expired for ${merchantOrderId}`, applied: false };
  }

  const shop = await repos.shops.findById(session.shopId);
  if (!shop) {
    return { statusCode: 404, summary: 'shop not found', applied: false };
  }

  // 3-4. Verify the signature via the adapter (real crypto).
  const adapter = container.paymentRegistry.get(input.provider);
  const result = await adapter.handleWebhook(
    { rawBody: input.rawBody, headers: input.headers, path: input.path },
    shop.paymentCredentials,
  );
  if (!result.ok || !result.verification) {
    logger.warn('webhook: signature verification failed', { provider: input.provider, shopId: shop.id });
    return {
      statusCode: result.statusCode,
      responseBody: result.responseBody,
      summary: 'signature verification FAILED',
      applied: false,
    };
  }
  const v = result.verification;

  // Failed payment: leave the order in awaiting_payment (allows retry), but
  // atomically transition the PaymentAttempt to 'failed' via the lifecycle
  // service. This records the failed event durably + advances the attempt
  // status — previously the attempt stayed in 'created' forever (PAY-005).
  if (!v.paid) {
    const eventId = v.txnId ?? merchantOrderId;
    try {
      await applyPaymentTransition({
        merchantOrderId,
        provider: input.provider,
        providerTxnId: v.txnId,
        providerUtr: v.utr,
        amountPaise: v.amountPaise ?? session.amountPaise,
        currency: 'INR',
        paid: false,
        eventId,
        source: 'webhook',
        shopId: shop.id,
        orderId: session.orderId,
      });
    } catch (e) {
      // If the atomic transition fails (DB error), log but don't block the
      // webhook response — the payment was failed anyway, so no financial
      // harm. The event will be reconciled later.
      logger.error('webhook: failed-payment lifecycle transition error', {
        merchantOrderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: `webhook.${input.provider}.failed`,
      entityType: 'order',
      entityId: session.orderId,
      metadata: { txnId: v.txnId, state: 'not-paid' },
      ip: input.ip ?? null,
    });
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: 'payment not completed (order left in awaiting_payment)',
      applied: false,
      orderId: session.orderId,
    };
  }

  // 5. Fast-path idempotency check via cache (before the DB transaction).
  // The authoritative dedup is the PaymentEvent UNIQUE constraint inside
  // applyPaymentTransition — this cache check just avoids the transaction
  // for the common case of a provider retrying within 24h.
  const processedKey = `pay:done:${input.provider}:${v.txnId ?? merchantOrderId}`;
  if (v.txnId && (await container.cache.get(processedKey))) {
    logger.info('webhook: idempotent skip (cache hit)', { txnId: v.txnId });
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: 'idempotent — already processed (cache hit)',
      applied: false,
      orderId: session.orderId,
    };
  }

  // 6. Pre-validate amount (fast reject before the transaction).
  // The lifecycle service ALSO validates amount inside the transaction, but
  // checking here first avoids the transaction for clearly-invalid payloads.
  if (v.amountPaise === null) {
    logger.warn('webhook: amount missing — rejecting', { provider: input.provider });
    return {
      statusCode: 400,
      responseBody: result.responseBody,
      summary: 'amount missing in webhook payload — cannot verify payment integrity',
      applied: false,
      orderId: session.orderId,
    };
  }
  // Amount mismatch — reject with 400 (tells the provider "bad request, don't
  // retry"). The session.amountPaise is the order's totalAmountPaise (set at
  // checkout). The lifecycle service also validates this inside the transaction
  // as a defense-in-depth measure.
  if (v.amountPaise !== session.amountPaise) {
    logger.warn('webhook: amount mismatch', { expected: session.amountPaise, got: v.amountPaise });
    return {
      statusCode: 400,
      responseBody: result.responseBody,
      summary: `amount mismatch (expected ${session.amountPaise}, got ${v.amountPaise})`,
      applied: false,
      orderId: session.orderId,
    };
  }

  // 7. ATOMIC lifecycle transition (Phase 5.3).
  // Replaces the previous 3-step non-atomic flow:
  //   OLD: paymentEvent.create → repos.orders.transitionStatus → paymentEvent.update
  //   NEW: applyPaymentTransition (single db.$transaction)
  //
  // The transaction wraps:
  //   1. PaymentEvent INSERT (dedup via UNIQUE([provider, eventId]))
  //   2. PaymentAttempt SELECT + conditional UPDATE (created → paid)
  //   3. Order conditional UPDATE (awaiting_payment → paid)
  //   4. PaymentEvent UPDATE → processed
  //
  // If any step fails, the entire transaction rolls back — no partial
  // financial transition is committed.
  const eventId = v.txnId ?? merchantOrderId;
  let transitionResult;
  try {
    transitionResult = await applyPaymentTransition({
      merchantOrderId,
      provider: input.provider,
      providerTxnId: v.txnId,
      providerUtr: v.utr,
      amountPaise: v.amountPaise,
      currency: 'INR',
      paid: true,
      eventId,
      source: 'webhook',
      shopId: shop.id,
      orderId: session.orderId,
    });
  } catch (e) {
    logger.error('webhook: lifecycle transition failed', {
      merchantOrderId,
      eventId,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      statusCode: 500,
      responseBody: result.responseBody,
      summary: 'lifecycle transition failed — payment held for retry',
      applied: false,
      orderId: session.orderId,
    };
  }

  // 8. Handle the transition result.
  if (transitionResult.idempotent || !transitionResult.applied) {
    // Duplicate event, stale event, or already-processed — idempotent skip.
    if (v.txnId) await container.cache.set(processedKey, session.orderId, 86400);
    logger.info('webhook: idempotent skip (lifecycle)', {
      txnId: v.txnId,
      reason: transitionResult.reason,
      attemptStatus: transitionResult.attemptStatus,
    });
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: transitionResult.reason,
      applied: false,
      orderId: session.orderId,
    };
  }

  // 9. Transition succeeded — cache the idempotency key + audit.
  if (v.txnId) await container.cache.set(processedKey, session.orderId, 86400); // 24h

  await repos.audit.log({
    shopId: shop.id,
    userId: null,
    action: `webhook.${input.provider}.paid`,
    entityType: 'order',
    entityId: session.orderId,
    metadata: { txnId: v.txnId, utr: v.utr, amountPaise: v.amountPaise },
    ip: input.ip ?? null,
  });
  logger.info('webhook: order marked paid', { orderId: session.orderId, provider: input.provider, txnId: v.txnId });

  // Push a realtime event so the dashboard queue updates the moment a payment
  // lands (no polling needed for the happy path).
  void container.realtime.publish(shopChannel(shop.id), 'order.paid', { orderId: session.orderId, amountPaise: v.amountPaise }).catch(() => {});

  // Auto-dispatch to print now that the order is paid.
  ensurePrintHandler();
  void enqueuePaidOrderPrint(session.orderId, shop.id).catch((e) =>
    logger.error('webhook: failed to enqueue print', { orderId: session.orderId, err: String(e) }),
  );

  return {
    statusCode: result.statusCode,
    responseBody: result.responseBody,
    summary: `order marked paid via ${input.provider} (txn ${v.txnId})`,
    applied: true,
    orderId: session.orderId,
  };
}

/**
 * Enqueue print jobs for every pending/queued file on a paid order. Delegates
 * the per-file two-layer idempotency guard (findActiveByFile pre-check +
 * P2002 catch on the partial unique index `PrintJob_active_file_unique`)
 * to the shared `enqueueFilePrint` helper in `print.service.ts`.
 *
 * ARCH-003 fix: the previous implementation inlined the idempotency logic
 * here, which the manual `/start` route then duplicated WITHOUT the guard.
 * Both paths now call the shared helper — the race is closed at a single
 * source of truth.
 *
 * After enqueuing, the order is flipped to 'printing' via a race-safe
 * conditional update (`transitionStatus` with `expectedCurrentStatus='paid'`).
 * The webhook only fires after payment is confirmed, so the order SHOULD
 * still be in 'paid' status. If a concurrent request (e.g. the manual
 * `/start` route or a duplicate webhook) already flipped it to 'printing',
 * the conditional update is a no-op (0 rows matched) — we don't overwrite
 * a more-advanced state or double-write audit logs. The `enqueueFilePrint`
 * calls themselves are idempotent, so the order's print jobs are guaranteed
 * consistent regardless of who won the status-flip race.
 */
export async function enqueuePaidOrderPrint(orderId: string, shopId: string): Promise<void> {
  const files = await repos.files.findByOrder(orderId);
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
  for (const f of pending) {
    // IDEMPOTENT enqueue — the shared two-layer guard (findActiveByFile
    // pre-check + P2002 catch on the partial unique index) prevents
    // duplicate PrintJobs even under concurrent webhook + manual /start
    // calls. Returns { jobId, created }; we discard the result here —
    // the agent picks up the job via the dispatch event.
    await enqueueFilePrint(shopId, f.id);
  }
  if (pending.length > 0) {
    // Race-safe conditional update — WHERE status='paid' is the atomic
    // guard. A concurrent webhook (or the manual /start route) that
    // already flipped the order to 'printing' makes this a no-op.
    await repos.orders.transitionStatus(orderId, shopId, 'paid', {
      status: 'printing',
    });
  }
}
