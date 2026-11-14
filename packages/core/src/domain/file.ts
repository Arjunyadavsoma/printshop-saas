import { z } from 'zod';
import {
  FILE_STATUSES,
  PAGE_COUNT_SOURCES,
  type ColorMode,
  type FileStatus,
  type PageCountSource,
  type PaperSize,
} from './enums';

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
  /** Origin of the page count — determines whether the file can be priced.
   *
   *  - `auto_extracted`       — the parser confidently extracted the count
   *                             (PDF, DOCX, PPTX, XLSX, images). Billable.
   *  - `customer_declared`    — the customer entered the count manually.
   *                             Billable, but the shopkeeper can correct it.
   *  - `shopkeeper_confirmed` — the shopkeeper verified or set the count.
   *                             Highest trust. Billable.
   *  - `placeholder`          — no trustworthy count available. The file is
   *                             in `needs_review` status and CANNOT be priced
   *                             or checked out until a count is supplied.
   */
  pageCountSource: PageCountSource;
  copies: number;
  colorMode: ColorMode;
  pageRange: string | null;
  paperSize: PaperSize;
  duplex: boolean;
  pricePaise: number;
  status: FileStatus;
  /** Processing/extraction error message — null when healthy. Set when
   * page-count extraction fails so the UI can explain why the file needs
   * review (e.g. "corrupted PDF", "encrypted document"). */
  processingError: string | null;
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
  pageCountSource: z.enum(PAGE_COUNT_SOURCES as [PageCountSource, ...PageCountSource[]]),
  copies: z.number().int().positive(),
  colorMode: z.enum(['bw', 'color'] as [ColorMode, ...ColorMode[]]),
  pageRange: z.string().max(100).nullable(),
  paperSize: z.enum(['a4', 'a3', 'letter', 'legal'] as [PaperSize, ...PaperSize[]]),
  duplex: z.boolean(),
  pricePaise: z.number().int().nonnegative(),
  status: z.enum(FILE_STATUSES as [FileStatus, ...FileStatus[]]),
  processingError: z.string().nullable(),
  printedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** MIME types a customer is permitted to upload. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  // PDF
  'application/pdf',
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  // Microsoft Office
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  // OpenDocument
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'application/vnd.oasis.opendocument.presentation', // .odp
  // Rich Text
  'application/rtf',
  'text/plain', // .txt
  'text/csv', // .csv
  // Other
  'application/vnd.ms-outlook', // .msg
  'application/x-latex', // .tex
] as const;

/** Human-readable file type labels for the UI. */
export const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG Image',
  'image/png': 'PNG Image',
  'image/gif': 'GIF Image',
  'image/webp': 'WebP Image',
  'image/bmp': 'BMP Image',
  'image/tiff': 'TIFF Image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word DOCX',
  'application/msword': 'Word DOC',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint PPTX',
  'application/vnd.ms-powerpoint': 'PowerPoint PPT',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel XLSX',
  'application/vnd.ms-excel': 'Excel XLS',
  'application/vnd.oasis.opendocument.text': 'OpenDocument Text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument Sheet',
  'application/vnd.oasis.opendocument.presentation': 'OpenDocument Presentation',
  'application/rtf': 'Rich Text',
  'text/plain': 'Text File',
  'text/csv': 'CSV File',
};

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
