import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
  StubLoggerAdapter,
  UpiDeepLinkPaymentAdapter,
} from '@platform/adapters';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { PaymentAdapterRegistry } from '@/lib/payments/registry';
import { setContainerForTesting } from '@/lib/container';
import type { Container } from '@/lib/container';
import { detectPii, detectPiiInEvent, detectPiiInBatch } from '@/lib/security/pii-scan';
import { ANALYTICS_EVENTS } from '@/lib/customer/analytics';

/**
 * P9-Security §5 — PII scan in analytics
 *
 * The analytics pipeline is unauthenticated (`POST /api/v1/analytics/track`).
 * Even though the client-side `track()` function documents a privacy
 * contract ("never send phone numbers, file names, UTR values, order
 * tokens"), a buggy client (or a malicious one) could leak PII. The server
 * must scan every event for PII patterns and reject any event containing
 * them, so a leak never reaches the structured log / future warehouse.
 *
 * Patterns detected:
 *   - 10-digit Indian mobile numbers (optionally prefixed with +91 or 0)
 *   - 12-digit UTR / UPI reference numbers
 *   - Email addresses (RFC-5322-ish local@domain)
 *   - File names with extensions (.pdf, .docx, .jpg, .png, .xlsx, .pptx,
 *     .doc, .txt, .heic, .zip)
 *   - Order tokens (32+ hex chars — a leaked token is a credential leak)
 *
 * Test approach:
 *   (a) Unit-test the `detectPii` scanner directly with each pattern.
 *   (b) Hit the route with a batch containing PII → expect 400 rejection.
 *   (c) Hit the route with a clean batch → expect 200 acceptance.
 *   (d) Sanity-scan the canonical event names list (`ANALYTICS_EVENTS`)
 *       to confirm none of them contain PII patterns.
 */

let container: Container;

beforeEach(() => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  container = {
    db,
    storage: new InMemoryStorageAdapter(),
    payment: new UpiDeepLinkPaymentAdapter(),
    paymentRegistry: new PaymentAdapterRegistry(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new StubLoggerAdapter(),
    auth,
  };
  setContainerForTesting(container);
});

// ── (a) Unit: detectPii scanner ──

describe('PII scanner — pattern detection', () => {

  it('detects a 10-digit Indian mobile number', () => {
    expect(detectPii('customer called from 9876543210').length).toBeGreaterThan(0);
    expect(detectPii('+919876543210').length).toBeGreaterThan(0);
    expect(detectPii('09876543210').length).toBeGreaterThan(0);
  });

  it('does NOT flag short numeric strings (< 10 digits) as phone numbers', () => {
    expect(detectPii('printed 5 pages')).toEqual([]);
    expect(detectPii('order 104')).toEqual([]);
    expect(detectPii('total 100 rupees')).toEqual([]);
  });

  it('detects a 12-digit UTR', () => {
    expect(detectPii('utr 123456789012').length).toBeGreaterThan(0);
    expect(detectPii('ref: 441234567890').length).toBeGreaterThan(0);
  });

  it('detects an email address', () => {
    expect(detectPii('contact jane@doe.com').length).toBeGreaterThan(0);
    expect(detectPii('foo.bar+spam@example.co.in').length).toBeGreaterThan(0);
  });

  it('detects a file name with extension', () => {
    expect(detectPii('uploaded resume.pdf').length).toBeGreaterThan(0);
    expect(detectPii('photo.jpg').length).toBeGreaterThan(0);
    expect(detectPii('doc.docx').length).toBeGreaterThan(0);
    expect(detectPii('sheet.xlsx').length).toBeGreaterThan(0);
    expect(detectPii('slides.pptx').length).toBeGreaterThan(0);
  });

  it('does NOT flag common words that happen to have a dot', () => {
    // "shop.landed" is a harmless event-name-with-dot. The scanner must
    // only flag KNOWN file extensions, not every dotted word.
    expect(detectPii('shop.landed')).toEqual([]);
    expect(detectPii('amount.paise.range')).toEqual([]);
  });

  it('detects an order token (32+ hex chars — credential leak)', () => {
    const token = 'a'.repeat(64);
    expect(detectPii(`token=${token}`).length).toBeGreaterThan(0);
  });

  it('returns NO findings for a clean event payload', () => {
    expect(detectPii('shop_landed')).toEqual([]);
    expect(detectPii('preset_chosen')).toEqual([]);
    expect(detectPii('amount_paise_range: 100-500')).toEqual([]);
    expect(detectPii('page_count: 4')).toEqual([]);
    expect(detectPii('preset_name: bw_a4_single')).toEqual([]);
  });
});

// ── (b) Route rejects PII-bearing events ──

async function postEvents(events: Array<{ event: string; properties: Record<string, unknown>; client_ts: number }>) {
  const { POST } = await import('@/app/api/v1/analytics/track/route');
  const req = new NextRequest('http://localhost:3000/api/v1/analytics/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  return POST(req, { params: Promise.resolve({}) });
}

describe('PII scanner — POST /api/v1/analytics/track rejects PII', () => {
  it('rejects an event whose properties contain a phone number', async () => {
    const res = await postEvents([
      {
        event: 'shop_landed',
        properties: { customer_phone: '9876543210' },
        client_ts: Date.now(),
      },
    ]);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(/pii/i.test(json.error?.code ?? '')).toBe(true);
  });

  it('rejects an event whose properties contain a UTR', async () => {
    const res = await postEvents([
      {
        event: 'utr_submitted',
        properties: { utr_value: '123456789012' },
        client_ts: Date.now(),
      },
    ]);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(/pii/i.test(json.error?.code ?? '')).toBe(true);
  });

  it('rejects an event whose properties contain an email', async () => {
    const res = await postEvents([
      {
        event: 'shop_landed',
        properties: { contact_email: 'jane@doe.com' },
        client_ts: Date.now(),
      },
    ]);
    expect(res.status).toBe(400);
  });

  it('rejects an event whose properties contain a file name', async () => {
    const res = await postEvents([
      {
        event: 'upload_started',
        properties: { file_name: 'secret.pdf' },
        client_ts: Date.now(),
      },
    ]);
    expect(res.status).toBe(400);
  });

  it('rejects an event whose properties contain a leaked order token', async () => {
    const res = await postEvents([
      {
        event: 'order_tracked',
        properties: { token: 'f'.repeat(64) },
        client_ts: Date.now(),
      },
    ]);
    expect(res.status).toBe(400);
  });

  it('rejects if ANY event in a batch contains PII (atomic reject)', async () => {
    // The whole batch is rejected — partial ingestion would lose the
    // clean events but accept the leaky one. Atomicity > completeness.
    const res = await postEvents([
      { event: 'shop_landed', properties: { shop_slug: 'abc' }, client_ts: Date.now() },
      { event: 'upload_started', properties: { file_name: 'secret.pdf' }, client_ts: Date.now() },
    ]);
    expect(res.status).toBe(400);
  });
});

// ── (c) Clean batch is accepted ──

describe('PII scanner — clean batches are accepted', () => {
  it('accepts a batch of well-formed anonymous events', async () => {
    const res = await postEvents([
      { event: 'shop_landed', properties: { shop_slug: 'acme-prints', app_id: 'web-v2' }, client_ts: Date.now() },
      { event: 'upload_started', properties: { page_count: 4, mime_bucket: 'pdf' }, client_ts: Date.now() },
      { event: 'preset_chosen', properties: { preset_name: 'bw_a4_single' }, client_ts: Date.now() },
      { event: 'quote_viewed', properties: { amount_paise_range: '100-500', copies: 1 }, client_ts: Date.now() },
      { event: 'utr_submitted', properties: { method: 'upi' }, client_ts: Date.now() },
    ]);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.accepted).toBe(5);
  });

  it('accepts numeric counters and boolean toggles (no false positives)', async () => {
    const res = await postEvents([
      { event: 'colour_pages_changed', properties: { colour_pages: 3, total_pages: 10 }, client_ts: Date.now() },
      { event: 'more_options_opened', properties: { urgent: false, duplex: true }, client_ts: Date.now() },
    ]);
    expect(res.status).toBe(200);
  });
});

// ── (d) Sanity: canonical event names + property keys carry no PII ──

describe('PII scanner — canonical analytics contract is PII-free', () => {
  it('every name in ANALYTICS_EVENTS is PII-free', () => {
    for (const name of Object.values(ANALYTICS_EVENTS)) {
      const findings = detectPii(name);
      expect(findings, `event name "${name}" leaked PII: ${findings.join(', ')}`).toEqual([]);
    }
  });

  it('every documented property key (from the route JSDoc) is PII-free', () => {
    // The canonical property keys the client sends (from the route's JSDoc
    // and the analytics.ts contract): shop_slug, page_count, preset_name,
    // amount_paise_range, app_id, copies, colour_pages, total_pages,
    // urgent, duplex, method, mime_bucket, etc. None of these are PII.
    const canonicalKeys = [
      'shop_slug', 'page_count', 'preset_name', 'amount_paise_range', 'app_id',
      'copies', 'colour_pages', 'total_pages', 'urgent', 'duplex', 'method',
      'mime_bucket', 'shop_id', 'web_v2', '100-500',
    ];
    for (const k of canonicalKeys) {
      expect(detectPii(k), `canonical key "${k}" flagged as PII`).toEqual([]);
    }
  });
});
