import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';
import { createHmac } from 'node:crypto';

/** Sign a storage capability (HMAC-SHA256). */
function sign(key: string, method: string, exp: number): string {
  const secret = process.env.STORAGE_CAPABILITY_SECRET ?? 'dev-storage-capability-secret';
  return createHmac('sha256', secret).update(`${method}|${key}|${exp}`).digest('hex');
}

/** In-memory storage — stores blobs as a Map of key→{bytes, contentType}. */
export class InMemoryStorageAdapter implements StorageAdapter {
  readonly provider = 'memory';
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  /**
   * The "presigned" upload URL is a relative path to the in-process PUT
   * receiver with an HMAC signature + expiry — verified by /storage/put.
   * In production, R2/S3 generate their own signed presigned URLs.
   */
  async getPresignedUploadUrl(opts: PresignOptions): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 300);
    const sig = sign(opts.key, 'PUT', exp);
    const params = new URLSearchParams({
      key: opts.key, exp: String(exp), sig, ct: opts.contentType,
    });
    return `/api/v1/storage/put?${params.toString()}`;
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = sign(key, 'GET', exp);
    const params = new URLSearchParams({ key, exp: String(exp), sig });
    return `/api/v1/storage/get?${params.toString()}`;
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

