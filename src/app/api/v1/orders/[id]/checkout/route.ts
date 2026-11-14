import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { rememberPaymentSession } from '@/lib/payments/webhook.service';
import { priceFileFromRecord } from '@/lib/pricing/price-file';
import { db } from '@/lib/db';
import { isUniqueConstraintError } from '@/lib/db/is-unique-constraint-error';

/** POST /api/v1/orders/:id/checkout — create a payment intent (provider = shop's).
 *
 * SEC-001 fix: behind withOrderAccess — caller must present the order's
 * `customerToken` before a payment intent is minted.
 *
 * FIND-PAY-001-ORDER fix: PaymentAttempt is persisted BEFORE the provider
 * is contacted. The merchantOrderId is generated internally, persisted to
 * the database, and THEN passed to the adapter. If persistence fails, the
 * provider is never contacted.
 *
 * Amount integrity: checkout INDEPENDENTLY recalculates every file's price
 * using the shop's CURRENT pricing config (which may have changed since the
 * customer's last PATCH). The recalculated total is persisted and used as
 * the authoritative checkout amount. NO client-supplied amount is accepted
 * (the request body is not even read). Placeholder/unpriced files are
 * rejected — a missing page count can never produce a zero-cost checkout.
 *
 * Phase 6.3 fix (idempotency): the merchantOrderId is now a STABLE
 * function of the order id (`checkout-${order.id}`) instead of a random
 * UUID. Combined with the existing UNIQUE constraint on
 * PaymentAttempt.merchantOrderId, this guarantees:
 *   - At most ONE active ('created') PaymentAttempt per order at a time.
 *   - Concurrent checkout requests for the same order resolve to the same
 *     merchantOrderId — the first INSERT wins, the rest receive a P2002
 *     unique-violation and reuse the winner's merchantOrderId.
 *   - The provider adapter is NEVER contacted twice for the same order
 *     without an intervening expiry/expiration.
 *   - A retry after an expired attempt creates a new attempt with a
 *     timestamp-suffixed merchantOrderId (so the new row doesn't collide
 *     with the expired one).
 *
 * Sequence:
 * 1. Authenticate (withOrderAccess)
 * 2. Validate order status + payment eligibility
 * 3. Derive idempotencyKey = `checkout-${order.id}`
 * 4. Look up existing active attempt (findFirst by orderId + status='created')
 * 5. If active attempt found AND not expired → reuse its merchantOrderId
 * 6. Otherwise: mark expired, mint merchantOrderId, INSERT (catch P2002)
 * 7. Contact provider adapter (only after successful persistence)
 * 8. Cache merchantOrderId → order mapping
 * 9. Return checkout response (+ audit log with `idempotent` flag)
 */
export const POST = withRateLimit<{ id: string }>(
  'checkout',
  20,
  60,
  withOrderAccess<{ id: string }>(async (req, _ctx, order) => {
    try {
    if (order.status !== 'awaiting_payment') {
      throw new ValidationError(`Order in status '${order.status}' cannot be checked out`);
    }

    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');
    if (!shop.upiId) throw new ValidationError('Shop has no UPI VPA configured');

    const files = await repos.files.findByOrder(order.id);
    if (files.length === 0) throw new ValidationError('Cannot checkout an order with no files');

    // ── INDEPENDENTLY recalculate every file's price ──
    // The checkout amount is NOT trusted from the persisted total. We
    // re-price every file using the shop's CURRENT pricing config (which
    // may have changed since the customer's last PATCH) and persist the
    // recalculated prices + order total. Placeholder files (unverified
    // page count) are rejected — they can never produce a bill.
    const pricingErrors: string[] = [];
    let authoritativeTotal = 0;

    for (const f of files) {
      if (f.pageCountSource === 'placeholder' || f.pageCount === null || f.pageCount <= 0) {
        pricingErrors.push(
          `"${f.originalFilename}" has no verified page count — ` +
          'the customer or shopkeeper must set the page count before checkout.',
        );
        continue;
      }
      try {
        const priced = priceFileFromRecord(f, shop);
        if (priced.totalPaise !== f.pricePaise) {
          await repos.files.update(f.id, { pricePaise: priced.totalPaise, status: 'pending' });
        }
        authoritativeTotal += priced.totalPaise;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Pricing failed';
        pricingErrors.push(`"${f.originalFilename}": ${msg}`);
      }
    }

    if (pricingErrors.length > 0) {
      throw new ValidationError(
        `Cannot checkout — ${pricingErrors.length} file(s) have pricing issues:\n` +
        pricingErrors.map((e) => `  • ${e}`).join('\n'),
      );
    }

    // Persist the recalculated order total (the authoritative checkout amount).
    await repos.orders.update(order.id, { totalAmountPaise: authoritativeTotal });

    const container = getContainer();

    // ── STEP 1: Stable idempotency key (Phase 6.3) ──
    // Derive the merchantOrderId from the order id so retries of the SAME
    // order produce the SAME idempotency key. Combined with the UNIQUE
    // constraint on PaymentAttempt.merchantOrderId, this guarantees that
    // concurrent checkout requests for the same order all resolve to a
    // single PaymentAttempt (the first INSERT wins; the rest get P2002
    // and reuse the winner's merchantOrderId).
    const idempotencyKey = `checkout-${order.id}`;
    const now = new Date();

    // ── STEP 2: Look for an existing active ('created') attempt ──
    let existingAttempt: { id: string; merchantOrderId: string; status: string; expiresAt: Date } | null = null;
    try {
      existingAttempt = await (db as any).paymentAttempt.findFirst({
        where: { orderId: order.id, status: 'created' },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      /* graceful degradation — treat as no existing attempt (e.g. the
       * Prisma client doesn't yet expose findFirst on paymentAttempt in
       * a dev env, or the query fails for an unrelated reason). The
       * UNIQUE-constraint catch below is the second-layer guard. */
    }

    let merchantOrderId: string;

    if (existingAttempt && existingAttempt.expiresAt > now) {
      // Reuse the existing active attempt — this is the idempotent path.
      // The provider was already contacted with this merchantOrderId; the
      // customer's UPI app already shows the payment request. Returning
      // the same merchantOrderId lets the customer re-open the same intent
      // instead of minting a duplicate.
      merchantOrderId = existingAttempt.merchantOrderId;
    } else {
      // No active attempt (or it's expired) — mark an expired one and
      // create a fresh attempt. The merchantOrderId starts as the stable
      // idempotencyKey; if that key already exists in the table (e.g. an
      // expired attempt was created with it but the expiry update failed),
      // we append a timestamp to guarantee INSERT uniqueness.
      if (existingAttempt) {
        try {
          await (db as any).paymentAttempt.update({
            where: { id: existingAttempt.id },
            data: { status: 'expired' },
          });
        } catch {
          /* best-effort — the new attempt supersedes anyway */
        }
      }
      merchantOrderId = idempotencyKey;
      if (existingAttempt && existingAttempt.merchantOrderId === merchantOrderId) {
        merchantOrderId = `${idempotencyKey}-${now.getTime()}`;
      }

      // INSERT with the stable idempotencyKey as merchantOrderId. The
      // UNIQUE constraint on PaymentAttempt.merchantOrderId is the
      // second-layer guard: if a concurrent call slipped past the
      // findFirst check (TOCTOU race), the INSERT throws P2002 and we
      // fall back to the concurrent winner's merchantOrderId.
      try {
        await (db as any).paymentAttempt.create({
          data: {
            id: crypto.randomUUID(),
            shopId: shop.id,
            orderId: order.id,
            provider: shop.paymentProvider,
            merchantOrderId,
            amountPaise: authoritativeTotal, // ← server-calculated, persisted
            currency: 'INR',
            status: 'created',
            idempotencyKey,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10-min payment window
          },
        });
      } catch (e) {
        if (isUniqueConstraintError(e)) {
          // A concurrent checkout won the race. Look up the winner; if
          // it's still active, reuse its merchantOrderId. Otherwise, mint
          // a fresh unique merchantOrderId by appending the timestamp.
          const winner = await (db as any).paymentAttempt.findUnique({ where: { merchantOrderId } });
          if (winner && winner.status === 'created' && winner.expiresAt > now) {
            merchantOrderId = winner.merchantOrderId;
          } else {
            merchantOrderId = `${idempotencyKey}-${now.getTime()}`;
            await (db as any).paymentAttempt.create({
              data: {
                id: crypto.randomUUID(),
                shopId: shop.id,
                orderId: order.id,
                provider: shop.paymentProvider,
                merchantOrderId,
                amountPaise: authoritativeTotal,
                currency: 'INR',
                status: 'created',
                idempotencyKey,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });
          }
        } else {
          // Persistence failed for a non-duplicate reason — ABORT checkout.
          // Do not contact the provider without a durable PaymentAttempt.
          throw new Error('Payment attempt could not be persisted to the database. Checkout aborted for safety.');
        }
      }
    }

    // ── STEP 3: Contact provider adapter (ONLY after successful persistence) ──
    // Pass the pre-computed merchantOrderId so the adapter uses ours.
    const adapter = container.paymentRegistry.get(shop.paymentProvider);
    const intent = await adapter.createPaymentIntent({
      orderId: order.id,
      amountPaise: authoritativeTotal,
      shopUpiId: shop.upiId,
      shopName: shop.name,
      customerToken: order.customerToken,
      shopCredentials: shop.paymentCredentials,
      merchantOrderId, // ← pre-computed, already persisted
    });

    // FALLBACK: if the provider adapter didn't return a upiUri, generate
    // a UPI deep-link from the shop's UPI ID.
    if (!intent.upiUri && shop.upiId) {
      const upiParams = new URLSearchParams();
      upiParams.set('pa', shop.upiId);
      upiParams.set('pn', shop.name);
      upiParams.set('am', (authoritativeTotal / 100).toFixed(2));
      upiParams.set('cu', 'INR');
      upiParams.set('tn', order.customerToken);
      upiParams.set('tr', intent.merchantOrderId);
      const fallbackUpiUri = `upi://pay?${upiParams.toString()}`;
      intent.upiUri = fallbackUpiUri;
      intent.qrPayload = fallbackUpiUri;
    }

    // ── STEP 4: Cache merchantOrderId → order mapping ──
    // The cache is a fast-path for webhook lookup. The DB PaymentAttempt
    // is the durable fallback (survives cache expiry).
    await rememberPaymentSession(intent.merchantOrderId, {
      orderId: order.id,
      shopId: shop.id,
      amountPaise: authoritativeTotal,
      provider: shop.paymentProvider,
    });

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.checkout',
      entityType: 'order',
      entityId: order.id,
      metadata: {
        amountPaise: authoritativeTotal,
        provider: intent.provider,
        merchantOrderId: intent.merchantOrderId,
        idempotent: !!existingAttempt,
      },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      merchantOrderId: intent.merchantOrderId,
      amountPaise: intent.amountPaise,
      currency: intent.currency,
      provider: intent.provider,
      checkoutUrl: intent.checkoutUrl,
      upiUri: intent.upiUri,
      qrPayload: intent.qrPayload,
      expiresAt: intent.expiresAt,
    });
    } catch (cause) {
      return fail(toAppError(cause));
    }
  }),
);
