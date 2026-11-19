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
  /** The Supabase project URL — used to build the direct Storage REST path
   *  for the head() method (the SDK doesn't expose a single-object HEAD). */
  private readonly supabaseUrl: string;
  /** The service role key — used to authorise the direct REST HEAD in
   *  head(). NEVER logged or returned in error messages. */
  private readonly serviceRoleKey: string;

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
    this.supabaseUrl = config.url.replace(/\/+$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
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
    return data.signedUrl;
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
    // H12 fix: previously this used `.list(folder, { limit: 1000, search })`
    // and then filtered in memory. Two problems with that:
    //   1. `search` does a SUBSTRING match (Supabase Storage list API),
    //      not an exact-match — querying for `invoice.pdf` returns every
    //      object in the folder whose name CONTAINS `invoice.pdf`
    //      (e.g. `invoice.pdf`, `invoice.pdf.bak`, `old-invoice.pdf`).
    //      The filter `item.name === filename` afterwards caught false
    //      positives, but the WORK was still O(folder size) with a 1000-
    //      entry cap (a folder with >1000 entries would miss the file
    //      entirely even if it existed).
    //   2. The list call returns object metadata for every match — a
    //      payload proportional to the folder size, not the single object
    //      we care about. For a shop with thousands of uploaded files,
    //      every `head()` call (one per upload confirm, one per download)
    //      was a full-folder scan.
    //
    // The fix: hit the Supabase Storage REST API directly with a request
    // to the object's exact path. We read `Content-Length` + `Content-Type`
    // from the response headers — no list, no scan, O(1) work on the
    // storage side. The service role key authorises the request
    // server-side (the public anon key would also work for a private
    // bucket if the object had a public-read grant, but the service role
    // key is what we already hold and works for every object in every
    // bucket).
    //
    // 2026-11-19 correction: Supabase Storage does NOT return HTTP 404
    // for a missing object. It returns HTTP 400 with a JSON body
    // {"statusCode":"404","code":"NoSuchKey","message":"Object not found"}
    // (verified live against project duyharicyurufmsjyhgs, bucket
    // printshop-uploads, with a valid secret key). The old code checked
    // `res.status === 404`, so EVERY probe of a nonexistent key threw
    // "Supabase head failed: HTTP 400" — which is why /api/v1/ready
    // reported storage unhealthy permanently even with a valid key and
    // an existing bucket. A missing BUCKET answers the same HTTP 400
    // but with code "NoSuchBucket", so the two cases are told apart by
    // the body, not the status. A HEAD response carries no body, so
    // head() now issues a GET with `Range: bytes=0-0` (1 byte
    // transferred) and reads the error body on 400: NoSuchKey means
    // "not found" (return null); anything else throws.
    try {
      // Supabase Storage REST API path for a single object:
      //   ${SUPABASE_URL}/storage/v1/object/${bucket}/${key}
      // Each path segment is percent-encoded individually so `/`
      // separators survive (a single encodeURIComponent over the whole
      // key would encode `/` to `%2F`, which Supabase interprets as a
      // literal slash inside a filename).
      const encodedKey = key
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      const url = `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encodedKey}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          Range: 'bytes=0-0',
        },
      });
      if (res.status === 200 || res.status === 206) {
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        let size: number;
        if (res.status === 206) {
          // Content-Range: bytes 0-0/<total>
          const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
          size = m ? Number(m[1]) : Number(res.headers.get('content-length') ?? '0');
          // Drain the 1-byte body so the connection can be reused.
          await res.arrayBuffer().catch(() => undefined);
        } else {
          size = Number(res.headers.get('content-length') ?? '0');
        }
        return {
          size: Number.isFinite(size) ? size : 0,
          contentType,
        };
      }
      if (res.status === 416) {
        // Range not satisfiable — only happens for an existing 0-byte object.
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        return { size: 0, contentType };
      }
      if (res.status === 400) {
        // Missing object (NoSuchKey) vs missing bucket (NoSuchBucket) vs
        // anything else — the HTTP status is 400 for all of them.
        let code = '';
        try {
          const body = (await res.json()) as { code?: unknown };
          code = typeof body?.code === 'string' ? body.code : '';
        } catch { /* non-JSON 400 — fall through to throw below */ }
        if (code === 'NoSuchKey') return null;
        throw new Error(`Supabase head failed: HTTP 400 (${code || 'unknown error'})`);
      }
      if (res.status === 404) return null;
      // Any other non-OK status (403, 500, …) — rethrow so the caller
      // sees the storage error (matches the previous behaviour on
      // non-404 errors from the SDK).
      throw new Error(`Supabase head failed: HTTP ${res.status}`);
    } catch (e) {
      // If it's a "not found" type error, return null
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|does not exist|404|NoSuchKey/i.test(msg)) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Server-side direct upload (extension beyond the StorageAdapter interface).
   *
   * Used by routes that receive a file in the API process and store it without
   * proxying through a client-presigned PUT (e.g. the shopkeeper's UPI QR
   * image upload). The customer-facing upload path stays on the presigned-PUT
   * flow (`getPresignedUploadUrl`) so the API server never proxies large
   * customer file bytes.
   */
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    // upsert:true so re-uploading the same key (e.g. the shop refreshes their
    // UPI QR) replaces the old object instead of erroring.
    const { error } = await this.client
      .storage
      .from(this.bucket)
      .upload(key, bytes as unknown as Blob, {
        contentType,
        upsert: true,
      });
    if (error) {
      throw new Error(`Supabase put failed: ${error.message}`);
    }
  }

  /** Server-side direct fetch (extension beyond the StorageAdapter interface). */
  async getBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) {
      const msg = error?.message ?? '';
      if (/not found|does not exist|404/i.test(msg)) return null;
      throw new Error(`Supabase getBytes failed: ${msg || 'unknown'}`);
    }
    const arrayBuf = await (data as unknown as Blob).arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    const contentType = (data as unknown as { type?: string }).type ?? 'application/octet-stream';
    return { bytes, contentType };
  }
}
