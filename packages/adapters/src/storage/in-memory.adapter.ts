import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';

/** In-memory storage — stores blobs as a Map of key→{bytes, contentType}. */
export class InMemoryStorageAdapter implements StorageAdapter {
  readonly provider = 'memory';
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  /**
   * The "presigned" upload URL points at the in-process PUT receiver
   * (`/api/v1/storage/put`), so the full upload→confirm→parse flow works
   * end-to-end without a cloud bucket. In production this URL would point
   * directly at R2/S3 — the API server never proxies file bytes.
   */
  async getPresignedUploadUrl(opts: PresignOptions): Promise<string> {
    const exp = opts.expiresInSeconds ?? 300;
    return `/api/v1/storage/put?key=${encodeURIComponent(opts.key)}&ct=${encodeURIComponent(opts.contentType)}&exp=${exp}`;
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return `/api/v1/storage/get?key=${encodeURIComponent(key)}&exp=${expiresInSeconds}`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k);
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const o = this.objects.get(key);
    return o ? { size: o.bytes.length, contentType: o.contentType } : null;
  }

  /** Extension beyond the StorageAdapter interface: store uploaded bytes. */
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
  }

  /** Extension beyond the StorageAdapter interface: fetch the raw bytes. */
  async getBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  }
}

