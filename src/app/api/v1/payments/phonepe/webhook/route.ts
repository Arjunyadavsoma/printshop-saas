import { NextResponse, type NextRequest } from 'next/server';
import { processWebhook } from '@/lib/payments/webhook.service';
import { processPhonePeV2Webhook } from '@/lib/payments/phonepe-v2-webhook';

/**
 * POST /api/v1/payments/phonepe/webhook — PhonePe callback.
 *
 * Supports BOTH webhook formats:
 *
 * v1 (Standard API): base64 body + X-VERIFY header.
 * v2 (Business API): plain JSON body { event, payload } + Authorization
 *   header = bare SHA256(username:password) hex.
 *
 * Detection: if the `Authorization` header contains a 64-char hex string
 * (SHA-256) AND the body is valid JSON with an `event` field → v2 format.
 * Otherwise → v1 format (X-VERIFY + base64).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const authHeader = req.headers.get('authorization');
  const xVerify = req.headers.get('x-verify') ?? req.headers.get('X-VERIFY');
  const ip = req.headers.get('x-forwarded-for') ?? null;

  // ── DIAGNOSTIC LOG (always visible — helps debug webhook delivery) ──
  // Log at the route level so EVERY request appears in Vercel logs, even if
  // the SHA auth env vars aren't configured yet.
  const webhookUser = process.env.PHONEPE_WEBHOOK_USERNAME;
  const webhookPass = process.env.PHONEPE_WEBHOOK_PASSWORD;
  console.log('[phonepe-webhook] request received:', {
    hasAuthHeader: !!authHeader,
    authHeaderLength: authHeader?.length ?? 0,
    authHeaderPreview: authHeader ? authHeader.slice(0, 8) + '...' : 'none',
    hasXVerify: !!xVerify,
    bodyLength: rawBody.length,
    bodyStartsWith: rawBody.slice(0, 20),
    isJsonBody: rawBody.trim().startsWith('{'),
    hasEventInBody: rawBody.includes('"event"'),
    envVarsConfigured: !!(webhookUser && webhookPass),
    ip,
  });

  // If the SHA webhook credentials aren't configured, log a clear error so
  // the Vercel logs show exactly what's missing.
  if (!webhookUser || !webhookPass) {
    console.error('[phonepe-webhook] FATAL: PHONEPE_WEBHOOK_USERNAME and/or PHONEPE_WEBHOOK_PASSWORD not set in Vercel env vars. Webhook cannot be authenticated. Add them in Vercel → Settings → Environment Variables.');
  }

  // ── Detect v2 format ──
  const isV2 = !!authHeader
    && /^[0-9a-f]{64}$/i.test(authHeader.trim())
    && rawBody.trim().startsWith('{')
    && rawBody.includes('"event"');

  if (isV2) {
    console.log('[phonepe-webhook] detected v2 format (SHA auth + JSON body)');
    // ── v2 Business API webhook ──
    const result = await processPhonePeV2Webhook(rawBody, authHeader, ip);
    console.log('[phonepe-webhook] v2 result:', {
      statusCode: result.statusCode,
      summary: result.summary,
      applied: result.applied,
      orderId: result.orderId ?? null,
    });
    return NextResponse.json(
      { success: result.statusCode < 400, data: { summary: result.summary, applied: result.applied, orderId: result.orderId } },
      { status: result.statusCode },
    );
  }

  // ── v1 Standard API webhook (existing path) ──
  console.log('[phonepe-webhook] detected v1 format (X-VERIFY + base64 body)');
  const result = await processWebhook({
    provider: 'phonepe',
    rawBody,
    headers,
    path: '/api/v1/payments/phonepe/webhook',
    ip,
  });

  console.log('[phonepe-webhook] v1 result:', {
    statusCode: result.statusCode,
    summary: result.summary,
    applied: result.applied,
  });

  // PhonePe expects a 200 with body "OK" when the callback is accepted.
  if (result.responseBody) {
    return new NextResponse(result.responseBody, {
      status: result.statusCode,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json(
    { success: result.statusCode < 400, data: { summary: result.summary, applied: result.applied, orderId: result.orderId } },
    { status: result.statusCode },
  );
}
