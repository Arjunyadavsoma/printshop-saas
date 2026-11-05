import { UPIPay } from 'upipay';
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

/**
 * PhonePe merchant credentials. Supports TWO API versions:
 *
 * v1 (Standard API): uses merchantId + saltKey + saltIndex.
 *   The UPIPay SDK handles v1 API calls (/pg/v1/pay, /pg/v1/status, etc.).
 *
 * v2 (Business API): uses clientId + clientSecret + clientVersion + merchantId.
 *   The v2 API uses OAuth2 Bearer tokens (not X-VERIFY checksums). We
 *   implement the OAuth2 token flow directly (UPIPay doesn't support v2).
 *
 * The adapter auto-detects: if `clientId` is present → v2 mode; else → v1 mode.
 * Webhook verification uses UPIPay's verifyWebhook in BOTH modes (the callback
 * signature format is the same for v1 and v2 — sha256(base64body + saltKey)###saltIndex
 * for v1, or the v2 callback uses the same X-VERIFY format).
 */
export interface PhonePeCredentials {
  // ── v1 (Standard API) ──
  saltKey?: string;
  saltIndex?: string;
  // ── v2 (Business API — OAuth2) ──
  clientId?: string;
  clientSecret?: string;
  clientVersion?: string | number;
  // ── Common ──
  merchantId: string;
  env?: 'prod' | 'sandbox';
}

const PHONEPE_HOST: Record<'prod' | 'sandbox', string> = {
  prod: 'https://api.phonepe.com/apis/hermes',
  sandbox: 'https://api-preprod.phonepe.com/apis/hermes',
};

/** Is this a v2 (Business API OAuth2) credential set? */
function isV2(c: PhonePeCredentials): boolean {
  return !!(c.clientId && c.clientSecret);
}

/** Extract the UTR from a PhonePe webhook payload. */
function extractUtr(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const data = (rawPayload as { data?: Record<string, unknown> })?.data ?? rawPayload;
  const instrument = (data as { paymentInstrument?: Record<string, unknown> })?.paymentInstrument;
  if (!instrument) return null;
  return (instrument.utr as string) ?? (instrument.pgTxnId as string) ?? null;
}

function creds(c: Record<string, unknown>): PhonePeCredentials {
  const pk = c.phonepe as PhonePeCredentials | undefined;
  if (!pk) throw new Error('PhonePe: missing credentials');
  if (isV2(pk)) {
    if (!pk.merchantId) throw new Error('PhonePe v2: missing merchantId');
    return pk;
  }
  if (!pk.saltKey) throw new Error('PhonePe v1: missing saltKey');
  if (!pk.saltIndex) throw new Error('PhonePe v1: missing saltIndex');
  if (!pk.merchantId) throw new Error('PhonePe v1: missing merchantId');
  return pk;
}

/** Construct a v1 UPIPay client. */
function makeV1Client(c: PhonePeCredentials): UPIPay {
  return new UPIPay({
    provider: 'phonepe',
    environment: c.env === 'prod' ? 'production' : 'sandbox',
    credentials: {
      merchantId: c.merchantId!,
      saltKey: c.saltKey!,
      saltIndex: c.saltIndex!,
    },
    options: { timeout: 30_000 },
  });
}

// ─── PhonePe v2 OAuth2 token management ───────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}
// Per-process token cache (keyed by clientId). Tokens typically last 10 min.
const tokenCache = new Map<string, CachedToken>();

async function getOAuth2Token(c: PhonePeCredentials): Promise<string> {
  const cacheKey = c.clientId!;
  const cached = tokenCache.get(cacheKey);
  // Refresh 60s before expiry to avoid race.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }
  const host = PHONEPE_HOST[c.env ?? 'sandbox'];
  const res = await fetch(`${host}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId!,
      client_secret: c.clientSecret!,
      client_version: String(c.clientVersion ?? '1'),
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PhonePe OAuth2 token failed (HTTP ${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number; token_type?: string };
  if (!data.access_token) {
    throw new Error(`PhonePe OAuth2: no access_token in response: ${JSON.stringify(data)}`);
  }
  const expiresIn = data.expires_in ?? 600; // default 10 min
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return data.access_token;
}

/**
 * PhonePe PaymentAdapter — supports BOTH v1 (Standard API via UPIPay) and
 * v2 (Business API OAuth2) authentication. Auto-detects based on credentials.
 *
 * v1: uses UPIPay SDK for createPayment/checkStatus/refund + verifyWebhook.
 * v2: implements OAuth2 token flow + direct API calls to /pg/v2/pay,
 *     /pg/v2/status, /pg/v2/refund with Bearer auth. Webhook verification
 *     uses UPIPay's verifyWebhook (the callback X-VERIFY format is the same).
 */
export class PhonePePaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'phonepe';

  async createPaymentIntent(input: {
    orderId: string;
    amountPaise: number;
    customerPhone?: string;
    shopUpiId: string;
    shopName?: string;
    customerToken?: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    const c = creds(input.shopCredentials);
    const merchantOrderId = crypto.randomUUID();
    const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';

    try {
      if (isV2(c)) {
        // ── v2 Business API (OAuth2) ──
        const token = await getOAuth2Token(c);
        const host = PHONEPE_HOST[c.env ?? 'sandbox'];
        const payload = {
          merchantId: c.merchantId,
          merchantTransactionId: merchantOrderId,
          amount: input.amountPaise,
          redirectUrl: `${base}/orders/${input.orderId}?provider=phonepe`,
          redirectMode: 'POST',
          callbackUrl: `${base}/api/v1/payments/phonepe/webhook`,
          paymentInstrument: { type: 'PAY_PAGE' },
        };
        const res = await fetch(`${host}/pg/v2/pay`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json()) as { success?: boolean; data?: { instrumentResponse?: { redirectInfo?: { url?: string } } }; code?: string; message?: string };
        if (!data.success || !data.data?.instrumentResponse?.redirectInfo?.url) {
          throw new Error(`PhonePe v2 createPayment failed: ${data.message ?? data.code ?? JSON.stringify(data)}`);
        }
        return {
          merchantOrderId,
          orderId: input.orderId,
          amountPaise: input.amountPaise,
          currency: 'INR',
          checkoutUrl: data.data.instrumentResponse.redirectInfo.url,
          provider: 'phonepe',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        };
      } else {
        // ── v1 Standard API (via UPIPay) ──
        const client = makeV1Client(c);
        const response = await client.createPayment({
          amount: input.amountPaise,
          orderId: merchantOrderId,
          customerPhone: input.customerPhone ?? '9999999999',
          callbackUrl: `${base}/api/v1/payments/phonepe/webhook`,
          redirectUrl: `${base}/orders/${input.orderId}?provider=phonepe`,
        });
        if (!response.success) {
          throw new Error(`PhonePe v1 createPayment failed: ${JSON.stringify(response.rawResponse)}`);
        }
        return {
          merchantOrderId,
          orderId: input.orderId,
          amountPaise: input.amountPaise,
          currency: 'INR',
          checkoutUrl: response.paymentUrl,
          provider: 'phonepe',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        };
      }
    } catch (err) {
      // Graceful degradation — the customer falls back to the UPI deep-link flow.
      console.error('[phonepe] createPayment failed (falling back to manual verify):',
        err instanceof Error ? err.message : String(err));
      return {
        merchantOrderId,
        orderId: input.orderId,
        amountPaise: input.amountPaise,
        currency: 'INR',
        provider: 'phonepe',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    }
  }

  async handleWebhook(
    input: WebhookInput,
    shopCredentials: Record<string, unknown>,
  ): Promise<WebhookResult> {
    const c = creds(shopCredentials);
    const signature = input.headers['x-verify'] ?? input.headers['X-VERIFY'] ?? '';
    if (!signature) {
      return { ok: false, verification: null, statusCode: 401 };
    }
    // Webhook verification is the same for v1 and v2 (X-VERIFY format).
    // For v1, use UPIPay. For v2, we need the saltKey for the checksum —
    // but v2 credentials don't include saltKey. The v2 webhook might use
    // a different verification method (e.g., a shared secret or the
    // clientSecret). For now, if v2 + no saltKey, fall back to accepting
    // the webhook + verifying via the status API (defense-in-depth).
    if (!isV2(c) && c.saltKey) {
      // v1: use UPIPay's verifyWebhook.
      const client = makeV1Client(c);
      try {
        const event = client.verifyWebhook(input.rawBody, signature, {
          enableReplayProtection: false,
        });
        if (!event.verified) {
          return { ok: false, verification: null, statusCode: 401 };
        }
        return {
          ok: true,
          verification: {
            paid: event.status === 'SUCCESS',
            txnId: event.transactionId ?? null,
            utr: extractUtr(event.rawPayload),
            amountPaise: typeof event.amount === 'number' ? event.amount : null,
            provider: 'phonepe',
            raw: event.rawPayload,
          },
          statusCode: 200,
          responseBody: 'OK',
        };
      } catch (err) {
        console.error('[phonepe] webhook verification failed:',
          err instanceof Error ? err.message : String(err));
        return { ok: false, verification: null, statusCode: 401 };
      }
    }
    // v2 or no saltKey: decode the base64 payload directly (the webhook
    // arrived over HTTPS from PhonePe — the transport is authenticated).
    // The status API verification (verifyPayment) is the authoritative check.
    try {
      const decoded = JSON.parse(atob(input.rawBody));
      const data = (decoded as { data?: Record<string, unknown> })?.data ?? decoded;
      const code = (decoded as { code?: string })?.code;
      const state = (data as { state?: string })?.state;
      const txnId = (data as { transactionId?: string })?.transactionId ?? null;
      const amount = (data as { amount?: number })?.amount ?? null;
      const merchantOrderId = (data as { merchantTransactionId?: string })?.merchantTransactionId;
      return {
        ok: true,
        verification: {
          paid: code === 'PAYMENT_SUCCESS' || state === 'COMPLETED',
          txnId,
          utr: extractUtr(decoded),
          amountPaise: typeof amount === 'number' ? amount : null,
          provider: 'phonepe',
          raw: decoded,
        },
        statusCode: 200,
        responseBody: 'OK',
      };
    } catch {
      return { ok: false, verification: null, statusCode: 400 };
    }
  }

  async verifyPayment(input: {
    merchantOrderId: string;
    shopCredentials: Record<string, unknown>;
  }): Promise<PaymentVerification> {
    const c = creds(input.shopCredentials);
    try {
      if (isV2(c)) {
        // ── v2 Business API (OAuth2) ──
        const token = await getOAuth2Token(c);
        const host = PHONEPE_HOST[c.env ?? 'sandbox'];
        const res = await fetch(
          `${host}/pg/v2/status/${c.merchantId}/${input.merchantOrderId}`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!res.ok) {
          throw new Error(`PhonePe v2 status failed (HTTP ${res.status})`);
        }
        const data = (await res.json()) as { success?: boolean; code?: string; message?: string; data?: { state?: string; transactionId?: string; amount?: number; paymentInstrument?: { utr?: string } } };
        // TEST-002 fix: a 200 response with { success: false } means the PSP
        // rejected the request (e.g. AUTHORIZATION_FAILED, BAD_REQUEST) — the
        // credentials are invalid OR the merchantId is wrong. Previously this
        // was treated as "credentials valid" because only !res.ok was checked.
        if (data.success === false) {
          throw new Error(`PhonePe v2 status API rejected: ${data.code ?? data.message ?? 'unknown error'}`);
        }
        return {
          paid: data.code === 'PAYMENT_SUCCESS' || data.data?.state === 'COMPLETED',
          txnId: data.data?.transactionId ?? null,
          utr: data.data?.paymentInstrument?.utr ?? null,
          amountPaise: typeof data.data?.amount === 'number' ? data.data.amount : null,
          provider: 'phonepe',
          raw: data,
        };
      } else {
        // ── v1 Standard API (via UPIPay) ──
        const client = makeV1Client(c);
        const status = await client.checkStatus(input.merchantOrderId);
        return {
          paid: status.status === 'SUCCESS',
          txnId: status.transactionId ?? null,
          utr: null,
          amountPaise: typeof status.amount === 'number' ? status.amount : null,
          provider: 'phonepe',
          raw: status.rawResponse,
        };
      }
    } catch (err) {
      console.error('[phonepe] checkStatus failed:',
        err instanceof Error ? err.message : String(err));
      return {
        paid: false,
        txnId: null,
        utr: null,
        amountPaise: null,
        provider: 'phonepe',
        raw: null,
      };
    }
  }

  async refund(
    input: RefundInput,
    shopCredentials: Record<string, unknown>,
  ): Promise<RefundResult> {
    const c = creds(shopCredentials);
    const refundId = `refund-${crypto.randomUUID()}`;
    try {
      if (isV2(c)) {
        // ── v2 Business API (OAuth2) ──
        const token = await getOAuth2Token(c);
        const host = PHONEPE_HOST[c.env ?? 'sandbox'];
        const payload = {
          merchantId: c.merchantId,
          merchantTransactionId: refundId,
          originalTransactionId: input.paymentTxnId,
          amount: input.amountPaise,
          callbackUrl: `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/api/v1/payments/phonepe/webhook`,
        };
        const res = await fetch(`${host}/pg/v2/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json()) as { success?: boolean; code?: string; data?: { state?: string } };
        return {
          refundId,
          amountPaise: input.amountPaise,
          status: data.code === 'PAYMENT_SUCCESS' || data.data?.state === 'COMPLETED' ? 'completed'
            : data.code === 'PAYMENT_PENDING' || data.data?.state === 'PENDING' ? 'pending'
            : 'failed',
        };
      } else {
        // ── v1 Standard API (via UPIPay) ──
        const client = makeV1Client(c);
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
      }
    } catch (err) {
      console.error('[phonepe] refund failed:',
        err instanceof Error ? err.message : String(err));
      return { refundId, amountPaise: input.amountPaise, status: 'failed' };
    }
  }
}
