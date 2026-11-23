/**
 * Chunked-upload session registry (Phase 2, enhanced P8.7).
 *
 * Server-local (dev / single-process). Each session writes chunks to a
 * per-session directory under the OS temp dir; `complete` assembles +
 * validates the original bytes, stores them via the StorageProvider and
 * hands off to the pipeline. Production upgrade path: S3/R2 multipart
 * upload with the same route contract (see docs/ARCHITECTURE.md §3.2).
 *
 * P8.7 enhancements (resumable uploads):
 *  - Per-chunk checksum (SHA-256 of the chunk body). The client computes
 *    the checksum + sends it as `?checksum=`; the server verifies before
 *    writing. A mismatched checksum is rejected (transit corruption).
 *  - Idempotent chunk writes. Re-uploading the same chunk index with the
 *    same checksum is a no-op (returns `{ duplicated: true }`). Re-uploading
 *    the same index with a DIFFERENT checksum throws (conflict — the client
 *    must restart the session).
 *  - Completion verification. `finishSession` checks that the sum of
 *    received chunk sizes equals `declaredSize` — a truncated final chunk
 *    or a missing middle chunk is caught before the pipeline runs.
 *  - Offset query. `getStatus` returns `{ receivedBytes, totalBytes,
 *    missingChunks, complete }` so a resuming client can skip the chunks
 *    already on disk.
 *  - Janitor hook. `expireOldSessions` deletes sessions older than 1 hour
 *    with no recent chunk activity (called by the /api/v1/cron/cleanup-uploads
 *    cron endpoint).
 */

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path_ from 'node:path';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;      // per file
export const MAX_ORDER_BYTES = 200 * 1024 * 1024;    // per order
export const CHUNK_SIZE = 2 * 1024 * 1024;           // client chunk size

/** Sessions older than this with no chunk activity are expired by the janitor. */
export const SESSION_EXPIRY_MS = 60 * 60 * 1000;     // 1 hour

type ChunkRecord = { checksum: string; size: number };

type UploadSession = {
  uploadId: string;
  fileId: string;
  orderId: string;
  orderToken: string;
  shopId: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunkSize: number;
  /** Per-chunk metadata, keyed by chunk index (0-based). */
  receivedChunks: Map<number, ChunkRecord>;
  /** Directory holding the per-chunk `.part` files. */
  chunkDir: string;
  createdAt: number;
  /** Updated on every successful chunk write — used by the janitor. */
  lastChunkAt: number;
  /** 'active' while uploads are accepted; 'expired' after the janitor runs;
   * 'completed' after `finishSession` succeeds. */
  status: 'active' | 'expired' | 'completed';
};

const sessions = new Map<string, UploadSession>();
const PART_DIR = path_.join('/tmp', 'pshop-uploads');

async function partDir(): Promise<string> {
  await mkdir(PART_DIR, { recursive: true });
  return PART_DIR;
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
  const dir = await partDir();
  const chunkDir = path_.join(dir, uploadId);
  await mkdir(chunkDir, { recursive: true });
  const session: UploadSession = {
    ...input,
    uploadId,
    chunkSize: input.chunkSize ?? CHUNK_SIZE,
    receivedChunks: new Map(),
    chunkDir,
    createdAt: Date.now(),
    lastChunkAt: Date.now(),
    status: 'active',
  };
  sessions.set(uploadId, session);
  // Opportunistic cleanup of stale sessions (>2 h) — the janitor cron is the
  // authoritative sweeper, but this keeps a long-running dev process from
  // accumulating sessions if the cron isn't wired.
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 2 * SESSION_EXPIRY_MS) {
      sessions.delete(id);
      await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return uploadId;
}

export function getSession(uploadId: string): UploadSession | null {
  return sessions.get(uploadId) ?? null;
}

/** The expected total chunk count for a session (ceil(declaredSize / chunkSize)). */
function expectedChunkCount(s: UploadSession): number {
  return Math.max(1, Math.ceil(s.declaredSize / s.chunkSize));
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
  const s = sessions.get(uploadId);
  if (!s) throw new Error('UPLOAD_NOT_FOUND');
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');
  if (bytes.length === 0) throw new Error('EMPTY_CHUNK');

  // Verify the checksum BEFORE writing — catches transit corruption without
  // touching the disk (a corrupted chunk doesn't pollute the chunk dir).
  const actual = sha256Hex(bytes);
  if (actual !== checksum) throw new Error('CHECKSUM_MISMATCH');

  // Idempotent re-upload: same index + same checksum → no-op.
  const existing = s.receivedChunks.get(chunkIndex);
  if (existing) {
    if (existing.checksum === checksum && existing.size === bytes.length) {
      return { receivedBytes: totalReceived(s), duplicated: true, chunkIndex };
    }
    // Same index, different content — the client must restart the session.
    throw new Error('CHUNK_CONFLICT');
  }

  // Per-chunk + per-file size guards.
  if (totalReceived(s) + bytes.length > MAX_FILE_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  // Write the chunk to its own file (idempotent: a re-write of the same
  // index would overwrite the same path with identical bytes).
  const chunkPath = path_.join(s.chunkDir, `${chunkIndex}.part`);
  await writeFile(chunkPath, bytes);
  s.receivedChunks.set(chunkIndex, { checksum, size: bytes.length });
  s.lastChunkAt = Date.now();

  return { receivedBytes: totalReceived(s), duplicated: false, chunkIndex };
}

/** Sum of received chunk sizes. */
function totalReceived(s: UploadSession): number {
  let n = 0;
  for (const c of s.receivedChunks.values()) n += c.size;
  return n;
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

/** Offset query for resumption: what's already on disk, what's missing. */
export function getStatus(uploadId: string): SessionStatus | null {
  const s = sessions.get(uploadId);
  if (!s) return null;
  const total = expectedChunkCount(s);
  const missing: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!s.receivedChunks.has(i)) missing.push(i);
  }
  return {
    uploadId,
    receivedBytes: totalReceived(s),
    totalBytes: s.declaredSize,
    missingChunks: missing,
    complete: missing.length === 0,
    status: s.status,
  };
}

/**
 * Assemble the uploaded original. Verifies the total bytes match the
 * declared size (catches a truncated final chunk or a missing middle chunk
 * before the pipeline runs). Cleans the chunk dir.
 */
export async function finishSession(uploadId: string): Promise<{ bytes: Uint8Array; session: UploadSession } | null> {
  const s = sessions.get(uploadId);
  if (!s) return null;
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');

  const received = totalReceived(s);
  // Completion verification — the declared size is the contract. A mismatch
  // means a chunk was lost or the client lied about the size; either way,
  // refuse to assemble.
  if (received !== s.declaredSize) {
    throw new Error(`SIZE_MISMATCH: declared=${s.declaredSize}, received=${received}`);
  }
  // Every expected chunk must be present (the janitor + status endpoint
  // also enforce this, but a race could leave a gap).
  const expected = expectedChunkCount(s);
  for (let i = 0; i < expected; i++) {
    if (!s.receivedChunks.has(i)) throw new Error(`MISSING_CHUNK: index=${i}`);
  }

  // Assemble in index order.
  const files = await readdir(s.chunkDir);
  const partFiles = files.filter((f) => f.endsWith('.part')).sort((a, b) => {
    const ai = Number.parseInt(a, 10);
    const bi = Number.parseInt(b, 10);
    return ai - bi;
  });
  const chunks: Buffer[] = [];
  for (const f of partFiles) {
    chunks.push(await readFile(path_.join(s.chunkDir, f)));
  }
  const bytes = new Uint8Array(Buffer.concat(chunks));

  // Verify the assembled bytes match the declared size (paranoid — the
  // per-chunk sizes already summed to this, but a corrupted filesystem
  // could still surprise us).
  if (bytes.length !== s.declaredSize) {
    throw new Error(`ASSEMBLED_SIZE_MISMATCH: declared=${s.declaredSize}, assembled=${bytes.length}`);
  }

  s.status = 'completed';
  sessions.delete(uploadId);
  await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
  return { bytes, session: s };
}

/** Cancel + clean up a session (customer cancelled mid-upload). */
export async function abandonSession(uploadId: string): Promise<void> {
  const s = sessions.get(uploadId);
  if (s) {
    sessions.delete(uploadId);
    await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Janitor hook: expire sessions older than the TTL with no recent chunk
 * activity. Called by /api/v1/cron/cleanup-uploads (hourly cron).
 *
 * @returns the number of sessions expired.
 */
export async function expireOldSessions(now: number = Date.now()): Promise<number> {
  let expired = 0;
  for (const [id, s] of sessions) {
    if (s.status !== 'active') continue;
    if (now - s.lastChunkAt > SESSION_EXPIRY_MS) {
      s.status = 'expired';
      sessions.delete(id);
      await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
      expired += 1;
    }
  }
  return expired;
}

/**
 * Dev/diagnostic: count active sessions (for a health endpoint). Not used
 * by the cron; useful for inspecting the registry during local testing.
 */
export function activeSessionCount(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.status === 'active') n += 1;
  return n;
}
