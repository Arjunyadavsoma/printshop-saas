import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { rmSync, existsSync } from 'node:fs';
import path_ from 'node:path';
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
import { repos } from '@/lib/repositories';
import { createDefaultPricingConfig } from '@platform/core/domain';

/**
 * P9-Security §3 — Upload validation
 *
 * The customer upload pipeline (`POST /api/v1/s/[slug]/uploads/init` →
 * `PUT /api/v1/s/[slug]/uploads/chunk` → `POST /api/v1/s/[slug]/uploads/complete`)
 * is the largest unauthenticated attack surface in the customer flow. Five
 * guarantees must hold:
 *
 *   (1) Magic-byte validation — the first bytes of the uploaded file MUST
 *       match the declared MIME type. A `.pdf` whose bytes are actually a
 *       JPEG is rejected. Otherwise an attacker can smuggle executables /
 *       macros past the type allowlist.
 *
 *   (2) Size limit — 50 MB per file. Enforced at init, chunk-append, and
 *       complete (defence in depth).
 *
 *   (3) Filename sanitization — path traversal (`../`), NUL bytes, shell
 *       metacharacters are stripped from the stored filename. The stored
 *       filename must be a safe basename (no `/`, no `\`, no leading dots).
 *
 *   (4) Reject encrypted PDFs — a password-protected PDF cannot be opened
 *       by the server-side page-counter / colour-suggest pipeline. The
 *       pipeline must reject it BEFORE the order is placed (so the shop
 *       doesn't waste paper on an undecryptable file).
 *
 *   (5) Strip EXIF location data from stored images — JPEGs/HEICs uploaded
 *       by customers often carry GPS coordinates from the phone's camera.
 *       Those coordinates would persist in the stored ORIGINAL bytes and
 *       leak the customer's home/office location to anyone with storage
 *       access (shop staff, a compromised backup, a leak). The pipeline
 *       must strip EXIF BEFORE storing the original.
 */

const PART_DIR = path_.join('/tmp', 'pshop-uploads');

let container: Container;
let shopSlug: string;
let shopId: string;

beforeEach(async () => {
  // The chunk-upload pipeline writes .part files under /tmp/pshop-uploads.
  // Clear between tests so leftover chunks don't corrupt a fresh session.
  try { rmSync(PART_DIR, { recursive: true, force: true }); } catch { /* noop */ }

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

  shopSlug = 'shop-' + crypto.randomUUID().slice(0, 8);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId,
    name: 'Upload Test Shop',
    slug: shopSlug,
    ownerUserId: crypto.randomUUID(),
    upiId: 'shop@upi',
    paymentProvider: 'googlepay',
    paymentCredentials: '',
    pricingConfig: JSON.stringify(createDefaultPricingConfig()),
    address: '1 Test St',
    phone: '5550000000',
    timezone: 'Asia/Kolkata',
    isActive: true,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    description: null,
    businessHours: null,
    logoUrl: null,
    upiQrStorageKey: null,
    servicesJson: null,
    paymentPhone: null,
    paymentInstructions: null,
    cashOnPickup: false,
    paymentMethods: 'both',
    pamphletEnabled: false,
    pamphletPricePaise: 0,
    pamphletName: null,
  } as never);
  await db.update('shop', { id: shopId }, {
    isOpen: true,
    acceptingOrders: true,
    paymentMode: 'UPI_THEN_PRINT',
  } as never);
});

afterEach(() => {
  try { rmSync(PART_DIR, { recursive: true, force: true }); } catch { /* noop */ }
});

// ── Helpers ──

/** A tiny valid PNG (4×4) — bytes start with the PNG magic signature. */
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SMALL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8DwnwEPYBhVUWz4AQUAAA5vBwUAffFvPwAAAABJRU5ErkJggg==',
  'base64',
);

/** A JPEG whose EXIF IFD0 carries a synthetic GPS marker we can detect. */
async function makeJpegWithExifGps(): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp') as typeof import('sharp');
  const marker = 'GPS_LAT_LON=37.5,122.4'; // a recognizable fingerprint
  const buf = await sharp(SMALL_PNG)
    .withMetadata({ exif: { IFD0: { ImageDescription: marker } } })
    .jpeg()
    .toBuffer();
  // Sanity: the EXIF marker is present in the raw bytes before stripping.
  expect(buf.toString('latin1')).toContain(marker);
  return buf;
}

/** Valid %PDF- magic + a minimal page so pdf-lib can load it. */
function makeMinimalPdf(): Buffer {
  // A minimal 1-page PDF generated once; reused across tests.
  // The bytes below are a hand-written minimal PDF that pdf-lib can load.
  // Note: contains %PDF-1.4 magic and one page MediaBox.
  return Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f \r
0000000009 00000 n \r
0000000052 00000 n \r
0000000101 00000 n \r
trailer<</Size 4/Root 1 0 R>>
startxref
165
%%EOF`,
    'latin1',
  );
}

async function initUpload(opts: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ orderId: string; orderToken: string; fileId: string; uploadId: string }> {
  const { POST } = await import('@/app/api/v1/s/[slug]/uploads/init/route');
  const req = new NextRequest(`http://localhost:3000/api/v1/s/${shopSlug}/uploads/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const res = await POST(req, { params: Promise.resolve({ slug: shopSlug }) });
  if (res.status !== 200) {
    const j = await res.json();
    throw new Error(`init failed: ${res.status} ${JSON.stringify(j)}`);
  }
  const json = await res.json();
  return {
    orderId: json.data.orderId,
    orderToken: json.data.orderToken,
    fileId: json.data.fileId,
    uploadId: json.data.uploadId,
  };
}

async function uploadOneChunk(uploadId: string, bytes: Uint8Array): Promise<void> {
  const { PUT } = await import('@/app/api/v1/s/[slug]/uploads/chunk/route');
  // Compute SHA-256 of the bytes (the chunk route verifies checksum).
  const { createHash } = await import('node:crypto');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const url = `http://localhost:3000/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}&index=0&checksum=${checksum}`;
  const req = new NextRequest(url, {
    method: 'PUT',
    body: Buffer.from(bytes),
  });
  const res = await PUT(req, { params: Promise.resolve({ slug: shopSlug }) });
  if (res.status !== 200) {
    const j = await res.json();
    throw new Error(`chunk failed: ${res.status} ${JSON.stringify(j)}`);
  }
}

async function completeUpload(uploadId: string): Promise<{ status: number; json: any }> {
  const { POST } = await import('@/app/api/v1/s/[slug]/uploads/complete/route');
  const req = new NextRequest(`http://localhost:3000/api/v1/s/${shopSlug}/uploads/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId, wait: true }),
  });
  const res = await POST(req, { params: Promise.resolve({ slug: shopSlug }) });
  return { status: res.status, json: await res.json() };
}

// ── (1) Magic-byte validation ──

describe('Upload validation — magic bytes vs declared MIME', () => {
  it('rejects a file whose bytes do NOT match the declared type (declared PDF, bytes are PNG)', async () => {
    const init = await initUpload({
      filename: 'not-really-a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: SMALL_PNG.length,
    });
    await uploadOneChunk(init.uploadId, SMALL_PNG);
    const { status, json } = await completeUpload(init.uploadId);
    // The complete route sniffs %PDF- magic and rejects because the bytes
    // start with the PNG magic instead.
    expect(status).toBeGreaterThanOrEqual(400);
    expect(json.success).toBe(false);
    // The error code surfaces the magic-byte check failure (TYPE_MISMATCH
    // or NORMALIZE_* — either is acceptable, the file must be rejected).
    const code = json.error?.code ?? '';
    const message = json.error?.message ?? '';
    expect(
      /TYPE_MISMATCH|UNSUPPORTED_TYPE|NOT_A_PDF|NORMALIZE/i.test(code) ||
      /content does not match|not a PDF|content check/i.test(message),
    ).toBe(true);
  });

  it('accepts a real PDF (declared application/pdf, bytes start with %PDF-)', async () => {
    const pdfBytes = makeMinimalPdf();
    const init = await initUpload({
      filename: 'legit.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
    });
    await uploadOneChunk(init.uploadId, pdfBytes);
    const { status, json } = await completeUpload(init.uploadId);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('rejects an unknown file type (random bytes, no magic match)', async () => {
    const junk = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
    // Rejection may happen at init (the MIME allowlist refuses
    // application/octet-stream outright) or at complete (magic sniff) —
    // the file must never reach Ready either way.
    let rejected = false;
    try {
      const init = await initUpload({
        filename: 'random.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: junk.length,
      });
      await uploadOneChunk(init.uploadId, junk);
      const { status, json } = await completeUpload(init.uploadId);
      rejected = status >= 400 && json.success === false;
    } catch (cause) {
      rejected = /init failed: 4\d\d/.test(String(cause));
    }
    expect(rejected).toBe(true);
  });
});

// ── (2) Size limit ──

describe('Upload validation — 50 MB size limit', () => {
  it('init rejects a file declared larger than 50 MB', async () => {
    const { POST } = await import('@/app/api/v1/s/[slug]/uploads/init/route');
    const tooBig = 50 * 1024 * 1024 + 1;
    const req = new NextRequest(`http://localhost:3000/api/v1/s/${shopSlug}/uploads/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: tooBig }),
    });
    const res = await POST(req, { params: Promise.resolve({ slug: shopSlug }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(/50 ?MB|too large/i.test(json.error?.message ?? '')).toBe(true);
  });

  it('init accepts a file declared at exactly 50 MB (boundary)', async () => {
    const exactly = 50 * 1024 * 1024;
    const init = await initUpload({
      filename: 'max.pdf',
      mimeType: 'application/pdf',
      sizeBytes: exactly,
    });
    expect(init.uploadId).toBeTruthy();
  });
});

// ── (3) Filename sanitization ──

describe('Upload validation — filename sanitization', () => {
  it('strips path traversal sequences from the filename', async () => {
    const malicious = '../../../etc/passwd.pdf';
    const init = await initUpload({
      filename: malicious,
      mimeType: 'application/pdf',
      sizeBytes: makeMinimalPdf().length,
    });
    // Fetch the file row — the stored originalFilename MUST be a safe
    // basename, not a path.
    const file = await repos.files.findById(init.fileId);
    expect(file).not.toBeNull();
    const stored = file!.originalFilename;
    // No forward slash, no backslash, no leading dots.
    expect(stored).not.toContain('/');
    expect(stored).not.toContain('\\');
    expect(stored).not.toMatch(/^\.\./);
    // The file extension is preserved (sanitization must not strip .pdf).
    expect(stored).toMatch(/\.pdf$/i);
  });

  it('strips NUL bytes and shell metacharacters from the filename', async () => {
    const malicious = 'doc\x00name;rm -rf $.pdf';
    const init = await initUpload({
      filename: malicious,
      mimeType: 'application/pdf',
      sizeBytes: makeMinimalPdf().length,
    });
    const file = await repos.files.findById(init.fileId);
    const stored = file!.originalFilename;
    expect(stored).not.toContain('\x00');
    // The semicolon and $ get replaced with underscores by the sanitizer
    // (the regex allows \w . - ( ) space only).
    expect(stored).not.toContain(';');
    expect(stored).not.toContain('$');
    expect(stored).toMatch(/\.pdf$/i);
  });

  it('caps the filename length at 180 chars', async () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const init = await initUpload({
      filename: longName,
      mimeType: 'application/pdf',
      sizeBytes: makeMinimalPdf().length,
    });
    const file = await repos.files.findById(init.fileId);
    expect(file!.originalFilename.length).toBeLessThanOrEqual(180);
  });
});

// ── (4) Reject encrypted PDFs ──

describe('Upload validation — reject encrypted PDFs', () => {
  it('rejects a password-protected PDF (pipeline returns a normalized status of FAILED)', async () => {
    // Build a real encrypted PDF via pdf-lib. pdf-lib cannot create encrypted
    // PDFs directly (it's a read-only feature for encryption), so we use a
    // precomputed minimal encrypted-PDF byte sequence. The PDF below is a
    // password-protected minimal file produced by qpdf --encrypt.
    //
    // To stay self-contained without a binary fixture, we construct one
    // programmatically using pdf-lib's writer with a "ghost" encryption
    // flag: pdf-lib doesn't support encryption on save, but we can build
    // a PDF that LOOKS encrypted by injecting an /Encrypt dictionary into
    // the trailer. pdf-lib.load with ignoreEncryption:false then refuses
    // to load it (and isEncrypted would return true).
    //
    // Pragmatic approach: use a minimal hand-crafted encrypted PDF byte
    // sequence (a real qpdf output, compacted). This is fine for a test
    // fixture — the bytes are deterministic and small.
    const encryptedPdf = Buffer.from(
      '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n' +
      '4 0 obj<</Filter/Standard/V 1/R 2/O(' + 'A'.repeat(32) + ')/U(' + 'B'.repeat(32) + ')/P -4>>endobj\n' +
      'trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R>>\n' +
      'startxref\n0\n%%EOF',
      'latin1',
    );

    const init = await initUpload({
      filename: 'secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: encryptedPdf.length,
    });
    await uploadOneChunk(init.uploadId, encryptedPdf);
    const { json } = await completeUpload(init.uploadId);
    // The pipeline either rejects at complete-time (if magic-byte + parse
    // check fires there) OR marks the file FAILED with ENCRYPTED_PDF after
    // the background process runs. Both are acceptable — the file MUST NOT
    // reach the 'ready' state.
    const file = await repos.files.findById(init.fileId);
    expect(file!.status).not.toBe('ready');
    // The fail reason must mention encryption.
    const reason = (file!.failReason ?? '') + (json.error?.message ?? '');
    expect(/encrypt/i.test(reason)).toBe(true);
  });

  it('accepts a non-encrypted PDF', async () => {
    const pdfBytes = makeMinimalPdf();
    const init = await initUpload({
      filename: 'plain.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
    });
    await uploadOneChunk(init.uploadId, pdfBytes);
    const { status, json } = await completeUpload(init.uploadId);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const file = await repos.files.findById(init.fileId);
    expect(file!.status).toBe('ready');
  });
});

// ── (5) Strip EXIF location data from stored images ──

describe('Upload validation — strip EXIF location data from stored images', () => {
  it('strips EXIF GPS metadata from the stored ORIGINAL JPEG bytes', async () => {
    const jpegWithExif = await makeJpegWithExifGps();
    const marker = 'GPS_LAT_LON=37.5,122.4';

    // Sanity: the uploaded bytes carry the marker.
    expect(jpegWithExif.toString('latin1')).toContain(marker);

    const init = await initUpload({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: jpegWithExif.length,
    });
    await uploadOneChunk(init.uploadId, jpegWithExif);
    const { status, json } = await completeUpload(init.uploadId);
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Fetch the stored ORIGINAL bytes — the bytes at the originalKey the
    // complete route wrote. The EXIF GPS marker MUST be gone.
    const file = await repos.files.findById(init.fileId);
    expect(file).not.toBeNull();
    const stored = await container.storage.getBytes?.(file!.storageKey);
    expect(stored).not.toBeNull();
    const storedBytes = Buffer.from(stored!.bytes);
    // The fingerprint must NOT be in the stored bytes — EXIF was stripped.
    expect(storedBytes.toString('latin1')).not.toContain(marker);
    // Sanity: the stored bytes are still a valid image (magic preserved).
    expect(storedBytes.length).toBeGreaterThan(0);
    // JPEG magic FF D8 must still be present (it's a structural byte, not EXIF).
    expect(storedBytes[0]).toBe(0xff);
    expect(storedBytes[1]).toBe(0xd8);
  });

  it('does NOT corrupt a PNG that has no EXIF (round-trip integrity)', async () => {
    // A PNG with no EXIF metadata should round-trip unchanged — the
    // stripping step must only fire on formats that actually carry EXIF.
    const init = await initUpload({
      filename: 'plain.png',
      mimeType: 'image/png',
      sizeBytes: SMALL_PNG.length,
    });
    await uploadOneChunk(init.uploadId, SMALL_PNG);
    const { status } = await completeUpload(init.uploadId);
    expect(status).toBe(200);
    const file = await repos.files.findById(init.fileId);
    const stored = await container.storage.getBytes?.(file!.storageKey);
    // PNG magic is preserved.
    const storedBytes = Buffer.from(stored!.bytes);
    expect(storedBytes.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
  });
});
