import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the AWS SDK S3 client (same pattern as r2.adapter.test.ts)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (this: unknown, _config: unknown) {
    return { send: vi.fn() };
  }),
  HeadObjectCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Key: string }) {
    return { input };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Key: string }) {
    return { input };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Key: string }) {
    return { input };
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Key: string }) {
    return { input };
  }),
  DeleteObjectsCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Delete: { Objects: { Key: string }[] } }) {
    return { input };
  }),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}));

import { S3StorageAdapter } from './s3.adapter';

/**
 * S3 adapter unit tests — mirrors the R2 adapter tests.
 *
 * Verifies:
 *   - Fail-closed constructor (missing config → throws)
 *   - head() returns metadata for existing objects
 *   - head() returns null for 404/NoSuchKey
 *   - head() THROWS for 403/5xx/network errors (not silently swallowed)
 *   - delete + deleteMany work correctly
 *   - Presigned URLs are generated via getSignedUrl
 */
describe('S3StorageAdapter', () => {
  let adapter: S3StorageAdapter;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new S3StorageAdapter({
      endpoint: 'https://test.storage.ap-southeast-1.aws.neon.tech',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'ap-southeast-1',
      bucket: 'test-bucket',
    });
    sendMock = (adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send;
  });

  it('constructor throws if endpoint is missing', () => {
    expect(() => new S3StorageAdapter({
      endpoint: '', accessKeyId: 'k', secretAccessKey: 's', region: 'r', bucket: 'b',
    })).toThrow('endpoint');
  });

  it('constructor throws if accessKeyId is missing', () => {
    expect(() => new S3StorageAdapter({
      endpoint: 'https://e.com', accessKeyId: '', secretAccessKey: 's', region: 'r', bucket: 'b',
    })).toThrow('accessKeyId');
  });

  it('constructor throws if bucket is missing', () => {
    expect(() => new S3StorageAdapter({
      endpoint: 'https://e.com', accessKeyId: 'k', secretAccessKey: 's', region: 'r', bucket: '',
    })).toThrow('bucket');
  });

  it('constructor throws if region is missing', () => {
    expect(() => new S3StorageAdapter({
      endpoint: 'https://e.com', accessKeyId: 'k', secretAccessKey: 's', region: '', bucket: 'b',
    })).toThrow('region');
  });

  it('head returns { size, contentType } when the object exists', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 963, ContentType: 'application/pdf' });
    const result = await adapter.head('shops/s1/orders/o1/f1');
    expect(result).toEqual({ size: 963, contentType: 'application/pdf' });
  });

  it('head returns null for 404 / NoSuchKey', async () => {
    const err = Object.assign(new Error('Not Found'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce(err);
    const result = await adapter.head('missing-key');
    expect(result).toBeNull();
  });

  it('head returns null for NotFound name (some providers use this)', async () => {
    const err = Object.assign(new Error('Not Found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce(err);
    const result = await adapter.head('missing-key');
    expect(result).toBeNull();
  });

  it('head THROWS for 403 AccessDenied', async () => {
    const err = Object.assign(new Error('Access Denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('forbidden-key')).rejects.toThrow('Access Denied');
  });

  it('head THROWS for 503 ServiceUnavailable', async () => {
    const err = Object.assign(new Error('Service Unavailable'), {
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503 },
    });
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('Service Unavailable');
  });

  it('head THROWS for network errors', async () => {
    const err = new Error('ECONNREFUSED');
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('ECONNREFUSED');
  });

  it('getPresignedUploadUrl calls getSignedUrl', async () => {
    const url = await adapter.getPresignedUploadUrl({
      key: 'shops/s1/orders/o1/f1',
      contentType: 'application/pdf',
      contentLength: 100,
      expiresInSeconds: 300,
    });
    expect(url).toBe('https://s3.example.com/signed-url');
  });

  it('getPresignedDownloadUrl calls getSignedUrl', async () => {
    const url = await adapter.getPresignedDownloadUrl('shops/s1/orders/o1/f1', 900);
    expect(url).toBe('https://s3.example.com/signed-url');
  });

  it('delete sends DeleteObjectCommand', async () => {
    sendMock.mockResolvedValueOnce({});
    await adapter.delete('shops/s1/orders/o1/f1');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('deleteMany is a no-op for empty array', async () => {
    await adapter.deleteMany([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('deleteMany chunks to 1000 per request', async () => {
    sendMock.mockResolvedValue({});
    const keys = Array.from({ length: 2500 }, (_, i) => `key-${i}`);
    await adapter.deleteMany(keys);
    // 2500 / 1000 = 3 calls (1000 + 1000 + 500)
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('provider name is "s3"', () => {
    expect(adapter.provider).toBe('s3');
  });
});
