import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';
import { S3Client, HeadObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional: override the endpoint (for MinIO testing). */
  endpoint?: string;
  /** Optional: region (default: auto). */
  region?: string;
}

/**
 * Cloudflare R2 storage adapter (free 10GB, zero egress).
 *
 * Uses @aws-sdk/client-s3 pointed at R2's S3-compatible API. Generates
 * short-lived presigned PUT/GET URLs (the API server never proxies bytes).
 * Supports head (metadata), delete, and deleteMany (batch cleanup).
 *
 * In production: STORAGE_PROVIDER=r2 + R2_ACCOUNT_ID + R2_ACCESS_KEY_ID +
 * R2_SECRET_ACCESS_KEY + R2_BUCKET.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly provider = 'r2';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config) {
    // Fail-closed: refuse to construct without required config.
    if (!config.accountId && !config.endpoint) {
      throw new Error('R2StorageAdapter: accountId or endpoint is required');
    }
    if (!config.accessKeyId || !config.secretAccessKey || !config.bucket) {
      throw new Error('R2StorageAdapter: accessKeyId, secretAccessKey, and bucket are required');
    }
    this.bucket = config.bucket;
    const endpoint = config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.client = new S3Client({
      region: config.region ?? 'auto',
      endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async getPresignedUploadUrl(opts: PresignOptions): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: opts.key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: opts.expiresInSeconds ?? 300,
    });
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // S3 max 1000 per request; chunk if needed.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: k })) },
        }),
      );
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (e: unknown) {
      // Distinguish "object missing" (legitimate → null) from "permission /
      // provider error" (must NOT be silently swallowed — those indicate a
      // real problem the caller should know about).
      //
      // AWS S3 / R2 error shape: { name: string, $metadata: { httpStatusCode: number } }
      //   NoSuchKey       (404) → object doesn't exist → return null
      //   AccessDenied    (403) → permission failure → THROW (don't hide auth bugs)
      //   ServiceUnavailable (503) / timeouts → THROW (caller should retry / alert)
      //   NetworkError           → THROW
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = err?.$metadata?.httpStatusCode;
      const name = err?.name ?? '';
      // 404 / NoSuchKey = legitimate "not found" — return null.
      if (name === 'NoSuchKey' || status === 404) {
        return null;
      }
      // Everything else (403, 5xx, network) is a real error — re-throw so the
      // caller (e.g., the file-register route) returns a 5xx instead of a
      // misleading "file not found".
      throw e;
    }
  }
}
