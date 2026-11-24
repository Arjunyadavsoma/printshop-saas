/**
 * Chunked-upload session registry (Phase 2, enhanced P8.7).
 *
 * DB-backed (production fix, 2026-11). Sessions + chunks live in the
 * Postgres `UploadSession` / `UploadChunk` tables via the container's
 * database adapter, so every serverless instance shares the same state.
 * The previous implementation kept a module-level Map + /tmp chunk files:
 * correct for a single process, but on Vercel each lambda instance has its
 * own Map — `init` could land on instance A while `chunk`/`complete` hit
 * instance B, which answered "Upload session not found" and the customer
 * saw "Failed to process — tap to retry" even though the bytes had arrived.
 *
 * The route contract is unchanged (init → chunk → complete → poll files):
 *   - Per-chunk checksum (SHA-256 of the chunk body). The client computes
 *     the checksum + sends it as `?checksum=`; the server verifies before
 *     writing. A mismatched checksum is rejected (transit corruption).
 *   - Idempotent chunk writes. Re-uploading the same chunk index with
 *     the same checksum is a no-op (returns `{ duplicated: true }`). Re-
 *     uploading the same index with a DIFFERENT checksum throws
 *     CHUNK_CONFLICT — the client must restart the session.
 *   - Completion verification. `finishSession` checks that the sum of
 *     received chunk sizes equals `declaredSize` — a truncated final chunk
 *     or a missing middle chunk is caught before the pipeline runs.
 *   - Offset query. `getStatus` returns `{ receivedBytes, totalBytes,
 *     missingChunks, complete }` so a resuming client can skip the chunks
 *     already received.
 *   - Janitor hook. `expireOldSessions` deletes sessions older than 1 hour
 *     with no recent chunk activity (called by the /api/v1/cron/cleanup-uploads
 *     cron endpoint; the UploadChunk FK cascades the chunk rows).
 *
 * Production upgrade path (S3/R2 multipart with presigned URLs) keeps this
 * exact route contract — see docs/ARCHITECTURE.md §3.2.
 */

import { createHash } from 'node:crypto';
import { getContainer } from '@/lib/container';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;      // per file
export const MAX_ORDER_BYTES = 200 * 1024 * 1024;    // per order
export const CHUNK_SIZE = 2 * 1024 * 1024;           // client chunk size

/** Sessions older than this with no chunk activity are expired by the janitor. */
export const SESSION_EXPIRY_MS = 60 * 60 * 1000;     // 1 hour

export type UploadSession = {
  uploadId: string;
  fileId: string;
  orderId: string;
  orderToken: string;
  shopId: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunkSize: number;
  createdAt: number;
  /** Updated on every successful chunk write — used by the janitor. */
  lastChunkAt: number;
  /** 'active' while uploads are accepted; 'expired' after the janitor runs;
   * 'completed' after `finishSession` succeeds. */
  status: 'active' | 'expired' | 'completed';
};

type SessionRow = {
  uploadId: string;
  fileId: string;
  orderId: string;
  orderToken: string;
  shopId: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunkSize: number;
  status: string;
  createdAt: Date | string;
  lastChunkAt: Date | string;
};

type ChunkRow = {
  uploadId: string;
  idx: number;
  checksum: string;
  size: number;
  bytes: Uint8Array;
};

/** The container's database adapter (Prisma/Postgres in prod, in-memory in tests). */
function db() {
  return getContainer().db;
}

function rowToSession(r: SessionRow): UploadSession {
  return {
    uploadId: r.uploadId,
    fileId: r.fileId,
    orderId: r.orderId,
    orderToken: r.orderToken,
    shopId: r.shopId,
    filename: r.filename,
    mimeType: r.mimeType,
    declaredSize: r.declaredSize,
    chunkSize: r.chunkSize,
    createdAt: new Date(r.createdAt).getTime(),
    lastChunkAt: new Date(r.lastChunkAt).getTime(),
    status: (r.status === 'completed' || r.status === 'expired' ? r.status : 'active'),
  };
}

/** SHA-256 hex of a byte payload. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface CreateSessionInput {
  fileId: string;
  orderId: string;
  orderToken: string;
  shopId: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  /** Optional chunk size override (defaults to CHUNK_SIZE). */
  chunkSize?: number;
}

export async function createSession(input: CreateSessionInput): Promise<string> {
  const uploadId = crypto.randomUUID();
  const now = new Date();
  await db().insert('uploadSession', {
    uploadId,
    fileId: input.fileId,
    orderId: input.orderId,
    orderToken: input.orderToken,
    shopId: input.shopId,
    filename: input.filename,
    mimeType: input.mimeType,
    declaredSize: input.declaredSize,
    chunkSize: input.chunkSize ?? CHUNK_SIZE,
    status: 'active',
    createdAt: now,
    lastChunkAt: now,
  });
  return uploadId;
}

export async function getSession(uploadId: string): Promise<UploadSession | null> {
  if (!uploadId) return null;
  const row = await db().findOne<SessionRow>('uploadSession', { uploadId });
  return row ? rowToSession(row) : null;
}

/** The expected total chunk count for a session (ceil(declaredSize / chunkSize)). */
function expectedChunkCount(s: UploadSession): number {
  return Math.max(1, Math.ceil(s.declaredSize / s.chunkSize));
}

/** Chunk rows for a session, in index order (a 50 MB file is ≤ 25 rows). */
async function chunkRows(uploadId: string): Promise<ChunkRow[]> {
  return db().findMany<ChunkRow>('uploadChunk', { uploadId }, { limit: 1000, order: ['idx', 'asc'] });
}

/** Sum of received chunk sizes. */
function totalReceived(chunks: ChunkRow[]): number {
  let n = 0;
  for (const c of chunks) n += c.size;
  return n;
}

export interface AppendChunkResult {
  /** Total bytes received across all chunks so far. */
  receivedBytes: number;
  /** True when this call was a no-op (same index + same checksum). */
  duplicated: boolean;
  /** The chunk index that was just written. */
  chunkIndex: number;
}

/**
 * Append (or re-upload idempotently) one chunk.
 *
 * @param uploadId  The session id.
 * @param chunkIndex  0-based chunk index.
 * @param bytes    The raw chunk body.
 * @param checksum  SHA-256 hex of `bytes` (the client computes this).
 * @returns `{ receivedBytes, duplicated, chunkIndex }`.
 * @throws `UPLOAD_NOT_FOUND` — session missing or expired.
 * @throws `UPLOAD_EXPIRED` — session was swept by the janitor.
 * @throws `EMPTY_CHUNK` — zero-byte body.
 * @throws `CHECKSUM_MISMATCH` — `checksum` doesn't match `sha256(bytes)`.
 * @throws `CHUNK_CONFLICT` — `chunkIndex` already received with a different checksum.
 * @throws `FILE_TOO_LARGE` — total would exceed MAX_FILE_BYTES.
 */
export async function appendChunk(
  uploadId: string,
  chunkIndex: number,
  bytes: Uint8Array,
  checksum: string,
): Promise<AppendChunkResult> {
  const s = await getSession(uploadId);
  if (!s) throw new Error('UPLOAD_NOT_FOUND');
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');
  if (bytes.length === 0) throw new Error('EMPTY_CHUNK');

  // Verify the checksum BEFORE writing — catches transit corruption without
  // storing a poisoned row (a corrupted chunk never enters the DB).
  const actual = sha256Hex(bytes);
  if (actual !== checksum) throw new Error('CHECKSUM_MISMATCH');

  const existing = await db().findOne<ChunkRow>('uploadChunk', { uploadId, idx: chunkIndex });
  if (existing) {
    if (existing.checksum === checksum && existing.size === bytes.length) {
      const chunks = await chunkRows(uploadId);
      return { receivedBytes: totalReceived(chunks), duplicated: true, chunkIndex };
    }
    // Same index, different content — the client must restart the session.
    throw new Error('CHUNK_CONFLICT');
  }

  // Per-file size guard.
  const received = await chunkRows(uploadId);
  if (totalReceived(received) + bytes.length > MAX_FILE_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  await db().insert('uploadChunk', {
    uploadId,
    idx: chunkIndex,
    checksum,
    size: bytes.length,
    bytes,
  });
  await db().update('uploadSession', { uploadId }, { lastChunkAt: new Date() });

  return { receivedBytes: totalReceived(received) + bytes.length, duplicated: false, chunkIndex };
}

export interface SessionStatus {
  uploadId: string;
  receivedBytes: number;
  totalBytes: number;
  /** 0-based chunk indices that haven't been received yet. */
  missingChunks: number[];
  /** True when every expected chunk is present. */
  complete: boolean;
  /** 'active' | 'expired' | 'completed'. */
  status: UploadSession['status'];
}

/** Offset query for resumption: what's already received, what's missing. */
export async function getStatus(uploadId: string): Promise<SessionStatus | null> {
  const s = await getSession(uploadId);
  if (!s) return null;
  const chunks = await chunkRows(uploadId);
  const have = new Set(chunks.map((c) => c.idx));
  const total = expectedChunkCount(s);
  const missing: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!have.has(i)) missing.push(i);
  }
  return {
    uploadId,
    receivedBytes: totalReceived(chunks),
    totalBytes: s.declaredSize,
    missingChunks: missing,
    complete: missing.length === 0,
    status: s.status,
  };
}

/**
 * Assemble the uploaded original. Verifies the total bytes match the
 * declared size (catches a truncated final chunk or a missing middle chunk
 * before the pipeline runs). Deletes the chunk rows + session row on
 * success (the file bytes now live in the StorageProvider).
 */
export async function finishSession(uploadId: string): Promise<{ bytes: Uint8Array; session: UploadSession } | null> {
  const s = await getSession(uploadId);
  if (!s) return null;
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');

  const chunks = await chunkRows(uploadId);
  const received = totalReceived(chunks);
  // Completion verification — the declared size is the contract. A mismatch
  // means a chunk was lost or the client lied about the size; either way,
  // refuse to assemble.
  if (received !== s.declaredSize) {
    throw new Error(`SIZE_MISMATCH: declared=${s.declaredSize}, received=${received}`);
  }
  // Every expected chunk must be present (the janitor + status endpoint
  // also enforce this, but a race could leave a gap).
  const expected = expectedChunkCount(s);
  const have = new Set(chunks.map((c) => c.idx));
  for (let i = 0; i < expected; i++) {
    if (!have.has(i)) throw new Error(`MISSING_CHUNK: index=${i}`);
  }

  // Assemble in index order.
  const parts: Buffer[] = chunks.map((c) => Buffer.from(c.bytes));
  const bytes = new Uint8Array(Buffer.concat(parts));

  // Verify the assembled bytes match the declared size (paranoid — the
  // per-chunk sizes already summed to this, but a corrupt row could still
  // surprise us).
  if (bytes.length !== s.declaredSize) {
    throw new Error(`ASSEMBLED_SIZE_MISMATCH: declared=${s.declaredSize}, assembled=${bytes.length}`);
  }

  // The bytes now live in the StorageProvider — drop the session + chunks.
  await db().delete('uploadChunk', { uploadId });
  await db().delete('uploadSession', { uploadId });
  return { bytes, session: { ...s, status: 'completed' } };
}

/** Cancel + clean up a session (customer cancelled mid-upload). */
export async function abandonSession(uploadId: string): Promise<void> {
  if (!uploadId) return;
  await db().delete('uploadChunk', { uploadId });
  await db().delete('uploadSession', { uploadId });
}

/**
 * Janitor hook: expire sessions older than the TTL with no recent chunk
 * activity. Called by /api/v1/cron/cleanup-uploads (hourly cron).
 *
 * @returns the number of sessions expired.
 */
export async function expireOldSessions(now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - SESSION_EXPIRY_MS);
  const stale = await db().findMany<SessionRow>(
    'uploadSession',
    { status: 'active' },
    { limit: 1000 },
  );
  let expired = 0;
  for (const r of stale) {
    if (new Date(r.lastChunkAt) > cutoff) continue;
    await db().delete('uploadChunk', { uploadId: r.uploadId });
    await db().delete('uploadSession', { uploadId: r.uploadId });
    expired += 1;
  }
  return expired;
}

/**
 * Dev/diagnostic: count active sessions (for a health endpoint). Not used
 * by the cron; useful for inspecting the registry during local testing.
 */
export async function activeSessionCount(): Promise<number> {
  return db().count('uploadSession', { status: 'active' });
}
