import { z } from 'zod';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@platform/core/domain';

/** File-upload metadata the customer sends when requesting a presigned URL. */
export const FileUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
});
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;

/**
 * Validate an upload request against the mime allowlist and the size cap.
 * @returns `null` if valid, or a human-readable error string.
 */
export function validateUploadRequest(req: FileUploadRequest): string | null {
  if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(req.mimeType)) {
    return `Unsupported file type: ${req.mimeType}`;
  }
  if (req.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File too large: ${req.size} bytes (max ${MAX_UPLOAD_SIZE_BYTES})`;
  }
  return null;
}

/** Indian mobile numbers: optional +91, 10 digits starting 6-9. */
export const IndianPhoneSchema = z
  .string()
  .regex(/^(\+91)?[6-9]\d{9}$/, 'Invalid Indian mobile number');

/** UPI VPA: alphanumeric + dots/hyphens, @, domain. */
export const UpiIdSchema = z
  .string()
  .regex(/^[\w.\-]{2,}@[a-zA-Z][\w.\-]*$/, 'Invalid UPI VPA');

/** Shop slug: lowercase, digits, hyphens, 2-60 chars. */
export const ShopSlugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase, digits and hyphens only');

/** Customer order token: short uppercase alnum, 4-8 chars. */
export const OrderTokenSchema = z
  .string()
  .min(4)
  .max(8)
  .regex(/^[A-Z0-9]+$/, 'Token must be uppercase alphanumeric');
