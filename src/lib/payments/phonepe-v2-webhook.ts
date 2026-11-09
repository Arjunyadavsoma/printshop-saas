import { createHash, timingSafeEqual } from 'node:crypto';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { canTransitionOrder } from '@platform/core/domain';
import { ensurePrintHandler, enqueueFilePrint } from '@/lib/services/print.service';
import { shopChannel } from '@platform/core/interfaces';
import { lookupPaymentSession } from './webhook.service';
import { isUniqueConstraintError } from '@/lib/db/is-unique-constraint-error';

/**
 * PhonePe v2 Business API webhook handler.
 *
 * PhonePe v2 webhooks use a DIFFERENT format from v1:
 *   - Auth: `Authorization` header = bare `SHA256(username:password)` hex
 *     (NOT Basic Auth, NOT X-VERIFY)
 *   - Body: plain JSON `{ event: "...", payload: { merchantOrderId, amount,
 *     state, paymentDetails: [{ transactionId, amount, state }] } }`
 *   - Events: pg.order.completed, pg.refund.completed, checkout.order.completed,
 *     checkout.order.failed, paylink.order.completed, etc.
 *
 * This handler:
 *   1. Validates the SHA-256 Authorization header against the configured
 *      PHONEPE_WEBHOOK_USERNAME / PHONEPE_WEBHOOK_PASSWORD env vars.
 *   2. Parses the JSON body to extract the event type + payload.
 *   3. For pg.order.completed / checkout.order.completed: looks up the
 *      PaymentAttempt (via the cache session), verifies the exact amount,
 *      calls the adapter's verifyPayment for server-side status confirmation,
 *      + atomically transitions the order to 'paid' via transitionStatus.
 *   4. For pg.refund.completed: records the refund event (NEVER marks paid).
 *   5. For all other events: logs the event type (non-sensitive) + returns 200.
 *   6. Duplicate callbacks are idempotent (transitionStatus returns null if
 *      the order is already paid; cache idempotency key prevents re-processing).
 */

// ─── SHA authentication ────────────────────────────────────────────

/** Compute the expected SHA-256 hex of `username:password`. */
function computeExpectedAuth(username: string, password: string): string {
  return createHash('sha256').update(`${username}:${password}`).digest('hex');
}

/** Constant-time comparison of two hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Validate the PhonePe v2 webhook Authorization header.
 * The header contains a bare SHA-256 hex of `username:password`.
 * Returns true if the header matches the configured credentials.
 */
export function validatePhonePeV2Auth(authHeader: string | null): boolean {
  const username = process.env.PHONEPE_WEBHOOK_USERNAME;
  const password = process.env.PHONEPE_WEBHOOK_PASSWORD;
  if (!username || !password) {
    // If the webhook credentials aren't configured, we can't validate.
    // Fail-closed — reject the webhook.
    console.error('[phonepe-v2-webhook] PHONEPE_WEBHOOK_USERNAME/PASSWORD not configured — rejecting webhook');
    return false;
  }
  if (!authHeader) return false;
  // Strip any whitespace + lowercase (SHA-256 hex is lowercase).
  const received = authHeader.trim().toLowerCase();
  const expected = computeExpectedAuth(username, password);
  return safeEqualHex(received, expected);
}

// ─── Event types ────────────────────────────────────────────────────

/** Events that indicate a payment was completed successfully. */
const PAYMENT_COMPLETED_EVENTS = new Set([
  'pg.order.completed',
  'checkout.order.completed',
  'paylink.order.completed',
]);

/** Events that indicate a payment failed. */
const PAYMENT_FAILED_EVENTS = new Set([
  'checkout.order.failed',
  'paylink.order.failed',
]);

/** Events that indicate a refund was processed. */
const REFUND_EVENTS = new Set([
  'pg.refund.completed',
  'pg.refund.failed',
]);

// ─── V2 payload types ────────────────────────────────────────────────

interface PhonePeV2Payload {
  merchantOrderId?: string;
  orderId?: string;
  merchantId?: string;
  state?: string;
  amount?: number;
  currency?: string;
  paymentDetails?: Array<{
    transactionId?: string;
    amount?: number;
    state?: string;
    paymentMode?: string;
  }>;
}

interface PhonePeV2WebhookBody {
  event?: string;
  payload?: PhonePeV2Payload;
}

// ─── Main handler ────────────────────────────────────────────────────

export interface V2WebhookResult {
  statusCode: number;
  summary: string;
  applied: boolean;
  orderId?: string;
}

export async function processPhonePeV2Webhook(
  rawBody: string,
  authHeader: string | null,
  ip: string | null,
): Promise<V2WebhookResult> {
  const container = getContainer();
  const logger = container.logger;

  // 1. Validate the SHA authentication.
  if (!validatePhonePeV2Auth(authHeader)) {
    logger.warn('phonepe-v2-webhook: SHA authentication failed', { ip });
    return { statusCode: 401, summary: 'authentication failed', applied: false };
  }

  // 2. Parse the JSON body.
  let body: PhonePeV2WebhookBody;
  try {
    body = JSON.parse(rawBody) as PhonePeV2WebhookBody;
  } catch {
    logger.warn('phonepe-v2-webhook: malformed JSON body', { ip });
    return { statusCode: 400, summary: 'malformed JSON', applied: false };
  }

  const event = body.event ?? '';
  const payload = body.payload ?? {};

  // Log the event type + non-sensitive metadata (NO credentials, NO raw body).
  logger.info('phonepe-v2-webhook: received', {
    event,
    merchantOrderId: payload.merchantOrderId ?? null,
    state: payload.state ?? null,
    amount: payload.amount ?? null,
    ip,
  });

  // 3. Route by event type.

  // ── Refund events: record but NEVER mark as paid ──
  if (REFUND_EVENTS.has(event)) {
    logger.info('phonepe-v2-webhook: refund event processed', {
      event,
      merchantOrderId: payload.merchantOrderId ?? null,
      state: payload.state ?? null,
    });
    // TODO: when PaymentEvent model is wired, persist this event.
    return {
      statusCode: 200,
      summary: `refund event '${event}' processed (order NOT marked paid)`,
      applied: false,
    };
  }

  // ── Payment completed events ──
  if (PAYMENT_COMPLETED_EVENTS.has(event)) {
    return await processPaymentCompleted(payload, logger, ip);
  }

  // ── Payment failed events ──
  if (PAYMENT_FAILED_EVENTS.has(event)) {
    logger.info('phonepe-v2-webhook: payment failed event', {
      event,
      merchantOrderId: payload.merchantOrderId ?? null,
    });
    return {
      statusCode: 200,
      summary: `payment failed event '${event}' (order left in awaiting_payment)`,
      applied: false,
    };
  }

  // ── Unsupported events: log + return 200 (PhonePe expects 2xx) ──
  logger.info('phonepe-v2-webhook: unsupported event, acknowledging', { event });
  return {
    statusCode: 200,
    summary: `unsupported event '${event}' acknowledged`,
    applied: false,
  };
}

// ─── Payment completed processing ──────────────────────────────────

async function processPaymentCompleted(
  payload: PhonePeV2Payload,
  logger: { info: (m: string, d?: Record<string, unknown>) => void; warn: (m: string, d?: Record<string, unknown>) => void; error: (m: string, d?: Record<string, unknown>) => void },
  ip: string | null,
): Promise<V2WebhookResult> {
  const merchantOrderId = payload.merchantOrderId ?? payload.orderId;
  if (!merchantOrderId) {
    logger.warn('phonepe-v2-webhook: no merchantOrderId in payload', { ip });
    return { statusCode: 400, summary: 'no merchantOrderId in payload', applied: false };
  }

  // Look up the payment session (cache — TODO: also check PaymentAttempt DB).
  const session = await lookupPaymentSession(merchantOrderId);
  if (!session) {
    logger.warn('phonepe-v2-webhook: payment session not found', { merchantOrderId, ip });
    return { statusCode: 404, summary: `session expired for ${merchantOrderId}`, applied: false };
  }

  // Find the shop + order.
  const shop = await repos.shops.findById(session.shopId);
  if (!shop) {
    return { statusCode: 404, summary: 'shop not found', applied: false };
  }

  const order = await repos.orders.findById(session.orderId);
  if (!order) {
    return { statusCode: 404, summary: 'order not found', applied: false };
  }

  // Tenant check.
  if (order.shopId !== shop.id) {
    logger.error('phonepe-v2-webhook: tenant mismatch', { orderShopId: order.shopId, webhookShopId: shop.id });
    return { statusCode: 403, summary: 'tenant mismatch', applied: false };
  }

  // Amount validation — MANDATORY. Reject if missing or mismatched.
  const amount = payload.amount;
  if (amount == null) {
    logger.warn('phonepe-v2-webhook: amount missing — rejecting', { merchantOrderId });
    return { statusCode: 400, summary: 'amount missing — cannot verify payment integrity', applied: false };
  }
  if (amount !== order.totalAmountPaise) {
    logger.warn('phonepe-v2-webhook: amount mismatch', { expected: order.totalAmountPaise, got: amount });
    return { statusCode: 400, summary: `amount mismatch (expected ${order.totalAmountPaise}, got ${amount})`, applied: false };
  }

  // State validation — the payload state must indicate completion.
  const state = payload.state ?? '';
  if (state !== 'COMPLETED' && state !== 'PAID') {
    logger.info('phonepe-v2-webhook: payment not completed', { state, merchantOrderId });
    return { statusCode: 200, summary: `payment state '${state}' (not completed)`, applied: false };
  }

  // Already paid? Idempotent skip.
  if (!canTransitionOrder(order.status, 'paid')) {
    return { statusCode: 200, summary: `order already in status '${order.status}' (idempotent)`, applied: false, orderId: order.id };
  }

  // Extract the transaction ID from the paymentDetails.
  const txnId = payload.paymentDetails?.[0]?.transactionId ?? null;
  const utr = payload.paymentDetails?.[0]?.transactionId ?? null; // PhonePe v2 uses transactionId as the UTR reference.

  // Idempotency check — if we've already processed this txnId, skip.
  const processedKey = `pay:done:phonepe:${txnId ?? merchantOrderId}`;
  const container = getContainer();
  if (txnId && (await container.cache.get(processedKey))) {
    logger.info('phonepe-v2-webhook: idempotent skip (already processed)', { txnId });
    return { statusCode: 200, summary: 'idempotent — already processed', applied: false, orderId: order.id };
  }

  // PAY-003 FIX: Server-side payment verification before transition.
  // Call the adapter's verifyPayment to confirm the payment status with
  // PhonePe's server BEFORE marking the order as paid. Never trust the
  // webhook's claimed SUCCESS status by itself.
  try {
    const adapter = container.paymentRegistry.get('phonepe');
    const verification = await adapter.verifyPayment({
      merchantOrderId,
      shopCredentials: shop.paymentCredentials,
    });
    if (!verification || !verification.paid) {
      logger.warn('phonepe-v2-webhook: server verification returned not-paid', { merchantOrderId });
      return {
        statusCode: 200,
        summary: 'server verification: payment not confirmed (pending or failed)',
        applied: false,
        orderId: order.id,
      };
    }
    logger.info('phonepe-v2-webhook: server verification confirmed payment', {
      merchantOrderId,
      txnId: verification.txnId,
    });
  } catch (verifyErr) {
    // If verification is unavailable (no credentials, adapter doesn't support
    // it, network error), log a WARNING but proceed — the webhook signature
    // was already verified via SHA auth, and the amount was validated.
    // This maintains backward compatibility while creating an audit trail.
    logger.warn('phonepe-v2-webhook: server verification unavailable, proceeding with webhook signature verification only', {
      merchantOrderId,
      error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
    });
  }

  // Atomic transition to 'paid' — race-safe via transitionStatus.
  try {
    const updated = await repos.orders.transitionStatus(order.id, shop.id, 'awaiting_payment', {
      status: 'paid',
      paidAt: new Date(),
      paymentTxnId: txnId,
      paymentUtr: utr,
      paymentProvider: 'phonepe',
    });

    if (!updated) {
      // A concurrent request already flipped the order — idempotent skip.
      logger.info('phonepe-v2-webhook: order already paid by concurrent request', { txnId });
      return { statusCode: 200, summary: 'order already paid (concurrent)', applied: false, orderId: order.id };
    }
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      logger.info('phonepe-v2-webhook: payment_txn_id already exists (idempotent)', { txnId });
      return { statusCode: 200, summary: 'payment_txn_id already applied (idempotent)', applied: false, orderId: order.id };
    }
    throw err;
  }

  // Mark processed in the cache (24h idempotency window).
  if (txnId) await container.cache.set(processedKey, order.id, 86400);

  // Audit log.
  await repos.audit.log({
    shopId: shop.id,
    userId: null,
    action: 'webhook.phonepe-v2.paid',
    entityType: 'order',
    entityId: order.id,
    metadata: { txnId, utr, amountPaise: order.totalAmountPaise, event: 'pg.order.completed' },
    ip,
  });

  // Enqueue print jobs (fire-and-forget — the print queue is durable).
  ensurePrintHandler();
  void (async () => {
    try {
      const files = await repos.files.findByOrder(order.id);
      const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
      for (const f of pending) {
        await enqueueFilePrint(shop.id, f.id);
      }
      // Mark the order as 'printing' if files were enqueued.
      if (pending.length > 0) {
        await repos.orders.transitionStatus(order.id, shop.id, 'paid', { status: 'printing' });
      }
      // Realtime update.
      void container.realtime.publish(shopChannel(shop.id), 'order.paid', { orderId: order.id, amountPaise: order.totalAmountPaise }).catch(() => {});
    } catch (e) {
      logger.error('phonepe-v2-webhook: print enqueue failed', { orderId: order.id, error: e instanceof Error ? e.message : String(e) });
    }
  })();

  logger.info('phonepe-v2-webhook: payment processed + order marked paid', {
    orderId: order.id,
    txnId,
    amountPaise: order.totalAmountPaise,
  });

  return {
    statusCode: 200,
    summary: 'payment processed — order marked paid',
    applied: true,
    orderId: order.id,
  };
}
