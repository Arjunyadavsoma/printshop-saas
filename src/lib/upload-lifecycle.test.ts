import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryStorageAdapter } from '@platform/adapters';

/**
 * Upload lifecycle regression tests — verify the storage adapter's
 * presigned-URL → PUT → HEAD → confirm flow works correctly.
 *
 * ROOT CAUSE CONTEXT: the production customer upload was failing because
 * the CSP's `connect-src 'self'` blocked the XHR PUT to the cross-origin
 * Supabase Storage URL. The fix adds the Supabase origin (from
 * `process.env.SUPABASE_URL`) to `connect-src` + `img-src`.
 *
 * These tests verify the STORAGE layer (not the CSP — the CSP is tested
 * separately below). The storage tests use the InMemoryStorageAdapter
 * (the dev-mode adapter) to verify the presigned-URL → PUT → HEAD →
 * getBytes lifecycle that the upload-url + confirm APIs depend on.
 */

describe('InMemoryStorageAdapter — upload lifecycle (presign → PUT → HEAD → getBytes)', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('presigned upload URL is a relative /api/v1/storage/put path', async () => {
    const url = await storage.getPresignedUploadUrl({
      key: 'shops/shop-1/orders/order-1/file-1',
      contentType: 'application/pdf',
      contentLength: 100,
      expiresInSeconds: 300,
    });
    expect(url).toMatch(/^\/api\/v1\/storage\/put\?/);
    expect(url).toContain('key=shops');
    expect(url).toContain('sig=');
    expect(url).toContain('exp=');
    expect(url).toContain('ct=application');
  });

  it('PUT stores bytes + HEAD finds them + getBytes retrieves them', async () => {
    const key = 'shops/shop-1/orders/order-1/file-1';
    const bytes = new TextEncoder().encode('%PDF-1.4 test content');
    const contentType = 'application/pdf';

    // PUT (store the file)
    await storage.put(key, bytes, contentType);

    // HEAD (verify the file exists — the confirm API uses this)
    const head = await storage.head(key);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(bytes.length);
    expect(head!.contentType).toBe(contentType);

    // getBytes (retrieve the file — the confirm API uses this for page-count parsing)
    const retrieved = await storage.getBytes(key);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.bytes.length).toBe(bytes.length);
    expect(retrieved!.contentType).toBe(contentType);
    // Verify the bytes match
    expect(new TextDecoder().decode(retrieved!.bytes)).toBe('%PDF-1.4 test content');
  });

  it('HEAD returns null for a non-existent key', async () => {
    const head = await storage.head('shops/shop-1/orders/order-1/non-existent');
    expect(head).toBeNull();
  });

  it('getBytes returns null for a non-existent key', async () => {
    const retrieved = await storage.getBytes('shops/shop-1/orders/order-1/non-existent');
    expect(retrieved).toBeNull();
  });

  it('PUT (upsert) replaces existing bytes', async () => {
    const key = 'shops/shop-1/orders/order-1/file-1';
    await storage.put(key, new TextEncoder().encode('original'), 'text/plain');
    await storage.put(key, new TextEncoder().encode('replaced'), 'text/plain');
    const retrieved = await storage.getBytes(key);
    expect(new TextDecoder().decode(retrieved!.bytes)).toBe('replaced');
  });

  it('presigned download URL is a relative /api/v1/storage/get path', async () => {
    const url = await storage.getPresignedDownloadUrl('shops/shop-1/orders/order-1/file-1', 900);
    expect(url).toMatch(/^\/api\/v1\/storage\/get\?/);
    expect(url).toContain('key=shops');
    expect(url).toContain('sig=');
  });

  it('delete removes the object', async () => {
    const key = 'shops/shop-1/orders/order-1/file-1';
    await storage.put(key, new TextEncoder().encode('test'), 'text/plain');
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.getBytes(key)).toBeNull();
  });

  it('upload + confirm lifecycle (full round-trip)', async () => {
    // Simulate the full upload flow:
    // 1. Mint presigned upload URL
    // 2. PUT bytes to storage
    // 3. HEAD to verify the file landed (confirm API uses this)
    // 4. getBytes to parse page count (confirm API uses this)
    // 5. Verify the bytes match
    const key = 'shops/shop-1/orders/order-1/file-abc';
    const fileBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 /Root 1 0 R >>\nstartxref\n0\n%%EOF');
    const contentType = 'application/pdf';

    // 1. Mint URL
    const uploadUrl = await storage.getPresignedUploadUrl({
      key, contentType, contentLength: fileBytes.length, expiresInSeconds: 300,
    });
    expect(uploadUrl).toMatch(/^\/api\/v1\/storage\/put\?/);

    // 2. PUT
    await storage.put(key, fileBytes, contentType);

    // 3. HEAD
    const head = await storage.head(key);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(fileBytes.length);

    // 4. getBytes
    const retrieved = await storage.getBytes(key);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.bytes.length).toBe(fileBytes.length);
    expect(retrieved!.contentType).toBe(contentType);

    // 5. Verify bytes match
    const decoded = new TextDecoder().decode(retrieved!.bytes);
    expect(decoded).toContain('%PDF-1.4');
  });

  it('multiple files in the same order have independent storage keys', async () => {
    const orderKey = 'shops/shop-1/orders/order-1';
    const file1Key = `${orderKey}/file-aaa`;
    const file2Key = `${orderKey}/file-bbb`;

    await storage.put(file1Key, new TextEncoder().encode('file 1 content'), 'text/plain');
    await storage.put(file2Key, new TextEncoder().encode('file 2 content'), 'text/plain');

    const h1 = await storage.head(file1Key);
    const h2 = await storage.head(file2Key);
    expect(h1!.size).toBe(14); // "file 1 content" = 14 bytes
    expect(h2!.size).toBe(14); // "file 2 content"

    const r1 = await storage.getBytes(file1Key);
    const r2 = await storage.getBytes(file2Key);
    expect(new TextDecoder().decode(r1!.bytes)).toBe('file 1 content');
    expect(new TextDecoder().decode(r2!.bytes)).toBe('file 2 content');
  });
});

/**
 * CSP middleware regression test — verifies the Content-Security-Policy
 * includes the Supabase Storage origin when SUPABASE_URL is set.
 *
 * ROOT CAUSE: the CSP's `connect-src 'self'` blocked the XHR PUT to the
 * cross-origin Supabase Storage URL → "Network error during upload" on
 * the customer order page. The fix adds the Supabase origin to
 * `connect-src` + `img-src`.
 */
describe('CSP middleware — Supabase origin in connect-src (ROOT CAUSE FIX)', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;

  afterEach(() => {
    // Restore the original env var.
    if (originalSupabaseUrl !== undefined) {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    } else {
      delete process.env.SUPABASE_URL;
    }
  });

  it('includes the Supabase origin in connect-src when SUPABASE_URL is set', async () => {
    process.env.SUPABASE_URL = 'https://duyharicyurufmsjyhgs.supabase.co';
    // Re-import the middleware to pick up the env var.
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://duyharicyurufmsjyhgs.supabase.co');
  });

  it('includes the Supabase origin in img-src when SUPABASE_URL is set', async () => {
    process.env.SUPABASE_URL = 'https://duyharicyurufmsjyhgs.supabase.co';
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('img-src');
    expect(csp).toContain('https://duyharicyurufmsjyhgs.supabase.co');
  });

  it('does NOT include a Supabase origin when SUPABASE_URL is NOT set (dev mode)', async () => {
    delete process.env.SUPABASE_URL;
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('supabase.co');
  });

  it('still includes all the security headers (X-Content-Type-Options, X-Frame-Options, etc.)', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('handles an invalid SUPABASE_URL gracefully (no crash, no Supabase in CSP)', async () => {
    process.env.SUPABASE_URL = 'not-a-valid-url';
    vi.resetModules();
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost:3000/');
    const res = middleware(req);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    // Should not crash + should not include the invalid URL
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('not-a-valid-url');
  });
});
