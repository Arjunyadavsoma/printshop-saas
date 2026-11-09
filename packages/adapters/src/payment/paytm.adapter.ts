import { UPIPay } from 'upipay';
import {
  createCipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type {
  PaymentAdapter,
  PaymentIntent,
  PaymentVerification,
  RefundInput,
  RefundResult,
  WebhookInput,
  WebhookResult,
} from '@platform/core/interfaces';
import type { PaymentProvider } from '@platform/core/domain';

/** Paytm merchant credentials stored (encrypted-at-rest in prod) on the Shop. */
export interface PaytmCredentials {
  merchantId: string;
  merchantKey: string;
  website: string; // e.g. 'WEBSTAGING' (sandbox) or 'DEFAULT' (prod)
  industryType?: string;
  channelId?: string;
  /** 'prod' | 'sandbox' — selects the Paytm gateway host. */
  env?: 'prod' | 'sandbox';
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 5.3 — Official Paytm checksum algorithm
//
// The hand-rolled implementation that was here before used IV
// `0123456789012345`, embedded the merchantKey in the SHA-256 input, used no
// salt, and compared with `===` (not constant-time). Real Paytm production
// callbacks — signed by Paytm with the OFFICIAL algorithm — would FAIL
// verification by that code.
//
// The official Paytm Node Checksum algorithm (mirrored from the `upipay` SDK
// at node_modules/upipay/dist/adapters/paytm.js) is:
//
//   1. salt = randomBytes(4).toString('hex').slice(0, 4)   // 4-char hex
//   2. paramsString = sorted param VALUES joined by '|' (no keys, no
//      merchantKey, no CHECKSUMHASH)
//   3. hash = sha256(paramsString + '|' + salt)             // 64-char hex
//   4. plaintext = hash + salt                              // 68 chars
//   5. key = merchantKey.slice(0, 16)                       // first 16 bytes
//   6. ciphertext = AES-128-CBC(plaintext, key, IV='@@@@&&&&####$$$$')
//   7. CHECKSUMHASH = base64(ciphertext)
//
// Verification is the inverse: decrypt, split hash (first 64) + salt (last 4),
// recompute sha256(paramsString + '|' + salt), compare with timingSafeEqual.
//
// Production webhook verification delegates to `upipay`'s `verifyWebhook`
// (which implements the same algorithm + handles form-urlencoded parsing +
// CHECKSUMHASH extraction internally). `generatePaytmChecksum` is kept for
// the dev simulate route + known-vector tests.
// ──────────────────────────────────────────────────────────────────────────

/** Official Paytm IV (16 ASCII chars). */
const PAYTM_IV = Buffer.from('@@@@&&&&####$$$$', 'utf8');

/** Build the params string: sorted param VALUES joined by '|', excluding
 *  CHECKSUMHASH. This matches the official Paytm Node Checksum library. */
function paytmParamsValuesString(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CHECKSUMHASH')
    .sort();
  return keys.map((k) => params[k]).join('|');
}

/** Derive the 16-byte AES-128 key from the merchant key (first 16 bytes). */
function paytmAesKey(merchantKey: string): Buffer {
  return Buffer.from(merchantKey.slice(0, 16), 'utf8');
}

/**
 * Generate a CHECKSUMHASH using the OFFICIAL Paytm algorithm.
 *
 * Used by:
 *   - `/api/v1/payments/dev/paytm/simulate` route (signs dev callbacks)
 *   - Known-vector tests in `src/lib/payments/paytm-checksum.test.ts`
 *
 * NOT used in production webhook verification — production delegates to
 * `upipay`'s `verifyWebhook` (see `handleWebhook` below).
 */
export async function generatePaytmChecksum(
  params: Record<string, string>,
  merchantKey: string,
): Promise<string> {
  if (merchantKey.length < 16) {
    throw new Error(
      `Paytm: merchantKey must be at least 16 characters (got ${merchantKey.length}). ` +
        `Real Paytm merchant keys are 32-char hex strings.`,
    );
  }
  const salt = randomBytes(4).toString('hex').slice(0, 4);
  const paramsString = paytmParamsValuesString(params);
  const hash = createHash('sha256').update(paramsString + '|' + salt, 'utf8').digest('hex');
  const plaintext = hash + salt; // 68 chars
  const key = paytmAesKey(merchantKey);
  const cipher = createCipheriv('aes-128-cbc', key, PAYTM_IV);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

/**
 * Verify a CHECKSUMHASH using the OFFICIAL Paytm algorithm with
 * constant-time comparison.
 *
 * This is exported for known-vector tests. Production webhook verification
 * delegates to `upipay`'s `verifyWebhook` instead (which calls this same
 * algorithm internally + handles form-urlencoded parsing + CHECKSUMHASH
 * extraction).
 */
export async function verifyPaytmChecksum(
  params: Record<string, string>,
  checksum: string,
  merchantKey: string,
): Promise<boolean> {
  if (merchantKey.length < 16) return false;
  const key = paytmAesKey(merchantKey);
  let decrypted: Buffer;
  try {
    // Use Node's createDecipheriv (mirrors upipay's implementation exactly).
    const { createDecipheriv } = await import('node:crypto');
    const decipher = createDecipheriv('aes-128-cbc', key, PAYTM_IV);
    decrypted = Buffer.concat([
      decipher.update(Buffer.from(checksum, 'base64')),
      decipher.final(),
    ]);
  } catch {
    return false; // decrypt failure = invalid checksum
  }
  const plaintext = decrypted.toString('utf8');
  // Official format: 64-char hex hash + 4-char salt = 68 chars total.
  if (plaintext.length < 68) return false;
  const hash = plaintext.slice(0, 64);
  const salt = plaintext.slice(64);
  const paramsString = paytmParamsValuesString(params);
  const expectedHash = createHash('sha256').update(paramsString + '|' + salt, 'utf8').digest('hex');
  // Constant-time comparison (timingSafeEqual) — matches upipay.
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(expectedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── End checksum helpers ──

function creds(c: Record<string, unknown>): PaytmCredentials {
  const pc = c.paytm as PaytmCredentials | undefined;
  if (!pc || !pc.merchantKey) throw new Error('Paytm: missing merchantKey in shop credentials');
  if (!pc.merchantId) throw new Error('Paytm: missing merchantId in shop credentials');
  if (pc.merchantKey.length < 16) {
    throw new Error(
      `Paytm: merchantKey must be at least 16 characters (got ${pc.merchantKey.length}). ` +
        `Real Paytm merchant keys are 32-char hex strings.`,
    );
  }
  return pc;
}

/**
 * Construct a per-shop UPIPay client from the shop's Paytm credentials.
 */
function makeClient(c: PaytmCredentials): UPIPay {
  return new UPIPay({
    provider: 'paytm',
    environment: c.env === 'prod' ? 'production' : 'sandbox',
    credentials: {
      merchantId: c.merchantId,
      merchantKey: c.merchantKey,
      website: c.website,
    },
    options: { timeout: 30_000 },
  });
}

/**
 * Paytm PaymentAdapter — REAL implementation using the UPIPay SDK.
 *
 * Phase 5.3 changes:
 *   - `handleWebhook` now delegates to `upipay`'s `verifyWebhook` (official
 *     Paytm AES-128-CBC + SHA-256 + salt + constant-time compare). The
 *     previous hand-rolled verification used a non-standard IV
 *     (`0123456789012345`), no salt, and `===` comparison — real Paytm
 *     callbacks would have been rejected.
 *   - `generatePaytmChecksum` now uses the official algorithm (salt +
 *     values-only params string + IV `@@@@&&&&####$$$$`).
 */
export class PaytmPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'paytm';

  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    shopName?: string;
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
    /** MANDATORY (Phase 5.2.1). Used verbatim as the Paytm ORDERID. */
    merchantOrderId: string;
  }): Promise<PaymentIntent> {
    const c = creds(input.shopCredentials);
    const client = makeClient(c);
    // Phase 5.2.1: use the caller-supplied reference VERBATIM. No fallback.
    const merchantOrderId = input.merchantOrderId;

    try {
      const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
      const callbackUrl = `${base}/api/v1/payments/paytm/callback`;
      const redirectUrl = `${base}/orders/${input.orderId}?provider=paytm`;

      const response = await client.createPayment({
        amount: input.amountPaise,
        orderId: merchantOrderId,
        customerPhone: input.customerPhone ?? '9999999999',
        callbackUrl,
        redirectUrl,
      });

      if (!response.success) {
        throw new Error(
          `Paytm createPayment failed: ${JSON.stringify(response.rawResponse)}`,
        );
      }

      return {
        merchantOrderId,
        orderId: input.orderId,
        amountPaise: input.amountPaise,
        currency: 'INR',
        checkoutUrl: response.paymentUrl,
        provider: 'paytm',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    } catch (err) {
      // Graceful degradation — same as PhonePe. The customer falls back to
      // the UPI deep-link / QR flow; the order stays awaiting_payment.
      console.error('[paytm] createPayment failed (falling back to manual verify):',
        err instanceof Error ? err.message : String(err));
      return {
        merchantOrderId,
        orderId: input.orderId,
        amountPaise: input.amountPaise,
        currency: 'INR',
        provider: 'paytm',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    }
  }

  /**
   * Verify the inbound Paytm callback using UPIPay's `verifyWebhook` — the
   * OFFICIAL Paytm checksum algorithm (AES-128-CBC + SHA-256 + salt +
   * constant-time compare).
   *
   * UPIPay's `verifyWebhook`:
   *   - Accepts form-urlencoded bodies (via URLSearchParams fallback)
   *   - Extracts CHECKSUMHASH from the payload internally
   *   - Removes CHECKSUMHASH from the params used for verification
   *   - Calls the official `verifyPaytmChecksum` algorithm
   *   - Returns a normalized `{ verified, status, orderId, transactionId,
   *     amount, rawPayload }` event
   *
   * Per the spec, Paytm renders an HTML success/failure page back to the
   * customer's browser (NOT JSON) — so we return `responseBody` as HTML.
   */
  async handleWebhook(
    input: WebhookInput,
    shopCredentials: Record<string, unknown>,
  ): Promise<WebhookResult> {
    const c = creds(shopCredentials);
    const client = makeClient(c);

    // Parse the form-urlencoded body to extract CHECKSUMHASH + the raw params
    // (for the amount/utr extraction that upipay's normalized event may not
    // surface in the exact format we need).
    const params: Record<string, string> = {};
    for (const pair of input.rawBody.split('&')) {
      const [k, v] = pair.split('=').map(decodeURIComponent);
      if (k) params[k] = v ?? '';
    }
    const checksum = params.CHECKSUMHASH ?? '';
    if (!checksum) {
      return { ok: false, verification: null, statusCode: 400, responseBody: htmlPage('Missing CHECKSUMHASH', false) };
    }

    try {
      const event = client.verifyWebhook(input.rawBody, checksum, {
        enableReplayProtection: false,
      });
      if (!event.verified) {
        return { ok: false, verification: null, statusCode: 401, responseBody: htmlPage('Checksum verification failed', false) };
      }

      const status = params.STATUS ?? event.status ?? '';
      const paid = status === 'TXN_SUCCESS';
      const txnId = params.TXNID ?? event.transactionId ?? null;
      const amountRupees = params.TXNAMOUNT ? Number(params.TXNAMOUNT) : (typeof event.amount === 'number' ? event.amount / 100 : null);
      const amountPaise = amountRupees !== null && Number.isFinite(amountRupees) ? Math.round(amountRupees * 100) : null;
      const utr = params.BANKTXNID ?? null;

      return {
        ok: true,
        verification: {
          paid,
          txnId,
          utr,
          amountPaise,
          provider: 'paytm',
          raw: event.rawPayload ?? params,
        },
        statusCode: 200,
        responseBody: htmlPage(paid ? 'Payment Successful!' : `Payment ${status}`, paid, params.ORDERID ?? event.orderId ?? undefined),
      };
    } catch (err) {
      console.error('[paytm] webhook verification failed:',
        err instanceof Error ? err.message : String(err));
      return { ok: false, verification: null, statusCode: 401, responseBody: htmlPage('Checksum verification failed', false) };
    }
  }

  /**
   * Poll the Paytm Transaction Status API (POST /v3/order/status) via UPIPay.
   * Used as a fallback when callbacks are delayed + as defense-in-depth.
   */
  async verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentVerification> {
    const c = creds(input.shopCredentials);
    const client = makeClient(c);

    try {
      const status = await client.checkStatus(input.merchantOrderId);

      return {
        paid: status.status === 'SUCCESS',
        txnId: status.transactionId ?? null,
        utr: null,
        amountPaise: typeof status.amount === 'number' ? status.amount : null,
        provider: 'paytm',
        raw: status.rawResponse,
      };
    } catch (err) {
      console.error('[paytm] checkStatus failed:',
        err instanceof Error ? err.message : String(err));
      return {
        paid: false,
        txnId: null,
        utr: null,
        amountPaise: null,
        provider: 'paytm',
        raw: null,
      };
    }
  }

  /**
   * Initiate a refund via POST /v3/order/refund.
   */
  async refund(
    input: RefundInput,
    shopCredentials: Record<string, unknown>,
  ): Promise<RefundResult> {
    const c = creds(shopCredentials);
    const client = makeClient(c);
    const refundId = `refund-${crypto.randomUUID()}`;

    try {
      const response = await client.createRefund({
        originalOrderId: input.paymentTxnId,
        refundId,
        amount: input.amountPaise,
      });

      return {
        refundId: response.refundId ?? refundId,
        amountPaise: input.amountPaise,
        status: response.status === 'SUCCESS' ? 'completed'
          : response.status === 'PENDING' ? 'pending'
          : 'failed',
      };
    } catch (err) {
      console.error('[paytm] refund failed:',
        err instanceof Error ? err.message : String(err));
      return {
        refundId,
        amountPaise: input.amountPaise,
        status: 'failed',
      };
    }
  }
}

/** NPCI-style minimal HTML page Paytm renders back to the customer. */
function htmlPage(message: string, success: boolean, orderId?: string): string {
  const color = success ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment</title></head><body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc"><div style="text-align:center;padding:2rem 3rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h1 style="color:${color};margin:0 0 .5rem">${message}</h1>${orderId ? `<p style="color:#64748b;margin:0">Order ${String(orderId).slice(0, 8)}</p>` : ''}<p style="color:#94a3b8;margin:.5rem 0 0;font-size:.85rem">You can close this window.</p></div></body></html>`;
}
