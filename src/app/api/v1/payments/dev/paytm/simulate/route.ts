import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { requireDev } from '@/lib/api/require-dev';
import { NotFoundError } from '@platform/core/errors';
import { processWebhook } from '@/lib/payments/webhook.service';
import { generatePaytmChecksum } from '@platform/adapters';

const SimulateSchema = z.object({
  orderId: z.string().uuid(),
  outcome: z.enum(['paid', 'failed']).default('paid'),
});

/**
 * POST /api/v1/payments/dev/paytm/simulate — DEV ONLY.
 *
 * Signs a Paytm callback (CHECKSUMHASH) with the shop's dev merchant key and
 * feeds it through the REAL processWebhook pipeline. Returns the HTML page
 * Paytm would render back to the customer.
 */
export const POST = withRateLimit('paytm-simulate', 20, 60, async (req, _ctx) => {
  const guard = requireDev();
  if (guard) return guard;
  try {
    const body = SimulateSchema.parse(await req.json());
    const order = await repos.orders.findById(body.orderId);
    if (!order) throw new NotFoundError('Order not found');
    const shop = await repos.shops.findById(order.shopId);
    if (!shop) throw new NotFoundError('Shop not found');

    const creds = (shop.paymentCredentials.paytm ?? {}) as { merchantId: string; merchantKey: string };
    if (!creds.merchantKey) {
      throw new NotFoundError('Shop has no Paytm dev credentials — re-seed');
    }

    const txnId = 'P' + Date.now().toString(36).toUpperCase();
    const params: Record<string, string> = {
      MID: creds.merchantId,
      ORDERID: order.id,
      TXNID: txnId,
      BANKNAME: 'DEMOBANK',
      TXNAMOUNT: (order.totalAmountPaise / 100).toFixed(2),
      CURRENCY: 'INR',
      STATUS: body.outcome === 'paid' ? 'TXN_SUCCESS' : 'TXN_FAILURE',
      RESPMSG: body.outcome === 'paid' ? 'Txn Successful' : 'Txn Failed',
      BANKTXNID: txnId,
    };
    const checksum = await generatePaytmChecksum(params, creds.merchantKey);
    params.CHECKSUMHASH = checksum;
    const formBody = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const result = await processWebhook({
      provider: 'paytm',
      rawBody: formBody,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      path: '/api/v1/payments/paytm/callback',
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      sent: { txnId, checksumPrefix: checksum.slice(0, 16) + '…', outcome: body.outcome },
      processed: {
        statusCode: result.statusCode,
        summary: result.summary,
        applied: result.applied,
        orderId: result.orderId,
        htmlRendered: result.responseBody ? result.responseBody.slice(0, 120) + '…' : null,
      },
      note: 'real CHECKSUMHASH (AES-128-CBC + SHA-256) computed with the shop dev key; processWebhook verified it.',
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
