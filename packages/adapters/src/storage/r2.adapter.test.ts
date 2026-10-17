import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the AWS SDK S3 client so we can simulate 404 / 403 / 5xx responses
// without a real R2 account. We only need to control what `client.send`
// throws / returns for the HeadObjectCommand.
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(function (this: unknown, _config: unknown) {
      return { send: vi.fn() };
    }),
    HeadObjectCommand: vi.fn().mockImplementation(function (this: unknown, input: { Bucket: string; Key: string }) {
      return { input };
    }),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    DeleteObjectsCommand: vi.fn(),
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed'),
}));

// Import AFTER the mocks are set up.
import { R2StorageAdapter } from './r2.adapter';

/**
 * R2 adapter head() regression test.
 *
 * Confirms that head():
 *   - returns null for a 404 / NoSuchKey (legitimate "not found")
 *   - THROWS for a 403 AccessDenied (permission failure — must NOT be swallowed)
 *   - THROWS for a 5xx ServiceUnavailable (provider error)
 *   - THROWS for a network error
 *
 * The previous implementation swallowed ALL errors and returned null, which
 * hid permission failures and provider outages from the caller. This made
 * the file-register route return "file not found" when R2 was actually
 * misconfigured or down.
 */
describe('R2StorageAdapter head() — distinguish missing vs permission vs provider errors', () => {
  let adapter: R2StorageAdapter;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new R2StorageAdapter({
      accountId: 'test-account',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    });
    // Access the private client.send mock
    sendMock = (adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send;
  });

  it('returns { size, contentType } when the object exists (200)', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 963, ContentType: 'application/pdf' });
    const result = await adapter.head('existing-key');
    expect(result).toEqual({ size: 963, contentType: 'application/pdf' });
  });

  it('returns null for a 404 NoSuchKey (legitimate "not found")', async () => {
    const err = Object.assign(new Error('Not Found'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce(err);
    const result = await adapter.head('missing-key');
    expect(result).toBeNull();
  });

  it('THROWS for a 403 AccessDenied (permission failure — must NOT be swallowed)', async () => {
    const err = Object.assign(new Error('Access Denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('forbidden-key')).rejects.toThrow('Access Denied');
  });

  it('THROWS for a 503 ServiceUnavailable (provider error)', async () => {
    const err = Object.assign(new Error('Service Unavailable'), {
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503 },
    });
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('Service Unavailable');
  });

  it('THROWS for a 500 InternalError (provider error)', async () => {
    const err = Object.assign(new Error('Internal Error'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 500 },
    });
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('Internal Error');
  });

  it('THROWS for a network error (no httpStatusCode)', async () => {
    const err = new Error('ECONNREFUSED');
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('ECONNREFUSED');
  });

  it('THROWS for a timeout error (no httpStatusCode)', async () => {
    const err = new Error('TimeoutError');
    sendMock.mockRejectedValueOnce(err);
    await expect(adapter.head('any-key')).rejects.toThrow('TimeoutError');
  });
});
