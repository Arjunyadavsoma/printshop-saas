/**
 * draft-storage — IndexedDB-backed persistence for the customer order draft.
 *
 * Why IndexedDB (not localStorage):
 *   - Survives a tab kill / crash / pocket-call where localStorage may not
 *     get the final synchronous write before unload.
 *   - Asynchronous, non-blocking writes (localStorage is synchronous on the
 *     main thread).
 *   - Per-shop keying — the customer can have an in-progress draft at shop A
 *     and another at shop B without one clobbering the other.
 *
 * The wrapper is intentionally thin — just open + put + get + delete on a
 * single object store (`drafts`) keyed by `shopSlug`. No external dependency
 * (idb-keyval, Dexie, …) — the native `indexedDB` API is enough here and
 * keeps the bundle lean.
 *
 * SSR-safe: every function returns a no-op / null when `window` is
 * undefined, so importing this module from a Server Component is safe.
 */

import type { PageMode } from '@/components/clear/tokens';

const DB_NAME = 'printshop-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

/** A single page-mode entry, serialized from `Map<number, PageMode>`. */
export interface DraftPageMode {
  page: number;
  mode: PageMode;
}

/** File metadata stored in the draft — enough to re-poll the API on restore. */
export interface DraftFile {
  fileId: string;
  filename: string;
  pageCount: number;
  /** The FlowFileStatus at save time — 'uploading' | 'converting' | 'ready' | 'failed'. */
  status: string;
  /** P8.7: upload session metadata for resumable uploads. Present while a
   * file is mid-upload (status === 'uploading'); cleared once complete. */
  uploadId?: string;
  /** The declared size of the file (bytes) — used to match a resume candidate
   * to a freshly-picked File on a future mount. */
  sizeBytes?: number;
  /** The chunk size used for the upload (bytes) — the server uses this to
   * compute the expected chunk count for the status endpoint. */
  chunkSize?: number;
}

/** Print options captured at save time (the active file's selections). */
export interface DraftOptions {
  /** Which preset was last chosen — 'notes' | 'colour' | 'photo' | 'mix'. */
  preset?: string;
  copies: number;
  paperSize: string;
  sides: string;
  pagesPerSheet: number;
}

/** Customer contact details captured at save time. */
export interface DraftCustomer {
  name?: string;
  phone?: string;
  note?: string;
}

/** The full draft payload — a complete snapshot of the in-progress order. */
export interface DraftData {
  /** The shop this draft belongs to — also the IndexedDB key. */
  shopSlug: string;
  /** The server-side order id + token (the credential for the upload API). */
  orderId?: string;
  orderToken?: string;
  /** File metadata — enough to re-poll the file-status API after restore. */
  files: DraftFile[];
  /** Per-file page modes: Record<fileId, Array<{ page, mode }>>. */
  pageModes: Record<string, DraftPageMode[]>;
  /** The active file's print options (preset + copies + paper + sides + pps). */
  options: DraftOptions;
  /** Customer contact details (name + phone + note). */
  customer: DraftCustomer;
  /** Epoch ms — when the draft was last saved. Used to expire stale drafts. */
  updatedAt: number;
}

/**
 * Open (or create) the printshop-drafts DB. Resolves with an IDBDatabase
 * ready for read/write. Rejects on any IndexedDB error or if IndexedDB is
 * unavailable (SSR / private mode in some browsers).
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'shopSlug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/**
 * Save (or overwrite) the draft for a shop. Puts the entire DraftData under
 * the `shopSlug` key. Fire-and-forget from the caller's perspective — any
 * IndexedDB error is swallowed (the draft is best-effort persistence).
 */
export async function saveDraft(shopSlug: string, draft: DraftData): Promise<void> {
  if (typeof window === 'undefined') return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...draft, shopSlug });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('saveDraft tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('saveDraft tx aborted'));
    });
  } catch {
    // IndexedDB may be unavailable (private mode, SSR, blocked by user) —
    // silently skip. The order still works without draft persistence.
  } finally {
    if (db) db.close();
  }
}

/**
 * Load the draft for a shop. Returns null when no draft exists, when
 * IndexedDB is unavailable, or when the stored payload is malformed.
 */
export async function loadDraft(shopSlug: string): Promise<DraftData | null> {
  if (typeof window === 'undefined') return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const result = await new Promise<unknown>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(shopSlug);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('loadDraft get failed'));
    });
    if (!result || typeof result !== 'object') return null;
    const draft = result as Partial<DraftData>;
    // Minimal shape check — don't trust arbitrary JSON.
    if (!Array.isArray(draft.files) || typeof draft.updatedAt !== 'number') {
      return null;
    }
    return draft as DraftData;
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}

/** Delete the draft for a shop (call after the order is placed). */
export async function clearDraft(shopSlug: string): Promise<void> {
  if (typeof window === 'undefined') return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(shopSlug);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('clearDraft tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('clearDraft tx aborted'));
    });
  } catch {
    // ignore
  } finally {
    if (db) db.close();
  }
}

/** Delete every draft in the store (call from a "clear my data" UI). */
export async function clearAllDrafts(): Promise<void> {
  if (typeof window === 'undefined') return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('clearAllDrafts tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('clearAllDrafts tx aborted'));
    });
  } catch {
    // ignore
  } finally {
    if (db) db.close();
  }
}
