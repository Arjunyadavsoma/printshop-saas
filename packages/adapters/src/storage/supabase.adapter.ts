import type { StorageAdapter, PresignOptions } from '@platform/core/interfaces';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseStorageConfig {
  /** Supabase project URL, e.g. https://xyz.supabase.co */
  url: string;
  /** Supabase service role key (server-side only — NEVER expose to the client) */
  serviceRoleKey: string;
  /** Storage bucket name (must exist in the Supabase project) */
  bucket: string;
}

/**
 * Supabase Storage adapter — uses the official @supabase/supabase-js SDK.
 *
 * All operations use the service role key (server-side only). Presigned
 * upload/download URLs are generated so the API server never proxies file
 * bytes — the client uploads/downloads directly from Supabase Storage.
 *
 * Environment variables:
 *   STORAGE_PROVIDER=supabase
 *   SUPABASE_URL=https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *   SUPABASE_STORAGE_BUCKET=<bucket-name>
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly provider = 'supabase';
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(config: SupabaseStorageConfig) {
    if (!config.url) {
      throw new Error('SupabaseStorageAdapter: url (SUPABASE_URL) is required');
    }
    if (!config.serviceRoleKey) {
      throw new Error('SupabaseStorageAdapter: serviceRoleKey (SUPABASE_SERVICE_ROLE_KEY) is required');
    }
    if (!config.bucket) {
      throw new Error('SupabaseStorageAdapter: bucket (SUPABASE_STORAGE_BUCKET) is required');
    }
    this.bucket = config.bucket;
    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getPresignedUploadUrl(opts: PresignOptions): Promise<string> {
    // Supabase createSignedUploadUrl returns a signed URL + token.
    // The client PUTs the file directly to this URL.
    const { data, error } = await this.client
      .storage
      .from(this.bucket)
      .createSignedUploadUrl(opts.key);

    if (error || !data) {
      throw new Error(`Supabase upload URL failed: ${error?.message ?? 'unknown'}`);
    }

    // The signed URL is in data.signedUrl — return it for the client to PUT to.
    // We also need to return the token for the client to include in the upload.
    // Supabase's createSignedUploadUrl returns { path, token, signedUrl }.
    // The client uploads via PUT to the signedUrl.
    return data.signedUrl ?? data.url ?? '';
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const { data, error } = await this.client
      .storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Supabase download URL failed: ${error?.message ?? 'unknown'}`);
    }
    return data.signedUrl;
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client
      .storage
      .from(this.bucket)
      .remove([key]);
    if (error) {
      throw new Error(`Supabase delete failed: ${error.message}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // Supabase remove() accepts an array of keys (max 1000 per call)
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const { error } = await this.client
        .storage
        .from(this.bucket)
        .remove(chunk);
      if (error) {
        throw new Error(`Supabase deleteMany failed: ${error.message}`);
      }
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      // Use list() with a filter to check if the object exists
      const folder = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
      const filename = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;

      const { data, error } = await this.client
        .storage
        .from(this.bucket)
        .list(folder, {
          limit: 1000,
          search: filename,
        });

      if (error) {
        throw new Error(`Supabase head failed: ${error.message}`);
      }

      // Find the exact match (search does substring matching, we need exact)
      const match = data?.find((item) => item.name === filename);
      if (!match) {
        return null;
      }

      return {
        size: match.metadata?.size ?? match.metadata?.contentLength ?? 0,
        contentType: match.metadata?.mimetype ?? 'application/octet-stream',
      };
    } catch (e) {
      // If it's a "not found" type error, return null
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|does not exist|404/i.test(msg)) {
        return null;
      }
      throw e;
    }
  }
}
