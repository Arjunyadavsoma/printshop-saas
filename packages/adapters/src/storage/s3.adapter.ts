import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';
import { S3Client, HeadObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  /** The S3-compatible endpoint URL (e.g. Neon Object Storage, MinIO). */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  /**
   * Use path-style addressing (https://endpoint/bucket/key).
   * Required for most S3-compatible providers (Neon Object Storage, MinIO).
   * Default: true (S3-compatible providers typically need this).
   */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible object storage adapter.
 *
 * Works with any S3-compatible provider: Neon Object Storage, AWS S3, MinIO,
 * Cloudflare R2, etc. Uses `@aws-sdk/client-s3` with `forcePathStyle: true`
 * by default (required for S3-compatible providers that don't support
 * virtual-hosted-style addressing).
 *
 * Generates short-lived presigned PUT/GET URLs — the API server never proxies
 * file bytes. The `head()` method distinguishes 404 (missing → null) from
 * 403/5xx (real errors → throw), so permission failures are never silently
 * swallowed.
 *
 * Environment variables (when constructed via the container):
 *   STORAGE_PROVIDER=s3
 *   AWS_ENDPOINT_URL_S3=https://<branch>.storage.<region>.aws.neon.tech
 *   AWS_ACCESS_KEY_ID=<key>
 *   AWS_SECRET_ACCESS_KEY=<secret>
 *   AWS_REGION=ap-southeast-1
 *   AWS_S3_BUCKET=<bucket-name>
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly provider = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    // Fail-closed: refuse to construct without required config.
    if (!config.endpoint) {
      throw new Error('S3StorageAdapter: endpoint (AWS_ENDPOINT_URL_S3) is required');
    }
    if (!config.accessKeyId) {
      throw new Error('S3StorageAdapter: accessKeyId (AWS_ACCESS_KEY_ID) is required');
    }
    if (!config.secretAccessKey) {
      throw new Error('S3StorageAdapter: secretAccessKey (AWS_SECRET_ACCESS_KEY) is required');
    }
    if (!config.region) {
      throw new Error('S3StorageAdapter: region (AWS_REGION) is required');
    }
    if (!config.bucket) {
      throw new Error('S3StorageAdapter: bucket (AWS_S3_BUCKET) is required');
    }

    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
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
      // Same head() error-distinguishing logic as R2StorageAdapter:
      //   404 / NoSuchKey → object doesn't exist → return null
      //   403 / 5xx / network → real error → THROW
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = err?.$metadata?.httpStatusCode;
      const name = err?.name ?? '';
      if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) {
        return null;
      }
      throw e;
    }
  }
}
