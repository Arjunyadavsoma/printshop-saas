/**
 * Smart Print Studio — shared types.
 *
 * The studio is a 5-step premium document-upload + print-configuration
 * experience that wraps the EXISTING Printelyx backend (chunked uploads,
 * quote, specs, orders, payment). No new API contracts — these types map
 * 1:1 to the request/response shapes the backend already accepts.
 *
 * See docs/PRINTELYX-VISUAL-IDENTITY.md for the consumer design tokens.
 */

/** The API uses 'color' (American); the UI says 'colour' (British). */
export type ApiPageMode = 'color' | 'bw' | 'skip';
export type UiPageMode = 'bw' | 'colour' | 'skip';

export function toApiMode(m: UiPageMode): ApiPageMode {
  return m === 'colour' ? 'color' : m;
}
export function toUiMode(m: ApiPageMode): UiPageMode {
  return m === 'color' ? 'colour' : m;
}

/** Client-side file lifecycle (matches the chunked-upload states). */
export type StudioFileStatus =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'converting'
  | 'ready'
  | 'failed';

export type PrintMode = 'bw' | 'colour' | 'mixed';

/** Per-file print settings — maps to the /specs PUT body + PrintSpec model. */
export interface PrintSettings {
  mode: PrintMode;
  copies: number;
  sides: 'SINGLE' | 'DOUBLE';
  pagesPerSheet: 1 | 2 | 4 | 6 | 9;
  paperSize: string;
  paperType: string;
  collate: boolean;
  /** For 'mixed' mode: the page numbers assigned to colour. */
  colourPages: number[];
  /** Pages to skip (not print). */
  skipPages: number[];
}

export const DEFAULT_SETTINGS: PrintSettings = {
  mode: 'bw',
  copies: 1,
  sides: 'SINGLE',
  pagesPerSheet: 1,
  paperSize: 'A4',
  paperType: 'PLAIN',
  collate: true,
  colourPages: [],
  skipPages: [],
};

/** A document in the studio, with its upload state + print settings. */
export interface StudioFile {
  id: string;
  fileId: string | null;
  uploadId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  progress: number;
  status: StudioFileStatus;
  failReason?: string | null;
  pageCount?: number | null;
  pageWidthPt?: number | null;
  pageHeightPt?: number | null;
  thumbnails: Array<{ page: number; url: string }>;
  colorSuggestion: Array<{ page: number; isColor: boolean }> | null;
  settings: PrintSettings;
}

export interface QuoteLine {
  paperSize: string;
  colorMode: 'BW' | 'COLOR';
  sides: string;
  paperType: string;
  pages: number;
  copies: number;
  perPagePaise: number;
  linePaise: number;
  ruleMissing?: boolean;
}
export interface QuoteAddon {
  label: string;
  unit: string;
  quantity: number;
  unitPaise: number;
  linePaise: number;
}
export interface Quote {
  lines: QuoteLine[];
  subtotalPaise: number | null;
  addonsPaise: number;
  addonsDetail: QuoteAddon[];
  urgentPaise: number;
  totalPaise: number | null;
  ruleMissing: boolean;
  warnings: string[];
}

export interface PlacedOrder {
  token: string;
  orderNumber: string;
  pickupCode: string;
  totalPaise: number;
  placedAt: number;
}

export interface ShopCapabilities {
  slug: string;
  name: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  paperSizes: string[];
  addons: Array<{ id: string; kind: string; label: string; pricePaise: number; pricingUnit: string }>;
  upiId: string;
  paymentMethods: 'upi' | 'cash' | 'both' | 'split';
  isOpen: boolean;
  acceptingOrders: boolean;
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

export type StudioStep = 'upload' | 'settings' | 'preview' | 'payment' | 'confirmation';

export const STEP_ORDER: StudioStep[] = ['upload', 'settings', 'preview', 'payment', 'confirmation'];
export const STEP_LABELS: Record<StudioStep, string> = {
  upload: 'Upload',
  settings: 'Print settings',
  preview: 'Review',
  payment: 'Payment',
  confirmation: 'Done',
};

export function formatRupees(paise: number | null | undefined): string {
  if (paise == null) return '—';
  const rs = paise / 100;
  return `₹${rs % 1 === 0 ? rs.toString() : rs.toFixed(2)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
