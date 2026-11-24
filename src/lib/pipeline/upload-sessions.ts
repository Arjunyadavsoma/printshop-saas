/**
 * Chunked-upload session registry (Phase 2, enhanced P8.7).
 *
 * PRIMARY (production fix, 2026-11): sessions + chunks live in the Postgres
 * `UploadSession` / `UploadChunk` tables via the container's database
 * adapter, so every serverless instance shares the same state. The previous
 * implementation kept a module-level Map + /tmp chunk files: correct for a
 * single process, but on Vercel each lambda instance has its own Map —
 * `init` could land on instance A while `chunk`/`complete` hit instance B,
 * which answered "Upload session not found" and the customer saw "Failed to
 * process — tap to retry" even though the bytes had arrived.
 *
 * FALLBACK: if the DB tables are not there yet (the very first deploys of
 * this change, before `prisma db push` reaches the production database),
 * every call transparently falls back to the original in-process behaviour
 * instead of failing the upload outright. Same function signatures, same
 * error strings — only the durability differs, and it upgrades
 * automatically once the schema sync succeeds.
 *
 * The route contract is unchanged (init → chunk → complete → poll files):
 *   - Per-chunk checksum (SHA-256 of the chunk body); mismatches rejected.
 *   - Idempotent chunk writes (same index + same checksum → no-op;
 *     different checksum → CHUNK_CONFLICT).
 *   - Completion verification (sum of chunk sizes must equal declaredSize).
 *   - Offset query (`getStatus`) for resumable uploads.
 *   - Janitor hook (`expireOldSessions`) driven by the cleanup cron.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path_ from 'node:path';
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

/**
 * True when the error is "the UploadSession/UploadChunk tables don't exist
 * yet" (Prisma P2021/P2022 or the raw Postgres 42P01 undefined_table). In
 * that state the registry falls back to the legacy in-process store so
 * uploads keep working until the schema sync lands.
 */
function isMissingTableError(cause: unknown): boolean {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return /P2021|P2022|undefined_table|relation .* does not exist|table .* does not exist|Object does not exist/i.test(msg);
}

/**
 * Cached "the DB session store is unavailable in this environment" flag.
 * Set the first time a query fails with a missing-table error; schema
 * changes can't appear in a running lambda, so caching per instance is
 * safe and keeps the hot path free of repeated failing queries.
 */
let dbStoreMissing = false;

function fallbackToLegacy(cause: unknown): boolean {
  if (dbStoreMissing) return true;
  if (isMissingTableError(cause)) {
    dbStoreMissing = true;
    return true;
  }
  return false;
}

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

// ══════════════════════════════════════════════════════════════════════════
// Legacy in-process fallback (pre-DB-backed behaviour, kept verbatim in
// semantics): module-level Map + per-session .part files under /tmp.
// Used ONLY while the UploadSession tables are missing in the environment.
// ══════════════════════════════════════════════════════════════════════════

type LegacySession = UploadSession & {
  receivedChunks: Map<number, { checksum: string; size: number }>;
  chunkDir: string;
};

const legacySessions = new Map<string, LegacySession>();
const LEGACY_PART_DIR = path_.join('/tmp', 'pshop-uploads');

async function legacyPartDir(): Promise<string> {
  await mkdir(LEGACY_PART_DIR, { recursive: true });
  return LEGACY_PART_DIR;
}

/** The expected total chunk count (ceil(declaredSize / chunkSize)). */
function expectedChunkCount(s: UploadSession): number {
  return Math.max(1, Math.ceil(s.declaredSize / s.chunkSize));
}

async function legacyCreateSession(input: CreateSessionInput): Promise<string> {
  const uploadId = crypto.randomUUID();
  const dir = await legacyPartDir();
  const chunkDir = path_.join(dir, uploadId);
  await mkdir(chunkDir, { recursive: true });
  const session: LegacySession = {
    ...input,
    uploadId,
    chunkSize: input.chunkSize ?? CHUNK_SIZE,
    receivedChunks: new Map(),
    chunkDir,
    createdAt: Date.now(),
    lastChunkAt: Date.now(),
    status: 'active',
  };
  legacySessions.set(uploadId, session);
  // Opportunistic cleanup of stale sessions (>2 h) — the janitor cron is the
  // authoritative sweeper, but this keeps a long-running dev process from
  // accumulating sessions if the cron isn't wired.
  const now = Date.now();
  for (const [id, s] of legacySessions) {
    if (now - s.createdAt > 2 * SESSION_EXPIRY_MS) {
      legacySessions.delete(id);
      await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return uploadId;
}

function legacyGetSessionSync(uploadId: string): LegacySession | null {
  return legacySessions.get(uploadId) ?? null;
}

function legacyTotalReceived(s: LegacySession): number {
  let n = 0;
  for (const c of s.receivedChunks.values()) n += c.size;
  return n;
}

async function legacyAppendChunk(uploadId: string, chunkIndex: number, bytes: Uint8Array, checksum: string): Promise<{ receivedBytes: number; duplicated: boolean; chunkIndex: number }> {
  const s = legacyGetSessionSync(uploadId);
  if (!s) throw new Error('UPLOAD_NOT_FOUND');
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');
  if (bytes.length === 0) throw new Error('EMPTY_CHUNK');
  const actual = sha256Hex(bytes);
  if (actual !== checksum) throw new Error('CHECKSUM_MISMATCH');
  const existing = s.receivedChunks.get(chunkIndex);
  if (existing) {
    if (existing.checksum === checksum && existing.size === bytes.length) {
      return { receivedBytes: legacyTotalReceived(s), duplicated: true, chunkIndex };
    }
    throw new Error('CHUNK_CONFLICT');
  }
  if (legacyTotalReceived(s) + bytes.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  await writeFile(path_.join(s.chunkDir, `${chunkIndex}.part`), bytes);
  s.receivedChunks.set(chunkIndex, { checksum, size: bytes.length });
  s.lastChunkAt = Date.now();
  return { receivedBytes: legacyTotalReceived(s), duplicated: false, chunkIndex };
}

function legacyGetStatus(uploadId: string) {
  const s = legacyGetSessionSync(uploadId);
  if (!s) return null;
  const total = expectedChunkCount(s);
  const missing: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!s.receivedChunks.has(i)) missing.push(i);
  }
  return {
    uploadId,
    receivedBytes: legacyTotalReceived(s),
    totalBytes: s.declaredSize,
    missingChunks: missing,
    complete: missing.length === 0,
    status: s.status,
  };
}

async function legacyFinishSession(uploadId: string): Promise<{ bytes: Uint8Array; session: UploadSession } | null> {
  const s = legacyGetSessionSync(uploadId);
  if (!s) return null;
  if (s.status !== 'active') throw new Error('UPLOAD_EXPIRED');
  const received = legacyTotalReceived(s);
  if (received !== s.declaredSize) {
    throw new Error(`SIZE_MISMATCH: declared=${s.declaredSize}, received=${received}`);
  }
  const expected = expectedChunkCount(s);
  for (let i = 0; i < expected; i++) {
    if (!s.receivedChunks.has(i)) throw new Error(`MISSING_CHUNK: index=${i}`);
  }
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
  if (bytes.length !== s.declaredSize) {
    throw new Error(`ASSEMBLED_SIZE_MISMATCH: declared=${s.declaredSize}, assembled=${bytes.length}`);
  }
  s.status = 'completed';
  legacySessions.delete(uploadId);
  await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
  return { bytes, session: s };
}

async function legacyAbandonSession(uploadId: string): Promise<void> {
  const s = legacySessions.get(uploadId);
  if (s) {
    legacySessions.delete(uploadId);
    await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function legacyExpireOldSessions(now: number): Promise<number> {
  let expired = 0;
  for (const [id, s] of legacySessions) {
    if (s.status !== 'active') continue;
    if (now - s.lastChunkAt > SESSION_EXPIRY_MS) {
      s.status = 'expired';
      legacySessions.delete(id);
      await rm(s.chunkDir, { recursive: true, force: true }).catch(() => {});
      expired += 1;
    }
  }
  return expired;
}

// ══════════════════════════════════════════════════════════════════════════
// Public API — DB-backed primary, legacy fallback on missing tables.
// ══════════════════════════════════════════════════════════════════════════

export async function createSession(input: CreateSessionInput): Promise<string> {
  if (dbStoreMissing) return legacyCreateSession(input);
  try {
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
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacyCreateSession(input);
    throw cause;
  }
}

export async function getSession(uploadId: string): Promise<UploadSession | null> {
  if (!uploadId) return null;
  if (dbStoreMissing) return legacyGetSessionSync(uploadId);
  try {
    const row = await db().findOne<SessionRow>('uploadSession', { uploadId });
    return row ? rowToSession(row) : null;
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacyGetSessionSync(uploadId);
    throw cause;
  }
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
  if (dbStoreMissing) return legacyAppendChunk(uploadId, chunkIndex, bytes, checksum);
  try {
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
  } catch (cause) {
    // Only a missing-table error may fall back to the legacy store — domain
    // errors (CHECKSUM_MISMATCH, CHUNK_CONFLICT, …) are real and rethrown.
    if (fallbackToLegacy(cause)) return legacyAppendChunk(uploadId, chunkIndex, bytes, checksum);
    throw cause;
  }
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
  if (dbStoreMissing) return legacyGetStatus(uploadId);
  try {
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
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacyGetStatus(uploadId);
    throw cause;
  }
}

/**
 * Assemble the uploaded original. Verifies the total bytes match the
 * declared size (catches a truncated final chunk or a missing middle chunk
 * before the pipeline runs). Deletes the chunk rows + session row on
 * success (the file bytes now live in the StorageProvider).
 */
export async function finishSession(uploadId: string): Promise<{ bytes: Uint8Array; session: UploadSession } | null> {
  if (dbStoreMissing) return legacyFinishSession(uploadId);
  try {
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
  } catch (cause) {
    // Domain errors (size/chunk verification) mean the session row EXISTS —
    // rethrow them so the route maps them to UPLOAD_INCOMPLETE etc. Only a
    // missing-table error falls back to the legacy store.
    if (cause instanceof Error && (cause.message.startsWith('SIZE_MISMATCH') || cause.message.startsWith('MISSING_CHUNK') || cause.message.startsWith('ASSEMBLED_SIZE_MISMATCH') || cause.message === 'UPLOAD_EXPIRED')) {
      throw cause;
    }
    if (fallbackToLegacy(cause)) return legacyFinishSession(uploadId);
    throw cause;
  }
}

/** Cancel + clean up a session (customer cancelled mid-upload). */
export async function abandonSession(uploadId: string): Promise<void> {
  if (!uploadId) return;
  if (dbStoreMissing) return legacyAbandonSession(uploadId);
  try {
    await db().delete('uploadChunk', { uploadId });
    await db().delete('uploadSession', { uploadId });
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacyAbandonSession(uploadId);
    throw cause;
  }
}

/**
 * Janitor hook: expire sessions older than the TTL with no recent chunk
 * activity. Called by /api/v1/cron/cleanup-uploads (hourly cron).
 *
 * @returns the number of sessions expired.
 */
export async function expireOldSessions(now: number = Date.now()): Promise<number> {
  if (dbStoreMissing) return legacyExpireOldSessions(now);
  try {
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
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacyExpireOldSessions(now);
    throw cause;
  }
}

/**
 * Dev/diagnostic: count active sessions (for a health endpoint). Not used
 * by the cron; useful for inspecting the registry during local testing.
 */
export async function activeSessionCount(): Promise<number> {
  try {
    return await db().count('uploadSession', { status: 'active' });
  } catch (cause) {
    if (fallbackToLegacy(cause)) return legacySessions.size;
    throw cause;
  }
}
