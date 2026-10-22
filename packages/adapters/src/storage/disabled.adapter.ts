import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';

/**
 * Disabled storage adapter — used when STORAGE_PROVIDER=disabled.
 *
 * The app starts normally (no crash), but ALL storage operations throw with
 * a clear "storage not configured" message. This allows the app to run on
 * Vercel with all features EXCEPT file uploads — customers can discover
 * shops, create orders, configure print settings, checkout, and pay, but
 * uploading documents returns a clear 503 "Storage not configured" error.
 *
 * This is intentionally different from 'memory' storage (which silently
 * accepts uploads and loses them on restart). The disabled adapter makes
 * the limitation explicit and safe.
 */
export class DisabledStorageAdapter implements StorageAdapter {
  readonly provider = 'disabled';

  private fail(): never {
    throw new Error(
      'Storage is not configured. Set STORAGE_PROVIDER=s3 (with AWS_* env vars) ' +
      'or STORAGE_PROVIDER=r2 (with R2_* env vars) to enable file uploads. ' +
      'File upload/download is disabled until persistent storage is configured.'
    );
  }

  async getPresignedUploadUrl(_opts: PresignOptions): Promise<string> {
    this.fail();
  }

  async getPresignedDownloadUrl(_key: string, _expiresInSeconds?: number): Promise<string> {
    this.fail();
  }

  async delete(_key: string): Promise<void> {
    this.fail();
  }

  async deleteMany(_keys: string[]): Promise<void> {
    this.fail();
  }

  async head(_key: string): Promise<{ size: number; contentType: string } | null> {
    this.fail();
  }
}
