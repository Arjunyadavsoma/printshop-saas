import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

/** Sign a storage capability (HMAC-SHA256). Same scheme as the in-memory adapter. */
function sign(key: string, method: string, exp: number): string {
  const secret = process.env.STORAGE_CAPABILITY_SECRET ?? 'dev-storage-capability-secret';
  return createHmac('sha256', secret).update(`${method}|${key}|${exp}`).digest('hex');
}

/**
 * Local-disk storage — self-hosted single-box deployments (Docker image) and
 * CI. Blobs live under STORAGE_LOCAL_DIR; keys map to paths inside that root
 * (traversal-safe: a resolved key that escapes the root is rejected).
 *
 * Private by default like every other adapter: no public URLs, downloads go
 * through the HMAC-signed in-process endpoints using short-lived capability
 * URLs. Retention/cleanup jobs work unchanged (delete/deleteMany).
 */
export class LocalDiskStorageAdapter implements StorageAdapter {
  readonly provider = 'local';
  private readonly root: string;

  constructor(opts: { rootDir: string }) {
    this.root = opts.rootDir;
  }

  /** Resolve a storage key to an absolute path inside the root, safely. */
  private pathFor(key: string): string {
    const abs = normalize(join(this.root, key));
    if (abs !== this.root && !abs.startsWith(normalize(this.root + '/'))) {
      throw new Error('INVALID_STORAGE_KEY');
    }
    return abs;
  }

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
    try {
      await unlink(this.pathFor(key));
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') throw cause;
      // missing objects are fine (idempotent delete)
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) await this.delete(k);
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const s = await stat(this.pathFor(key));
      if (!s.isFile()) return null;
      // contentType is not persisted per object; the serving route validates
      // the extension against an allowlist before delivering bytes.
      return { size: s.size, contentType: 'application/octet-stream' };
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      throw cause;
    }
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const abs = this.pathFor(key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  async getBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const bytes = await readFile(this.pathFor(key));
      return { bytes: new Uint8Array(bytes), contentType: 'application/octet-stream' };
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      throw cause;
    }
  }
}
