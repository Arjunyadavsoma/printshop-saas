import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';

/** In-memory storage — stores blobs as a Map of key→Uint8Array. */
export class InMemoryStorageAdapter implements StorageAdapter {
  readonly provider = 'memory';
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async getPresignedUploadUrl(opts: PresignOptions): Promise<string> {
    // A "presigned" URL is just a marker the test client PUTs to.
    return `mem://upload/${opts.key}?expires=${opts.expiresInSeconds ?? 300}`;
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return `mem://download/${key}?expires=${expiresInSeconds}`;
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

  /** Test-only helper: pretend a client uploaded bytes for `key`. */
  putForTest(key: string, bytes: Uint8Array, contentType = 'application/octet-stream'): void {
    this.objects.set(key, { bytes, contentType });
  }
}
