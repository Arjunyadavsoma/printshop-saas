import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';

/**
 * Cloudflare R2 adapter (free 10GB, zero egress).
 *
 * PHASE-1 STATUS: skeleton — interface complete, runtime wiring (aws-sdk S3
 * client pointed at R2) lands in Phase 2. The point of Phase 1 is that the
 * interface is fixed; this concrete is a drop-in.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly provider = 'r2';
  constructor(
    private readonly config: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    },
  ) {}

  async getPresignedUploadUrl(_opts: PresignOptions): Promise<string> {
    throw new Error('R2StorageAdapter: not implemented until Phase 2');
  }
  async getPresignedDownloadUrl(): Promise<string> {
    throw new Error('R2StorageAdapter: not implemented until Phase 2');
  }
  async delete(): Promise<void> {
    throw new Error('R2StorageAdapter: not implemented until Phase 2');
  }
  async deleteMany(): Promise<void> {
    throw new Error('R2StorageAdapter: not implemented until Phase 2');
  }
  async head(): Promise<{ size: number; contentType: string } | null> {
    return null;
  }
}
