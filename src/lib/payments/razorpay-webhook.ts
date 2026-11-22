import { createHmac, timingSafeEqual } from 'node:crypto';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { lookupPaymentSession } from '@/lib/payments/webhook.service';
import { applyPaymentTransition } from '@/lib/payments/lifecycle.service';
import { enqueuePaidOrderPrint } from '@/lib/payments/webhook.service';
import { canTransitionOrder } from '@platform/core/domain';

/**
 * Razorpay webhook + checkout-success processing — mirrors the hardened
 * PhonePe v2 pipeline (signature verify → resolve → tenant/amount checks →
 * idempotency cache → PAY-003 fail-closed server re-verification → atomic
 * transition → audit → print enqueue). Money goes to the shopkeeper's own
 * Razorpay account; the platform never touches funds.
 */

type Logger = { info: (m: string, d?: Record<string, unknown>) => void; warn: (m: string, d?: Record<string, unknown>) => void; error: (m: string, d?: Record<string, unknown>) => void };

interface RazorpayWebhookBody {
  event?: string;
  payload?: { payment?: { entity?: Record<string, unknown> } };
}

/** Resolve {merchantOrderId, shopId} from an (untrusted) merchantOrderId —
 *  the cache first, then the durable PaymentAttempt row. */
async function resolveSession(merchantOrderId: string): Promise<{ orderId: string; shopId: string; amountPaise: number } | null> {
  const cached = await lookupPaymentSession(merchantOrderId);
  if (cached) return cached;
  const db = getContainer().db as unknown as {
    paymentAttempt: { findUnique: (a: { where: { merchantOrderId: string } }) => Promise<{ orderId: string; shopId: string; amountPaise: number } | null> };
  };
  const attempt = await db.paymentAttempt.findUnique({ where: { merchantOrderId } });
  if (!attempt) return null;
  return { orderId: attempt.orderId, shopId: attempt.shopId, amountPaise: attempt.amountPaise };
}

/** Shared post-verification completion (webhook + checkout-success). */
async function completePaidPayment(input: {
  merchantOrderId: string;
  gatewayOrderId: string | null;
  txnId: string;
  utr: string | null;
  amountPaise: number | null;
  eventId: string;
  source: 'webhook' | 'checkout';
  ip: string | null;
  logger: Logger;
}): Promise<{ statusCode: number; summary: string; applied: boolean; orderId?: string }> {
  const { logger } = input;
  const container = getContainer();
  const session = await resolveSession(input.merchantOrderId);
  if (!session) {
    logger.warn('razorpay: session not found for merchantOrderId', { merchantOrderId: input.merchantOrderId });
    return { statusCode: 404, summary: 'session expired or unknown merchantOrderId', applied: false };
  }
  const shop = await repos.shops.findById(session.shopId);
  const order = await repos.orders.findById(session.orderId);
  if (!shop || !order) return { statusCode: 404, summary: 'shop or order not found', applied: false };
  if (order.shopId !== shop.id) {
    logger.error('razorpay: tenant mismatch', { orderShopId: order.shopId, webhookShopId: shop.id });
    return { statusCode: 403, summary: 'tenant mismatch', applied: false };
  }
  // Amount validation — MANDATORY, against the server-computed total.
  if (input.amountPaise != null && input.amountPaise !== order.totalAmountPaise) {
    logger.warn('razorpay: amount mismatch', { expected: order.totalAmountPaise, got: input.amountPaise });
    return { statusCode: 400, summary: `amount mismatch (expected ${order.totalAmountPaise}, got ${input.amountPaise})`, applied: false };
  }
  if (!canTransitionOrder(order.status, 'paid')) {
    return { statusCode: 200, summary: `order already in status '${order.status}' (idempotent)`, applied: false, orderId: order.id };
  }
  const processedKey = `pay:done:razorpay:${input.txnId}`;
  if (await container.cache.get(processedKey)) {
    return { statusCode: 200, summary: 'idempotent — already processed', applied: false, orderId: order.id };
  }

  // PAY-003 fail-closed: re-verify with Razorpay's server BEFORE transitioning.
  try {
    const adapter = container.paymentRegistry.get('razorpay');
    const verification = await adapter.verifyPayment({
      merchantOrderId: input.merchantOrderId,
      gatewayOrderId: input.gatewayOrderId ?? undefined,
      shopCredentials: shop.paymentCredentials,
    });
    if (!verification || !verification.paid) {
      logger.warn('razorpay: server verification returned not-paid', { merchantOrderId: input.merchantOrderId });
      return { statusCode: 200, summary: 'server verification: payment not confirmed', applied: false, orderId: order.id };
    }
  } catch (verifyErr) {
    logger.error('razorpay: verification failed — payment held pending for reconciliation', {
      merchantOrderId: input.merchantOrderId,
      error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
    });
    return { statusCode: 200, summary: 'verification unavailable — payment held pending for reconciliation', applied: false, orderId: order.id };
  }

  const transitionResult = await applyPaymentTransition({
    merchantOrderId: input.merchantOrderId,
    provider: 'razorpay',
    providerTxnId: input.txnId,
    providerUtr: input.utr,
    amountPaise: order.totalAmountPaise,
    currency: 'INR',
    paid: true,
    eventId: input.eventId,
    source: 'webhook' as const,
    shopId: shop.id,
    orderId: order.id,
  });
  if (!transitionResult.applied) {
    return { statusCode: 200, summary: transitionResult.reason, applied: false, orderId: order.id };
  }

  await container.cache.set(processedKey, order.id, 86400);
  await repos.audit.log({
    shopId: shop.id,
    userId: null,
    action: `webhook.razorpay.${input.source === 'webhook' ? 'paid' : 'checkout-paid'}`,
    entityType: 'order',
    entityId: order.id,
    metadata: { txnId: input.txnId, utr: input.utr, amountPaise: order.totalAmountPaise },
    ip: input.ip,
  });
  enqueuePaidOrderPrint(order.id, shop.id);
  void container.realtime.publish(`shop:${shop.id}:orders`, 'order.paid', { orderId: order.id }).catch(() => {});
  return { statusCode: 200, summary: 'payment confirmed — order paid, printing enqueued', applied: true, orderId: order.id };
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(rawBody, shop.webhookSecret). */
export async function processRazorpayWebhook(
  rawBody: string,
  signatureHeader: string | null,
  ip: string | null,
): Promise<{ statusCode: number; summary: string; applied: boolean }> {
  const logger = getContainer().logger;
  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return { statusCode: 400, summary: 'malformed JSON', applied: false };
  }
  const entity = body.payload?.payment?.entity ?? {};
  // Untrusted extraction — used ONLY to find the shop whose secret verifies.
  const merchantOrderId =
    ((entity.notes as Record<string, unknown> | undefined)?.merchantOrderId as string) ||
    (entity.receipt as string) ||
    (entity.order_id as string) ||
    '';
  if (!merchantOrderId) {
    logger.warn('razorpay webhook: no merchantOrderId/receipt in payload', { ip });
    return { statusCode: 400, summary: 'no merchantOrderId in payload', applied: false };
  }
  const session = await resolveSession(merchantOrderId);
  if (!session) {
    return { statusCode: 404, summary: 'session expired or unknown merchantOrderId', applied: false };
  }
  const shop = await repos.shops.findById(session.shopId);
  if (!shop) return { statusCode: 404, summary: 'shop not found', applied: false };
  const rzpCreds = (shop.paymentCredentials as Record<string, Record<string, unknown>>)?.razorpay;
  if (!rzpCreds?.webhookSecret) {
    return { statusCode: 503, summary: 'webhook secret not configured for this shop', applied: false };
  }
  const expected = createHmac('sha256', String(rzpCreds.webhookSecret)).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn('razorpay webhook: signature verification failed', { ip });
    return { statusCode: 400, summary: 'invalid signature', applied: false };
  }

  const event = body.event ?? '';
  if (event !== 'payment.captured' && event !== 'order.paid') {
    // refunds / failures recorded honestly — never mark paid
    logger.info('razorpay webhook: non-crediting event', { event });
    return { statusCode: 200, summary: `event '${event}' recorded (order NOT marked paid)`, applied: false };
  }
  const acq = (entity.acquirer_data ?? {}) as Record<string, unknown>;
  return completePaidPayment({
    merchantOrderId,
    gatewayOrderId: (entity.order_id as string) ?? null,
    txnId: String(entity.id ?? ''),
    utr: (acq.rrn as string) ?? (acq.upi_transaction_id as string) ?? String(entity.id ?? ''),
    amountPaise: entity.amount != null ? Number(entity.amount) : null,
    eventId: String(entity.id ?? merchantOrderId),
    source: 'webhook',
    ip,
    logger,
  });
}

/** Checkout.js success handler — verify HMAC(order_id|payment_id) then the
 *  same fail-closed completion as the webhook. */
export async function processRazorpayCheckoutSuccess(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  merchantOrderId: string | null;
  ip: string | null;
}): Promise<{ statusCode: number; summary: string; applied: boolean; orderId?: string }> {
  const logger = getContainer().logger;
  const session = await resolveSession(input.merchantOrderId || input.razorpayOrderId);
  if (!session) {
    return { statusCode: 404, summary: 'unknown payment session', applied: false };
  }
  const shop = await repos.shops.findById(session.shopId);
  if (!shop) return { statusCode: 404, summary: 'shop not found', applied: false };
  const rzpCreds = (shop.paymentCredentials as Record<string, Record<string, unknown>>)?.razorpay;
  if (!rzpCreds?.keySecret) {
    return { statusCode: 503, summary: 'Razorpay not configured for this shop', applied: false };
  }
  const expected = createHmac('sha256', String(rzpCreds.keySecret))
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');
  const a = Buffer.from(input.razorpaySignature ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn('razorpay checkout: signature verification failed', { ip: input.ip });
    return { statusCode: 400, summary: 'invalid signature', applied: false };
  }
  return completePaidPayment({
    merchantOrderId: input.merchantOrderId || input.razorpayOrderId,
    gatewayOrderId: input.razorpayOrderId,
    txnId: input.razorpayPaymentId,
    utr: input.razorpayPaymentId,
    amountPaise: null, // re-verification fetches the authoritative amount
    eventId: `checkout:${input.razorpayPaymentId}`,
    source: 'checkout',
    ip: input.ip,
    logger,
  });
}
