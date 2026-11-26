/**
 * Smart Print Studio — API layer.
 *
 * Thin wrappers over the EXISTING Printelyx backend. Every function maps
 * 1:1 to a route that already exists — no new endpoints, no mock data.
 *
 * Routes reused (consumer chunked-upload path):
 *   POST /api/v1/s/[slug]/uploads/init      → startUpload
 *   PUT  /api/v1/s/[slug]/uploads/chunk     → uploadChunk
 *   DELETE /api/v1/s/[slug]/uploads/chunk   → cancelUpload
 *   POST /api/v1/s/[slug]/uploads/complete  → completeUpload
 *   GET  /api/v1/s/[slug]/uploads/status    → uploadStatus
 *   GET  /api/v1/s/[slug]/files/[fileId]    → pollFile
 *   POST /api/v1/s/[slug]/quote             → fetchQuote
 *   PUT  /api/v1/s/[slug]/specs             → saveSpec
 *   POST /api/v1/s/[slug]/orders            → placeOrder
 *   POST /api/v1/o/[token]/payment          → submitPayment
 */

import type { Quote, ApiPageMode, PrintSettings, PlacedOrder } from './types';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB — matches the server's chunkSize
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MAX_ORDER_BYTES = 200 * 1024 * 1024; // 200 MB per order

export { CHUNK_SIZE, MAX_FILE_BYTES, MAX_ORDER_BYTES };

/** SHA-256 hex of a Blob (WebCrypto). Used for per-chunk checksums. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Retry with exponential backoff (1s → 2s → 4s → 8s). 4 attempts. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = (err as Error & { code?: string }).code;
      // Don't retry on client errors that won't fix themselves.
      if (code === 'CHECKSUM_MISMATCH' || code === 'CHUNK_CONFLICT') throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

interface InitResponse {
  orderId: string;
  orderToken: string;
  fileId: string;
  uploadId: string;
  chunkSize: number;
  status: string;
}

/** POST /uploads/init — start a chunked upload session. */
export async function startUpload(
  shopSlug: string,
  file: { name: string; type: string; size: number },
  existingOrderId?: string,
  existingOrderToken?: string,
): Promise<InitResponse> {
  const res = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      orderId: existingOrderId,
      orderToken: existingOrderToken,
    }),
  });
  const body = (await res.json()) as { data?: InitResponse; error?: { message?: string; code?: string } };
  if (!res.ok || !body.data) {
    throw new Error(body?.error?.message ?? 'Could not start the upload');
  }
  return body.data;
}

/** PUT /uploads/chunk — upload one chunk with a SHA-256 checksum. */
export async function uploadChunk(
  shopSlug: string,
  uploadId: string,
  index: number,
  chunk: Blob,
): Promise<{ receivedBytes: number; chunkIndex: number; duplicated: boolean }> {
  const checksum = await sha256Hex(chunk);
  const res = await fetch(
    `/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}&index=${index}&checksum=${checksum}`,
    { method: 'PUT', body: chunk },
  );
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } };
    const err = new Error(e?.error?.message ?? 'Upload failed');
    if (e?.error?.code) (err as Error & { code?: string }).code = e.error.code;
    throw err;
  }
  const body = (await res.json()) as { data?: { receivedBytes: number; chunkIndex: number; duplicated: boolean } };
  return body.data ?? { receivedBytes: chunk.size, chunkIndex: index, duplicated: false };
}

/** DELETE /uploads/chunk — cancel/abandon a session (cleans up partial bytes). */
export async function cancelUpload(shopSlug: string, uploadId: string): Promise<void> {
  await fetch(`/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}`, { method: 'DELETE' });
}

/** GET /uploads/status — query the missing-chunk offset for resume. */
export async function uploadStatus(
  shopSlug: string,
  uploadId: string,
): Promise<{ missingChunks: number[]; status: 'active' | 'expired' | 'completed'; complete: boolean } | null> {
  const res = await fetch(`/api/v1/s/${shopSlug}/uploads/status?uploadId=${uploadId}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: { missingChunks: number[]; status: 'active' | 'expired' | 'completed'; complete: boolean };
  };
  return body.data ?? null;
}

/** POST /uploads/complete — finish assembly, triggers server-side processing. */
export async function completeUpload(shopSlug: string, uploadId: string): Promise<void> {
  const res = await fetch(`/api/v1/s/${shopSlug}/uploads/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } };
    throw new Error(e?.error?.message ?? 'Processing failed');
  }
}

interface FileStatusResponse {
  fileId: string;
  orderId: string;
  status: string;
  pageCount: number | null;
  pageWidthPt: number | null;
  pageHeightPt: number | null;
  failReason: string | null;
  colorSuggestion: Array<{ page: number; isColor: boolean }> | null;
  thumbnails: Array<{ page: number; url: string }>;
}

/** GET /files/[fileId] — poll a file's processing status + thumbnails. */
export async function pollFile(shopSlug: string, fileId: string, orderToken: string): Promise<FileStatusResponse | null> {
  const res = await fetch(`/api/v1/s/${shopSlug}/files/${fileId}?token=${orderToken}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: FileStatusResponse };
  return body.data ?? null;
}

/** Build the pageModes array the quote API expects (1..pageCount). */
function buildPageModes(
  pageCount: number,
  settings: PrintSettings,
): Array<{ page: number; mode: ApiPageMode }> {
  const colourSet = new Set(settings.colourPages);
  const skipSet = new Set(settings.skipPages);
  return Array.from({ length: pageCount }, (_, i) => {
    const page = i + 1;
    let mode: ApiPageMode = 'bw';
    if (skipSet.has(page)) mode = 'skip';
    else if (settings.mode === 'colour' || (settings.mode === 'mixed' && colourSet.has(page))) mode = 'color';
    return { page, mode };
  });
}

/** POST /quote — fetch a server-authoritative price estimate. */
export async function fetchQuote(
  shopSlug: string,
  files: Array<{ fileId: string; pageCount: number; settings: PrintSettings }>,
  addonIds: string[] = [],
): Promise<Quote> {
  const res = await fetch(`/api/v1/s/${shopSlug}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: files.map((f) => ({
        fileId: f.fileId,
        spec: {
          pageModes: buildPageModes(f.pageCount, f.settings),
          copies: f.settings.copies,
          sides: f.settings.sides,
          pagesPerSheet: f.settings.pagesPerSheet,
          paperSize: f.settings.paperSize,
          paperType: f.settings.paperType,
          collate: f.settings.collate,
        },
      })),
      addonIds,
      urgent: false,
    }),
  });
  const body = (await res.json()) as { data?: Quote; error?: { message?: string } };
  if (!res.ok || !body.data) {
    throw new Error(body?.error?.message ?? 'Could not price the order');
  }
  return body.data;
}

/** PUT /specs — persist per-file print settings (required before placeOrder). */
export async function saveSpec(
  shopSlug: string,
  params: {
    orderId: string;
    orderToken: string;
    fileId: string;
    pageCount: number;
    settings: PrintSettings;
  },
): Promise<void> {
  const colourPages: number[] = [];
  const skipPages: number[] = [];
  for (let p = 1; p <= params.pageCount; p++) {
    if (params.settings.mode === 'colour') colourPages.push(p);
    else if (params.settings.mode === 'mixed' && params.settings.colourPages.includes(p)) colourPages.push(p);
    if (params.settings.skipPages.includes(p)) skipPages.push(p);
  }
  const res = await fetch(`/api/v1/s/${shopSlug}/specs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: params.orderId,
      orderToken: params.orderToken,
      fileId: params.fileId,
      pageRangeText: '',
      copies: params.settings.copies,
      sides: params.settings.sides,
      pagesPerSheet: params.settings.pagesPerSheet,
      paperSize: params.settings.paperSize,
      paperType: params.settings.paperType,
      collate: params.settings.collate,
      colorPages: colourPages,
      skipPages,
    }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
    throw new Error(e?.error?.message ?? 'Could not save print settings');
  }
}

/** POST /orders — place the order (server re-prices; 409 PRICES_CHANGED on mismatch). */
export async function placeOrder(
  shopSlug: string,
  params: {
    orderId: string;
    orderToken: string;
    addonIds: string[];
    customerName: string | null;
    customerPhone: string | null;
    note: string | null;
    clientTotalPaise: number | null;
    authToken?: string | null;
  },
): Promise<{ ok: true; data: PlacedOrder } | { ok: false; code: 'PRICES_CHANGED'; newTotal: number | null; message: string } | { ok: false; code: 'OTHER'; message: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.authToken) headers.Authorization = `Bearer ${params.authToken}`;
  const res = await fetch(`/api/v1/s/${shopSlug}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      orderId: params.orderId,
      orderToken: params.orderToken,
      addonIds: params.addonIds,
      urgent: false,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      note: params.note,
      clientTotalPaise: params.clientTotalPaise,
    }),
  });
  const body = (await res.json()) as {
    data?: PlaceOrderResponse;
    error?: { code?: string; message?: string };
  };
  if (res.status === 409 && body?.error?.code === 'PRICES_CHANGED') {
    return { ok: false, code: 'PRICES_CHANGED', newTotal: body.data?.totalPaise ?? null, message: body.error.message ?? 'Prices changed' };
  }
  if (!res.ok || !body.data) {
    return { ok: false, code: 'OTHER', message: body?.error?.message ?? 'Could not place the order' };
  }
  return { ok: true, data: { token: body.data.token, orderNumber: body.data.orderNumber, pickupCode: body.data.pickupCode, totalPaise: body.data.totalPaise, placedAt: Date.now() } };
}

/** POST /o/[token]/payment — submit a UTR or choose counter payment. */
export async function submitPayment(
  orderToken: string,
  params: { method: 'upi' | 'counter_cash' | 'counter_upi'; utr?: string; declaredAmountPaise?: number | null },
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/v1/o/${orderToken}/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) return { ok: false, message: body?.error?.message ?? 'Payment submission failed' };
  return { ok: true };
}
