/**
 * Object storage abstraction. Files are **private by default** — there is no
 * `getPublicUrl` for customer content. Downloads use short-lived presigned
 * URLs only.
 *
 * Concrete implementations:
 *  - `R2StorageAdapter`         (Cloudflare R2 — free 10GB, zero egress)
 *  - `S3StorageAdapter`         (AWS S3 — bucket policies, cross-region)
 *  - `MinioStorageAdapter`      (local dev / self-hosted)
 *  - `InMemoryStorageAdapter`   (tests)
 */

export interface PresignOptions {
  /** Object key, e.g. `shops/<shopId>/orders/<orderId>/<fileId>.pdf`. */
  key: string;
  /** MIME type the client will PUT; validated server-side too. */
  contentType: string;
  /** Max bytes the client may upload. */
  contentLength?: number;
  /** URL lifetime in seconds. */
  expiresInSeconds?: number;
}

export interface StorageAdapter {
  readonly provider: string;

  /**
   * Mint a short-lived presigned PUT URL the client uploads to **directly**.
   * The API server never proxies file bytes.
   */
  getPresignedUploadUrl(opts: PresignOptions): Promise<string>;

  /**
   * Mint a short-lived presigned GET URL. Used when the print agent or the
   * shopkeeper needs to fetch a file. Default expiry: 15 minutes.
   */
  getPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** Permanently remove an object. Idempotent — missing objects are fine. */
  delete(key: string): Promise<void>;

  /**
   * Permanently remove many objects in one call (used by the 24h privacy cron).
   * Implementations MUST accept an empty array as a no-op.
   */
  deleteMany(keys: string[]): Promise<void>;

  /** Fetch the `Content-Length` / `Content-Type` headers without a download. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;

  /**
   * Fetch the raw object bytes for document processing (page-count parsing).
   * Optional — adapters that don't support direct byte reads can omit this.
   * The confirm endpoint degrades gracefully: if `getBytes` is absent, the
   * file's page count is marked as `placeholder` and requires manual entry.
   */
  getBytes?(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
