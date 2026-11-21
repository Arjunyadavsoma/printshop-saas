/**
 * Chunked-upload session registry (Phase 2).
 *
 * Server-local (dev / single-process). Each session appends chunks to a
 * part-file under the OS temp dir; `complete` assembles + validates the
 * original bytes, stores them via the StorageProvider and hands off to the
 * pipeline. Production upgrade path: S3/R2 multipart upload with the same
 * route contract (see docs/ARCHITECTURE.md §3.2).
 */
import { mkdir, appendFile, stat, readFile, rm } from 'node:fs/promises';
import path_ from 'node:path';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;      // per file
export const MAX_ORDER_BYTES = 200 * 1024 * 1024;    // per order
export const CHUNK_SIZE = 2 * 1024 * 1024;           // client chunk size

type UploadSession = {
  uploadId: string;
  fileId: string;
  orderId: string;
  orderToken: string;
  shopId: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  receivedBytes: number;
  partPath: string;
  createdAt: number;
};

const sessions = new Map<string, UploadSession>();
const PART_DIR = path_.join('/tmp', 'pshop-uploads');

async function partDir(): Promise<string> {
  await mkdir(PART_DIR, { recursive: true });
  return PART_DIR;
}

export async function createSession(input: Omit<UploadSession, 'uploadId' | 'receivedBytes' | 'partPath' | 'createdAt'>): Promise<string> {
  const uploadId = crypto.randomUUID();
  const dir = await partDir();
  const session: UploadSession = {
    ...input,
    uploadId,
    receivedBytes: 0,
    partPath: path_.join(dir, `${uploadId}.part`),
    createdAt: Date.now(),
  };
  sessions.set(uploadId, session);
  // opportunistic cleanup of stale sessions (>2 h)
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 2 * 3600_000) {
      sessions.delete(id);
      await rm(s.partPath, { force: true }).catch(() => {});
    }
  }
  return uploadId;
}

export function getSession(uploadId: string): UploadSession | null {
  return sessions.get(uploadId) ?? null;
}

export async function appendChunk(uploadId: string, bytes: Uint8Array): Promise<number> {
  const s = sessions.get(uploadId);
  if (!s) throw new Error('UPLOAD_NOT_FOUND');
  if (s.receivedBytes + bytes.length > MAX_FILE_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }
  await appendFile(s.partPath, bytes);
  s.receivedBytes += bytes.length;
  return s.receivedBytes;
}

/** Assemble the uploaded original. Returns the bytes and cleans the part. */
export async function finishSession(uploadId: string): Promise<{ bytes: Uint8Array; session: UploadSession } | null> {
  const s = sessions.get(uploadId);
  if (!s) return null;
  const st = await stat(s.partPath).catch(() => null);
  if (!st) throw new Error('NO_CHUNKS_RECEIVED');
  const bytes = new Uint8Array(await readFile(s.partPath));
  sessions.delete(uploadId);
  await rm(s.partPath, { force: true }).catch(() => {});
  return { bytes, session: s };
}

export function abandonSession(uploadId: string): void {
  const s = sessions.get(uploadId);
  if (s) {
    sessions.delete(uploadId);
    rm(s.partPath, { force: true }).catch(() => {});
  }
}
