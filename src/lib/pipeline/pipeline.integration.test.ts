import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import { normalizePdf, normalizeImage, normalizeOffice, detectKind, sniffKind, NormalizeError } from './normalize';
import { parseInkcovOutput, coverageToSuggestion, suggestColors } from './color-suggest';
import { renderThumbnails } from './thumbnails';
import { processUpload } from './process';
import { setContainerForTesting } from '@/lib/container';
import { repos } from '@/lib/repositories';
import {
  InMemoryDatabaseAdapter,
  InMemoryCacheAdapter,
  InMemoryStorageAdapter,
  InMemoryRealtimeAdapter,
  InMemoryQueueAdapter,
  StubEmailAdapter,
  StubSmsAdapter,
} from '@platform/adapters';
import { JwtAuthAdapter } from '@/lib/auth/jwt-auth.adapter';
import { JsonConsoleLogger } from '@/lib/logger/json-logger.adapter';

/**
 * Phase 2 integration: the REAL toolchain (pdf-lib geometry, sharp for
 * images, Ghostscript inkcov for color detection, pdftoppm for thumbnails)
 * against an in-memory container + storage.
 */

let shopId: string;
let draftOrderId: string;

beforeAll(async () => {
  const db = new InMemoryDatabaseAdapter();
  const cache = new InMemoryCacheAdapter();
  const auth = new JwtAuthAdapter(
    { accessSecret: 'test-access-secret', refreshSecret: 'test-refresh-secret', accessTtlSeconds: 900, refreshTtlSeconds: 2592000 },
    cache,
  );
  setContainerForTesting({
    db,
    storage: new InMemoryStorageAdapter(),
    realtime: new InMemoryRealtimeAdapter(),
    cache,
    queue: new InMemoryQueueAdapter(),
    email: new StubEmailAdapter(),
    sms: new StubSmsAdapter(),
    logger: new JsonConsoleLogger({ service: 'test' }),
    auth,
  } as never);

  const user = await repos.users.create({ email: 'pipe@test.com', phone: '5550000000', password: 'passX123', role: 'owner', shopId: null }, auth);
  shopId = crypto.randomUUID();
  await repos.shops.create({
    id: shopId, name: 'Pipe Shop', slug: `pipe-${shopId.slice(0, 6)}`, ownerUserId: user.id,
    upiId: 'x@upi', paymentProvider: 'manual', paymentCredentials: '', pricingConfig: '{}',
    address: 'X', phone: '5550000000', timezone: 'Asia/Kolkata', isActive: true,
    subscriptionTier: 'free', subscriptionExpiresAt: null, description: null, businessHours: null,
    logoUrl: null, upiQrStorageKey: null, servicesJson: null, paymentPhone: null,
    paymentInstructions: null, cashOnPickup: false, paymentMethods: 'both',
    pamphletEnabled: false, pamphletPricePaise: 0, pamphletName: null,
  } as never);
  await repos.users.update(user.id, { shopId } as never);
  const order = await repos.orders.createWithUniqueToken(shopId, { customerPhone: null, notes: null }, (c, a) => `P${100 + c + a}`);
  draftOrderId = order.id;
});

/** 10-page PDF, pages 3 & 7 have a big saturated color rectangle. */
async function makeMixedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 10; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i}`, { x: 60, y: 780, size: 18 });
    for (let line = 0; line < 6; line++) {
      page.drawRectangle({ x: 60, y: 660 - line * 40, width: 480, height: 2, color: rgb(0.1, 0.1, 0.1) });
    }
    if (i === 3 || i === 7) {
      page.drawRectangle({ x: 60, y: 300, width: 480, height: 320, color: rgb(0.9, 0.1, 0.35) });
    }
  }
  return doc.save();
}

describe('normalize', () => {
  it('detects kinds from mime + extension', () => {
    expect(detectKind('application/pdf', 'a.pdf')).toBe('pdf');
    expect(detectKind('image/jpeg', 'a.jpg')).toBe('image');
    expect(detectKind('image/heic', 'a')).toBe('image');
    expect(detectKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('office');
    expect(detectKind('application/octet-stream', 'a.exe')).toBe('unsupported');
  });

  it('sniffs magic bytes regardless of declared type', () => {
    expect(sniffKind(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('pdf');
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe('zip');
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniffKind(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBe('heic');
  });

  it('reads a real PDF: page count + geometry + checksum', async () => {
    const bytes = await makeMixedPdf();
    const doc = await normalizePdf(bytes);
    expect(doc.pageCount).toBe(10);
    expect(doc.pageWidthPt).toBe(595);
    expect(doc.pageHeightPt).toBe(842);
    expect(doc.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects non-PDF bytes with an honest error', async () => {
    await expect(normalizePdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(NormalizeError);
    await expect(normalizePdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(/does not look like a PDF/i);
  });

  it('converts a real PNG image to a single-page PDF (sharp)', async () => {
    // generate a small PNG via sharp
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3355aa' } }).png().toBuffer();
    const doc = await normalizeImage(new Uint8Array(png));
    expect(doc.pageCount).toBe(1);
    expect(doc.pageWidthPt).toBeGreaterThan(0);
    // normalized output IS a pdf
    expect(sniffKind(doc.pdfBytes)).toBe('pdf');
  });

  it('REAL LibreOffice: DOCX fixture converts to a readable PDF', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/sample.docx', import.meta.url)));
    const doc = await normalizeOffice(bytes, 'sample.docx');
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    expect(sniffKind(doc.pdfBytes)).toBe('pdf');
    expect(doc.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('color suggestion', () => {
  it('parses inkcov output lines', () => {
    const rows = parseInkcovOutput(
      'Page 1 CoverCMYK C=0.000000 M=0.000000 Y=0.000000 K=0.966500\nPage 2 CoverCMYK C=0.220000 M=0.860000 Y=0.010000 K=0.120000',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].m).toBeCloseTo(0.86);
  });

  it('flags near-gray and K-only pages as B&W, saturated pages as color', () => {
    const s = coverageToSuggestion([
      { c: 0.0, m: 0.0, y: 0.0, k: 0.96 },          // K-only text page
      { c: 0.0001, m: 0.0002, y: 0.0003, k: 0.85 }, // grayish — under threshold
      { c: 0.22, m: 0.86, y: 0.01, k: 0.12 },       // saturated color
      { c: 0.00043, m: 0.00043, y: 0.00043, k: 0.00043 }, // this build's gray
      { c: 0.30820, m: 0.30820, y: 0.30820, k: 0.00046 }, // this build's color page
    ]);
    expect(s[0].isColor).toBe(false);
    expect(s[1].isColor).toBe(false);
    expect(s[2].isColor).toBe(true);
    expect(s[3].isColor).toBe(false);
    expect(s[4].isColor).toBe(true);
    expect(s[2].confidence).toBeGreaterThan(0.9);
  });

  it('REAL gs inkcov: the mixed doc suggests exactly pages 3 and 7 as color', async () => {
    const bytes = await makeMixedPdf();
    const result = await suggestColors(bytes);
    expect(result.source).toBe('inkcov'); // gs IS available in this environment
    expect(result.pages).toHaveLength(10);
    const colorPages = result.pages.filter(p => p.isColor).map(p => p.page);
    expect(colorPages).toEqual([3, 7]);
  });
});

describe('thumbnails', () => {
  it('renders one real PNG per page via pdftoppm', async () => {
    const bytes = await makeMixedPdf();
    const thumbs = await renderThumbnails(bytes, 10);
    expect(thumbs).toHaveLength(10);
    expect(thumbs[2].page).toBe(3);
    expect(thumbs[0].png[0]).toBe(0x89); // PNG magic
    expect(thumbs[0].png.length).toBeGreaterThan(500);
  });
});

describe('processUpload — end to end through the pipeline', () => {
  it('UPLOADED → CONVERTING → READY with normalized pdf, suggestion and thumbnails stored', async () => {
    const bytes = await makeMixedPdf();
    const file = await repos.files.create({
      orderId: draftOrderId,
      originalFilename: 'assignment-final.pdf',
      storageKey: `shops/${shopId}/orders/${draftOrderId}/orig/assignment-final.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      pageCount: null,
      status: 'uploaded',
    });
    await getContainerForTest().storage.put?.(file.storageKey, bytes, 'application/pdf');

    const result = await processUpload(file.id);
    expect(result.status).toBe('READY');

    const updated = await repos.files.findById(file.id);
    expect(updated?.status).toBe('ready');
    expect(updated?.pageCount).toBe(10);
    expect(updated?.pageWidthPt).toBe(595);
    expect(updated?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(updated?.pdfStorageKey).toContain('/pdf/');
    const suggestion = updated?.colorSuggestion as Array<{ page: number; isColor: boolean }>;
    const colorPages = suggestion.filter(p => p.isColor).map(p => p.page);
    expect(colorPages).toEqual([3, 7]);

    // thumbnails stored
    const storage = getContainerForTest().storage;
    expect(await storage.head(`shops/${shopId}/orders/${draftOrderId}/thumbs/${file.id}/assignment-final-1.png`)).not.toBeNull();
    expect(await storage.head(`shops/${shopId}/orders/${draftOrderId}/thumbs/${file.id}/assignment-final-7.png`)).not.toBeNull();
  });

  it('a corrupt file lands FAILED with an honest reason', async () => {
    const file = await repos.files.create({
      orderId: draftOrderId,
      originalFilename: 'broken.pdf',
      storageKey: `shops/${shopId}/orders/${draftOrderId}/orig/broken.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 3,
      pageCount: null,
      status: 'uploaded',
    });
    await getContainerForTest().storage.put?.(file.storageKey, new Uint8Array([1, 2, 3]), 'application/pdf');
    const result = await processUpload(file.id);
    expect(result.status).toBe('FAILED');
    const updated = await repos.files.findById(file.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.failReason).toContain('NOT_A_PDF');
  });

  // AUDIT P0-2 regression: an unsupported file type (plain text) must FAIL —
  // the old dev fallback marked it "Ready — 1 page".
  it('a .txt upload lands FAILED (unsupported type), never Ready', async () => {
    const bytes = new TextEncoder().encode('plain notes, not a document');
    const file = await repos.files.create({
      orderId: draftOrderId,
      originalFilename: 'notes.txt',
      storageKey: `shops/${shopId}/orders/${draftOrderId}/orig/notes.txt`,
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      pageCount: null,
      status: 'uploaded',
    });
    await getContainerForTest().storage.put?.(file.storageKey, bytes, 'text/plain');
    const result = await processUpload(file.id);
    expect(result.status).toBe('FAILED');
    const updated = await repos.files.findById(file.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.failReason).toMatch(/UNSUPPORTED|NOT_A_PDF/);
  });

  // AUDIT P0-3 regression: a large garbage "PDF" must FAIL — the old dev
  // fallback estimated pageCount from byte size (15 MB → "318 pages") and
  // priced the order on the invented number.
  it('a 15 MB garbage "PDF" lands FAILED with no fabricated page count', async () => {
    const bytes = new Uint8Array(15 * 1024 * 1024);
    for (let off = 0; off < bytes.length; off += 65536) {
      crypto.getRandomValues(bytes.subarray(off, Math.min(off + 65536, bytes.length)));
    }
    const file = await repos.files.create({
      orderId: draftOrderId,
      originalFilename: 'garbage.pdf',
      storageKey: `shops/${shopId}/orders/${draftOrderId}/orig/garbage.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      pageCount: null,
      status: 'uploaded',
    });
    await getContainerForTest().storage.put?.(file.storageKey, bytes, 'application/pdf');
    const result = await processUpload(file.id);
    expect(result.status).toBe('FAILED');
    const updated = await repos.files.findById(file.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.pageCount ?? 0).toBeLessThanOrEqual(0);
    expect(updated?.failReason).toMatch(/CORRUPT_PDF|NOT_A_PDF/);
  });
});

// tiny helper so the tests above read cleanly
import { getContainer } from '@/lib/container';
function getContainerForTest() {
  return getContainer();
}
