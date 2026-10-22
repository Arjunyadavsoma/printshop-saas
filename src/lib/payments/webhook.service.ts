import type { PaymentProvider } from '@platform/core/domain';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ensurePrintHandler, dispatchToAgent } from '@/lib/services/print.service';
import { ValidationError, NotFoundError } from '@platform/core/errors';
import { canTransitionOrder } from '@platform/core/domain';
import { shopChannel } from '@platform/core/interfaces';

/** A merchant-order-id → order mapping stored at checkout so the webhook
 *  can find the order without trusting the (unverified) payload. */
const SESSION_TTL = 600; // 10 minutes — covers a typical UPI/PSP payment flow

export interface StoredPaymentSession {
  orderId: string;
  shopId: string;
  amountPaise: number;
  provider: PaymentProvider;
}

/** Called by the checkout route — remembers which order a merchantOrderId maps to. */
export async function rememberPaymentSession(merchantOrderId: string, session: StoredPaymentSession): Promise<void> {
  await getContainer().cache.set(`pay:moid:${merchantOrderId}`, JSON.stringify(session), SESSION_TTL);
}

/** Look up the payment session by the merchantOrderId extracted from the payload. */
export async function lookupPaymentSession(merchantOrderId: string): Promise<StoredPaymentSession | null> {
  const raw = await getContainer().cache.get(`pay:moid:${merchantOrderId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPaymentSession;
  } catch {
    return null;
  }
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

  // Failed payment: leave the order in awaiting_payment (allows retry).
  if (!v.paid) {
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

  // 5. Idempotency: if we've already processed this txnId, skip.
  const processedKey = `pay:done:${input.provider}:${v.txnId ?? merchantOrderId}`;
  if (v.txnId && (await container.cache.get(processedKey))) {
    logger.info('webhook: idempotent skip (already processed)', { txnId: v.txnId });
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: 'idempotent — already processed (no-op)',
      applied: false,
      orderId: session.orderId,
    };
  }

  // 6. Validate amount + state transition.
  const order = await repos.orders.findById(session.orderId);
  if (!order) {
    return { statusCode: 404, summary: 'order not found', applied: false };
  }
  if (order.shopId !== shop.id) {
    logger.error('webhook: tenant mismatch', { orderShopId: order.shopId, webhookShopId: shop.id });
    return { statusCode: 403, summary: 'tenant mismatch', applied: false };
  }
  if (v.amountPaise !== null && v.amountPaise !== order.totalAmountPaise) {
    logger.warn('webhook: amount mismatch', { expected: order.totalAmountPaise, got: v.amountPaise });
    return {
      statusCode: 400,
      responseBody: result.responseBody,
      summary: `amount mismatch (expected ${order.totalAmountPaise}, got ${v.amountPaise})`,
      applied: false,
      orderId: session.orderId,
    };
  }
  if (!canTransitionOrder(order.status, 'paid')) {
    // Already paid (or beyond) — idempotent.
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: `order already in status '${order.status}' (idempotent)`,
      applied: false,
      orderId: session.orderId,
    };
  }

  // 7. Flip to paid. The UNIQUE(payment_txn_id) constraint is the final
  //    replay guard — a concurrent duplicate would fail here.
  try {
    await repos.orders.update(order.id, {
      status: 'paid',
      paidAt: new Date(),
      paymentTxnId: v.txnId,
      paymentUtr: v.utr,
      paymentProvider: input.provider,
    });
  } catch (err) {
    // A UNIQUE-constraint violation means this txn was already applied
    // (e.g., concurrent webhook) — treat as idempotent.
    logger.info('webhook: payment_txn_id already exists (idempotent)', { txnId: v.txnId, err: String(err) });
    return {
      statusCode: 200,
      responseBody: result.responseBody,
      summary: 'payment_txn_id already applied (idempotent)',
      applied: false,
      orderId: session.orderId,
    };
  }

  // 8. Mark processed + audit.
  if (v.txnId) await container.cache.set(processedKey, order.id, 86400); // 24h
  await repos.audit.log({
    shopId: shop.id,
    userId: null,
    action: `webhook.${input.provider}.paid`,
    entityType: 'order',
    entityId: order.id,
    metadata: { txnId: v.txnId, utr: v.utr, amountPaise: order.totalAmountPaise },
    ip: input.ip ?? null,
  });
  logger.info('webhook: order marked paid', { orderId: order.id, provider: input.provider, txnId: v.txnId });

  // Push a realtime event so the dashboard queue updates the moment a payment
  // lands (no polling needed for the happy path).
  void container.realtime.publish(shopChannel(shop.id), 'order.paid', { orderId: order.id, amountPaise: order.totalAmountPaise }).catch(() => {});

  // Auto-dispatch to print now that the order is paid (Phase 6's agent would
  // pick this up via the realtime channel; here we enqueue directly).
  ensurePrintHandler();
  void enqueuePaidOrderPrint(order.id, shop.id).catch((e) =>
    logger.error('webhook: failed to enqueue print', { orderId: order.id, err: String(e) }),
  );

  return {
    statusCode: result.statusCode,
    responseBody: result.responseBody,
    summary: `order ${order.customerToken} marked paid via ${input.provider} (txn ${v.txnId})`,
    applied: true,
    orderId: order.id,
  };
}

export async function enqueuePaidOrderPrint(orderId: string, shopId: string): Promise<void> {
  const container = getContainer();
  const files = await repos.files.findByOrder(orderId);
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued');
  for (const f of pending) {
    // IDEMPOTENT JOB CREATION — two-layer guard:
    //
    // Layer 1 (application, fast path): check findActiveByFile() before
    // inserting. Handles the common case (sequential retry) without
    // needing to catch a DB error.
    //
    // Layer 2 (database, race-safe): a PostgreSQL partial unique index
    // (PrintJob_active_file_unique ON "PrintJob"("fileId") WHERE status
    // IN ('queued','printing')) enforces that at most one ACTIVE job per
    // file exists. If two concurrent calls both pass Layer 1 (both observe
    // no active job) and both INSERT, the DB rejects the second with a
    // unique constraint violation (Prisma P2002 / Postgres 23505). We catch
    // it and treat the existing job as the winner (re-dispatch, no dup).
    //
    // 'completed' and 'needs_review' jobs do NOT block — a shopkeeper
    // manually re-queuing a file SHOULD get a new PrintJob (the partial
    // index's WHERE clause excludes these statuses).
    const existing = await repos.printJobs.findActiveByFile(f.id);
    if (existing) {
      await dispatchToAgent(shopId, existing.id, f.id);
      continue;
    }
    try {
      const job = await repos.printJobs.create({ shopId, fileId: f.id });
      if (process.env.NODE_ENV !== 'production') {
        await container.queue.enqueue('print', { jobId: job.id, fileId: f.id, shopId });
      }
      await dispatchToAgent(shopId, job.id, f.id);
    } catch (e) {
      // Layer 2: a concurrent call won the INSERT — treat as idempotent.
      if (isUniqueConstraintError(e)) {
        const winner = await repos.printJobs.findActiveByFile(f.id);
        if (winner) {
          await dispatchToAgent(shopId, winner.id, f.id);
        }
        // If winner is null here, the concurrent job was claimed + advanced
        // past 'printing' between our INSERT-fail and this re-check — that's
        // fine, the agent is already handling it.
        continue;
      }
      throw e; // re-throw non-unique-constraint errors (real failures)
    }
  }
  if (pending.length > 0) {
    await repos.orders.update(orderId, { status: 'printing' });
  }
}

/**
 * Detect a unique-constraint violation from Prisma (P2002) or the raw
 * PostgreSQL driver (code 23505). Used by enqueuePaidOrderPrint to handle
 * the concurrent-INSERT race on the partial unique index.
 */
function isUniqueConstraintError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  // Prisma P2002 = unique constraint violation
  if (err.code === 'P2002') return true;
  // PostgreSQL SQLSTATE 23505 = unique_violation
  if (err.code === '23505') return true;
  // Fallback: check the message (some adapters surface it as a string)
  if (typeof err.message === 'string') {
    return /unique constraint/i.test(err.message) || /duplicate key/i.test(err.message);
  }
  return false;
}
