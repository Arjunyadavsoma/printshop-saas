import { z } from 'zod';
import { FILE_STATUSES, type ColorMode, type FileStatus, type PaperSize } from './enums';

/**
 * A single file within an order. `storageKey` is the opaque object key in the
 * StorageAdapter — never a public URL. Download URLs are short-lived
 * presigned links minted on demand.
 */
export interface PrintFile {
  id: string;
  orderId: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  copies: number;
  colorMode: ColorMode;
  pageRange: string | null;
  paperSize: PaperSize;
  duplex: boolean;
  pricePaise: number;
  status: FileStatus;
  printedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PrintFileSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  originalFilename: z.string().min(1).max(255),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  pageCount: z.number().int().positive().nullable(),
  copies: z.number().int().positive(),
  colorMode: z.enum(['bw', 'color'] as [ColorMode, ...ColorMode[]]),
  pageRange: z.string().max(100).nullable(),
  paperSize: z.enum(['a4', 'a3', 'letter', 'legal'] as [PaperSize, ...PaperSize[]]),
  duplex: z.boolean(),
  pricePaise: z.number().int().nonnegative(),
  status: z.enum(FILE_STATUSES as [FileStatus, ...FileStatus[]]),
  printedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** MIME types a customer is permitted to upload. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const;

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
