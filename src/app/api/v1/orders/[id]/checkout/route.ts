import { type NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { withOrderAccess } from '@/lib/api/with-order-access';
import { NotFoundError, ValidationError } from '@platform/core/errors';
import { rememberPaymentSession } from '@/lib/payments/webhook.service';
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
 * Sequence:
 * 1. Authenticate (withOrderAccess)
 * 2. Validate order status + payment eligibility
 * 3. Generate merchantOrderId internally
 * 4. Persist PaymentAttempt (FAIL-CLOSED: abort if persistence fails)
 * 5. Contact provider adapter (only after successful persistence)
 * 6. Cache merchantOrderId → order mapping
 * 7. Return checkout response
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
    const unpaid = files.filter((f) => f.pricePaise === 0);
    if (unpaid.length > 0) {
      throw new ValidationError(`${unpaid.length} file(s) have no price — set print settings first`);
    }

    const container = getContainer();

    // ── STEP 1: Generate merchantOrderId BEFORE contacting provider ──
    // This is the FIND-PAY-001-ORDER fix: generate the internal reference
    // first, persist it, then pass it to the adapter.
    const merchantOrderId = crypto.randomUUID();

    // ── STEP 2: Persist PaymentAttempt BEFORE provider contact ──
    // FAIL-CLOSED: if persistence fails (non-duplicate), abort checkout.
    // The provider is NEVER contacted without a durable record.
    try {
      await (db as any).paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          shopId: shop.id,
          orderId: order.id,
          provider: shop.paymentProvider,
          merchantOrderId,
          amountPaise: order.totalAmountPaise,
          currency: 'INR',
          status: 'created',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10-min payment window
        },
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        // Duplicate merchantOrderId — extremely unlikely (UUID collision).
        // Treat as a retry: the existing attempt is still valid.
        // Fall through to provider contact with the same merchantOrderId.
      } else {
        // Persistence failed — ABORT checkout. Do not contact the provider
        // without a durable PaymentAttempt record.
        throw new Error('Payment attempt could not be persisted to the database. Checkout aborted for safety.');
      }
    }

    // ── STEP 3: Contact provider adapter (ONLY after successful persistence) ──
    // Pass the pre-generated merchantOrderId so the adapter uses ours.
    const adapter = container.paymentRegistry.get(shop.paymentProvider);
    const intent = await adapter.createPaymentIntent({
      orderId: order.id,
      amountPaise: order.totalAmountPaise,
      shopUpiId: shop.upiId,
      shopName: shop.name,
      customerToken: order.customerToken,
      shopCredentials: shop.paymentCredentials,
      merchantOrderId, // ← pre-generated, already persisted
    });

    // FALLBACK: if the provider adapter didn't return a upiUri, generate
    // a UPI deep-link from the shop's UPI ID.
    if (!intent.upiUri && shop.upiId) {
      const upiParams = new URLSearchParams();
      upiParams.set('pa', shop.upiId);
      upiParams.set('pn', shop.name);
      upiParams.set('am', (order.totalAmountPaise / 100).toFixed(2));
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
      amountPaise: order.totalAmountPaise,
      provider: shop.paymentProvider,
    });

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.checkout',
      entityType: 'order',
      entityId: order.id,
      metadata: { amountPaise: order.totalAmountPaise, provider: intent.provider, merchantOrderId: intent.merchantOrderId },
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
