'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Clock, FileText, RotateCcw } from 'lucide-react';
import { Stepper } from '@/components/clear/stepper';
import { UploadDropzone } from '@/components/clear/upload-dropzone';
import { FileCard, type FileCardStatus } from '@/components/clear/file-card';
import { PageStrip } from '@/components/clear/page-strip';
import { ColorSuggestionPrompt } from '@/lib/customer/color-suggestion';
import { track, ANALYTICS_EVENTS } from '@/lib/customer/analytics';
import {
  saveLastChoices,
  loadLastChoices,
} from '@/lib/customer/last-choices';
import { useDraftRecovery } from '@/lib/hooks/use-draft-recovery';
import { loadDraft, type DraftData, type DraftFile } from '@/lib/customer/draft-storage';
import { Chip, ChipGroup } from '@/components/clear/chip';
import { NumberStepper } from '@/components/clear/number-stepper';
import { SegmentedControl } from '@/components/clear/segmented-control';
import { BottomSheet } from '@/components/clear/compat';
import { PriceBreakdown, formatRupees, type PriceLine } from '@/components/clear/price-breakdown';
import { TextField } from '@/components/clear/compat';
import { PhoneField } from '@/components/clear/compat';
import { StickyActionBar } from '@/components/clear/compat';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/clear/compat';
import { PaymentSheet } from '@/components/clear/payment-sheet';
import { UTRInput } from '@/components/clear/utr-input';
import type { PageMode } from '@/components/clear/tokens';
import { buildUpiIntentUrl } from '@/lib/payments/upi';
import { saveRecentOrder } from '@/lib/customer/recent-orders';
import {
  savePendingOrder,
  readPendingOrder,
  clearPendingOrder,
  markUpiLaunched,
  consumeUpiReturnFlag,
} from '@/lib/customer/order-restore';

/**
 * CustomerOrderFlowV2 — the redesigned customer order flow.
 *
 * Replaces the legacy 599-line CustomerOrderFlow with a 3-step Stepper
 * (Files → Options → Pay) built from the new design-system components in
 * `/components/customer/`. The signature interaction (the PageStrip with
 * per-page B&W/Colour/Skip toggles) lives behind the "Mix" preset so the
 * default path shows four preset cards, not fourteen fields.
 *
 * API contract is unchanged — the same eight endpoints the legacy flow used:
 *   uploads/init → chunk → complete → files/[id] → specs → quote → orders → o/[token]/payment
 *
 * P0 fixes from the audit:
 *   - Real UPI deep-link (shop.upiId + order amount) — no more `pa=TODO`.
 *   - 48px touch targets everywhere (every component already enforces this).
 *   - 16px input text (PhoneField, TextField, UTRInput all use text-base).
 *   - Stepper at the top (was missing).
 *   - Presets reduce visible fields from ~14 to 4 cards + "More options".
 *
 * Persistence:
 *   - Draft (files + pageModes + options + customer details) → localStorage
 *     on every change. Restored on mount so a refresh doesn't lose work.
 *   - "Order already placed" → sessionStorage so a refresh after placing
 *     skips straight back to the payment screen (Pay button stays disabled).
 *   - PLUS a durable localStorage pending order (see
 *     src/lib/customer/order-restore.ts): sessionStorage dies with the tab,
 *     and Android routinely kills the background browser tab while the
 *     customer is in the UPI app — without the durable record the customer
 *     came back to an empty flow (or, via the PWA launcher, to `/`).
 *     The pending record restores the payment screen on return, a
 *     visibilitychange handler reopens the UTR sheet, and it is cleared
 *     once the UTR is submitted / counter payment is chosen.
 */

/* ── Types ───────────────────────────────────────────────────────────── */

/** The API uses 'color' (American); the design system uses 'colour' (British). */
type ApiPageMode = 'color' | 'bw' | 'skip';

/** Client-side file status. 'uploaded' is the intermediate status the
    server reports between uploads/init and uploads/complete — it is
    normalised to 'converting' on the next poll (see the poll effect), but
    the union must admit it or the poll filter won't typecheck. */
type FlowFileStatus = 'uploading' | 'uploaded' | 'converting' | 'ready' | 'failed';

interface FlowFile {
  fileId: string;
  uploadId: string;
  name: string;
  sizeBytes: number;
  progress: number;
  status: FlowFileStatus;
  failReason?: string | null;
  pageCount?: number | null;
  thumbnails: Array<{ page: number; url: string }>;
  suggestion: Array<{ page: number; isColor: boolean }> | null;
  /** Page modes keyed by page number. Uses the design-system PageMode. */
  pageModes: Map<number, PageMode>;
  copies: number;
  sides: 'SINGLE' | 'DOUBLE';
  pagesPerSheet: 1 | 2 | 4 | 6 | 9;
  paperSize: string;
  paperType: string;
  collate: boolean;
  /** Which preset the customer picked (null = none yet). */
  preset: PresetId | null;
}

type PresetId = 'notes' | 'colour' | 'photo' | 'mix';

interface PlacedOrder {
  token: string;
  orderNumber: string;
  pickupCode: string;
  totalPaise: number;
  placedAt: number; // epoch ms — for the elapsed timer
}

interface QuoteLine {
  colorMode: string;
  pages: number;
  perPagePaise: number | null;
  copies: number;
  paperSize: string;
  sides: string;
}

interface Quote {
  totalPaise: number | null;
  subtotalPaise: number | null;
  addonsPaise: number;
  urgentPaise: number;
  lines: QuoteLine[];
  warnings: string[];
  ruleMissing: boolean;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const CHUNK = 2 * 1024 * 1024;
const QUOTE_DEBOUNCE_MS = 400;
/** Per-file size limit — must match the pipeline: src/lib/pipeline/upload-sessions.ts MAX_FILE_BYTES (50 MB). */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/**
 * Client-side extension gate — must match what the server pipeline
 * accepts (src/lib/pipeline/normalize.ts detectKind: pdf, jpg/jpeg, png,
 * webp, heic/heif, doc/docx, pptx, xlsx). Legacy .ppt/.xls are NOT
 * accepted server-side, so they are not pickable here either.
 */
const SUPPORTED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|docx?|pptx|xlsx)$/i;
const SUPPORTED_LABEL = 'PDF, JPG, PNG, WebP, HEIC, DOCX, DOC, PPTX, XLSX';
/** accept attribute for the dropzone input — same set as SUPPORTED_EXT. */
const DROPZONE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.pptx,.xlsx';
const FILE_POLL_MS = 1200;
const PLACED_SESSION_KEY = 'printshop:placed-order';
const DRAFT_LOCAL_KEY = 'printshop:customer-draft';

/**
 * Bucket the order total (in paise) into a coarse range string for analytics.
 * The customer's exact amount is personal-ish data; the bucket preserves
 * the funnel-shape insight without leaking it. See analytics.ts privacy notes.
 */
function amountPaiseRange(paise: number | null | undefined): string {
  if (paise == null) return 'unknown';
  const rupees = paise / 100;
  if (rupees < 10) return '0-10';
  if (rupees < 50) return '10-50';
  if (rupees < 100) return '50-100';
  if (rupees < 500) return '100-500';
  if (rupees < 1000) return '500-1000';
  return '1000+';
}

const STEPS = ['Files', 'Options', 'Pay'];

const PRESETS: Array<{
  id: PresetId;
  name: string;
  description: string;
}> = [
  { id: 'notes', name: 'Notes', description: 'B&W · double-sided' },
  { id: 'colour', name: 'Colour', description: 'All pages in colour' },
  { id: 'photo', name: 'Photo', description: '1 page · colour · single-sided' },
  { id: 'mix', name: 'Mix', description: 'Choose colour pages' },
];

const PAPER_SIZES = ['A4', 'A3', 'Letter'];
const PAGES_PER_SHEET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: '1 per sheet' },
  { value: '2', label: '2 per sheet' },
  { value: '4', label: '4 per sheet' },
  { value: '6', label: '6 per sheet' },
  { value: '9', label: '9 per sheet' },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * SHA-256 hex of a Blob slice, via the browser's WebCrypto. Used for per-
 * chunk checksums (P8.7) — the server verifies the checksum before writing
 * the chunk, so transit corruption is caught without touching the disk.
 */
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Retry an async op with exponential backoff: 1s → 2s → 4s → 8s (max 4
 * attempts). Used for chunk uploads — a transient network blip shouldn't
 * fail the whole upload, + the chunk route is idempotent (re-uploading the
 * same index + checksum is a no-op), so retrying is always safe.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
async function retryWithBackoff<T>(op: () => Promise<T>, attempts = RETRY_DELAYS_MS.length): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      // 4xx (other than 408/429) — don't retry, the request itself is bad
      // (e.g. CHECKSUM_MISMATCH, CHUNK_CONFLICT). Re-throw immediately.
      if (err instanceof Error && /\b(40[0-9]{2}|CHECKSUM_MISMATCH|CHUNK_CONFLICT|FILE_TOO_LARGE|TYPE_MISMATCH|UNSUPPORTED_TYPE)\b/.test(err.message)) {
        throw err;
      }
      if (i < attempts - 1) {
        const delay = RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('retry exhausted');
}

/** Convert the design-system PageMode to the API's American-spelled variant. */
function toApiMode(m: PageMode): ApiPageMode {
  return m === 'colour' ? 'color' : m;
}

/** Apply a preset to a FlowFile's pageModes + sides. Returns a new pageModes Map. */
function applyPreset(file: FlowFile, preset: PresetId): { pageModes: Map<number, PageMode>; sides: 'SINGLE' | 'DOUBLE'; copies: number } {
  const pageCount = file.pageCount ?? 0;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  switch (preset) {
    case 'notes':
      return {
        pageModes: new Map(pages.map((p) => [p, 'bw' as PageMode])),
        sides: 'DOUBLE',
        copies: file.copies,
      };
    case 'colour':
      return {
        pageModes: new Map(pages.map((p) => [p, 'colour' as PageMode])),
        sides: file.sides === 'DOUBLE' ? 'DOUBLE' : 'SINGLE',
        copies: file.copies,
      };
    case 'photo':
      // First page colour, rest skipped — single-sided, one copy. If the
      // document is a single page (the typical photo case) this colours it.
      return {
        pageModes: new Map(pages.map((p) => [p, (p === 1 ? 'colour' : 'skip') as PageMode])),
        sides: 'SINGLE',
        copies: 1,
      };
    case 'mix':
      // Preserve current modes; just ensure the strip is shown.
      return {
        pageModes: new Map(file.pageModes),
        sides: file.sides,
        copies: file.copies,
      };
  }
}

/** Estimate the price for a single preset (client-side) — for the card badge. */
function estimatePresetPrice(file: FlowFile, preset: PresetId, bwPerPagePaise: number, colorPerPagePaise: number): number | null {
  const pageCount = file.pageCount ?? 0;
  if (pageCount === 0) return null;
  const copies = file.copies;
  switch (preset) {
    case 'notes':
      // B&W all pages, double-sided → half the sheets (rounded up).
      return Math.ceil(pageCount / 2) * bwPerPagePaise * copies;
    case 'colour':
      return pageCount * colorPerPagePaise * copies;
    case 'photo':
      return colorPerPagePaise * copies;
    case 'mix':
      return null; // unknown until the customer picks pages
  }
}

/** Convert a Map<number, PageMode> to a plain array for JSON serialization. */
function pageModesToArray(m: Map<number, PageMode>): Array<[number, PageMode]> {
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
}

/** Convert a serialized array back to a Map. */
function pageModesFromArray(arr: Array<[number, PageMode]>): Map<number, PageMode> {
  return new Map(arr);
}

/** Optimistic row for a file picked by the customer, seeded BEFORE any
    network call so the tap always has visible feedback (diagnosis §4.4).
    Replaced with the real fileId once uploads/init resolves. */
function tempRow(file: globalThis.File, tempId: string): FlowFile {
  return {
    fileId: tempId,
    uploadId: '',
    name: file.name,
    sizeBytes: file.size,
    progress: 0,
    status: 'uploading',
    pageCount: null,
    thumbnails: [],
    suggestion: null,
    pageModes: new Map<number, PageMode>(),
    copies: 1,
    sides: 'SINGLE',
    pagesPerSheet: 1,
    paperSize: 'A4',
    paperType: 'PLAIN',
    collate: true,
    preset: null,
  };
}

/** A picked file the pipeline won't accept, shown as a failed row with a
    plain-language reason (spec screen 36) instead of a bare banner. */
function failedRow(file: globalThis.File, reason: string): FlowFile {
  return {
    ...tempRow(file, `rejected-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    status: 'failed',
    failReason: reason,
  };
}

/* ── Component ───────────────────────────────────────────────────────── */

export interface CustomerOrderFlowV2Props {
  shopSlug: string;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  retentionHours: number;
  /** Per-page paise from the shop's real pricing config (server page).
      Used for preset price badges + the client-side estimate fallback.
      Null when the shop has no pricing configured. */
  bwPerPagePaise?: number | null;
  colorPerPagePaise?: number | null;
}

export function CustomerOrderFlowV2({
  shopSlug,
  shopName,
  upiId,
  upiPayeeName,
  paymentMode,
  bwPerPagePaise,
  colorPerPagePaise,
}: CustomerOrderFlowV2Props) {
  const [draft, setDraft] = useState<{ orderId: string; orderToken: string } | null>(null);
  const [files, setFiles] = useState<FlowFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [step, setStep] = useState(0); // 0=Files, 1=Options, 2=Pay
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [payElapsed, setPayElapsed] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pricesChanged, setPricesChanged] = useState<number | null>(null);
  // Rate card for preset price badges + the client-side estimate fallback.
  // Seeded from the server page's real pricing config when available; the
  // fetch below is only a fallback (it used to read rateBwPerPagePaise /
  // rateColorPerPagePaise, which GET /api/v1/shops/[slug] never returns —
  // that endpoint returns pricingConfig — so the badges never showed).
  const [rateCard, setRateCard] = useState<{ bwPerPagePaise: number; colorPerPagePaise: number } | null>(
    bwPerPagePaise != null && colorPerPagePaise != null
      ? { bwPerPagePaise, colorPerPagePaise }
      : null,
  );
  /** fileIds whose color-suggestion prompt the customer has dismissed. */
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => new Set());
  /** Whether we've already applied the saved last-choices preset to a new file. */
  const lastChoicesAppliedRef = useRef(false);

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * AbortController for the in-flight quote request. When a new quote cycle
   * starts (because the customer toggled another page or changed a spec),
   * we abort the previous request so its stale response can't race the
   * freshest one + overwrite the live total with an out-of-date price.
   */
  const quoteAbortRef = useRef<AbortController | null>(null);
  const payTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoredRef = useRef(false);
  /** Tracks the last quote total we fired `quote_viewed` for, so we only fire once per fresh price. */
  const lastQuoteViewedRef = useRef<number | null>(null);

  const active = files[activeIdx];

  /* ── IndexedDB draft recovery ──────────────────────────────────────── */

  // Build a DraftData snapshot from the current state. Recomputed whenever
  // any of the inputs changes — the use-draft-recovery hook debounces the
  // actual IndexedDB write by 500ms so rapid edits don't thrash the DB.
  const draftData = useMemo<DraftData | null>(() => {
    if (!draft) return null;
    const activeFile = files[activeIdx] ?? files[0];
    return {
      shopSlug,
      orderId: draft.orderId,
      orderToken: draft.orderToken,
      files: files.map((f) => ({
        fileId: f.fileId,
        filename: f.name,
        pageCount: f.pageCount ?? 0,
        status: f.status,
        // P8.7: capture the upload session while a file is mid-upload so a
        // page refresh can resume from the server's offset (GET /status).
        // Cleared once the file transitions to 'converting' (init → complete).
        uploadId: f.status === 'uploading' ? f.uploadId : undefined,
        sizeBytes: f.sizeBytes,
        chunkSize: CHUNK,
      })),
      pageModes: Object.fromEntries(
        files.map((f) => [
          f.fileId,
          Array.from(f.pageModes.entries())
            .sort(([a], [b]) => a - b)
            .map(([page, mode]) => ({ page, mode })),
        ]),
      ),
      options: activeFile
        ? {
            preset: activeFile.preset ?? undefined,
            copies: activeFile.copies,
            paperSize: activeFile.paperSize,
            sides: activeFile.sides,
            pagesPerSheet: activeFile.pagesPerSheet,
          }
        : { copies: 1, paperSize: 'A4', sides: 'SINGLE', pagesPerSheet: 1 },
      customer: { name: customerName, phone: customerPhone, note },
      updatedAt: Date.now(),
    };
  }, [draft, files, activeIdx, customerName, customerPhone, note, shopSlug]);

  const draftRecovery = useDraftRecovery(shopSlug, draftData);

  /* ── Analytics: shop_landed (fires once on mount) ──────────────────── */

  useEffect(() => {
    track(ANALYTICS_EVENTS.shopLanded, { shop_slug: shopSlug });
    // We intentionally do NOT also fire `reorder_clicked` here — that event
    // is reserved for the "Print again" tap on /orders and the tracking
    // page. A plain landing is `shop_landed`.
  }, [shopSlug]);

  /* ── Analytics: quote_viewed (fires once when a fresh price appears) ── */

  useEffect(() => {
    const total = quote?.totalPaise ?? null;
    if (total == null) return;
    if (lastQuoteViewedRef.current === total) return;
    lastQuoteViewedRef.current = total;
    track(ANALYTICS_EVENTS.quoteViewed, {
      shop_slug: shopSlug,
      amount_paise_range: amountPaiseRange(total),
    });
  }, [quote, shopSlug]);


  /* ── Draft persistence (localStorage) ──────────────────────────────── */

  // Persist on every change to draft/files/customer details.
  useEffect(() => {
    if (restoredRef.current === false) return; // don't write before we've read
    if (!draft) return;
    try {
      const payload = {
        shopSlug,
        draft,
        files: files.map((f) => ({
          fileId: f.fileId,
          uploadId: f.uploadId,
          name: f.name,
          sizeBytes: f.sizeBytes,
          status: f.status,
          pageCount: f.pageCount ?? null,
          pageModes: pageModesToArray(f.pageModes),
          copies: f.copies,
          sides: f.sides,
          pagesPerSheet: f.pagesPerSheet,
          paperSize: f.paperSize,
          paperType: f.paperType,
          collate: f.collate,
          preset: f.preset,
        })),
        activeIdx,
        customerName,
        customerPhone,
        note,
      };
      localStorage.setItem(DRAFT_LOCAL_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be unavailable (private mode) — silently skip.
    }
  }, [draft, files, activeIdx, customerName, customerPhone, note, shopSlug]);

  // Restore on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_LOCAL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        shopSlug?: string;
        draft?: { orderId: string; orderToken: string };
        files?: Array<{
          fileId: string; uploadId: string; name: string; sizeBytes: number;
          status: FlowFileStatus; pageCount?: number | null;
          pageModes?: Array<[number, PageMode]>;
          copies: number; sides: 'SINGLE' | 'DOUBLE';
          pagesPerSheet: 1 | 2 | 4 | 6 | 9; paperSize: string; paperType: string;
          collate: boolean; preset: PresetId | null;
        }>;
        activeIdx?: number;
        customerName?: string;
        customerPhone?: string;
        note?: string;
      };
      if (parsed.shopSlug !== shopSlug || !parsed.draft || !parsed.files) return;
      // Only restore files that were at least uploaded (have a fileId + uploadId).
      const restoredFiles: FlowFile[] = parsed.files
        .filter((f) => f.fileId && f.uploadId)
        .map((f) => ({
          fileId: f.fileId,
          uploadId: f.uploadId,
          name: f.name,
          sizeBytes: f.sizeBytes,
          progress: 100,
          status: f.status === 'uploading' ? 'converting' : f.status, // re-poll to confirm
          pageCount: f.pageCount ?? null,
          thumbnails: [],
          suggestion: null,
          pageModes: pageModesFromArray(f.pageModes ?? []),
          copies: f.copies,
          sides: f.sides,
          pagesPerSheet: f.pagesPerSheet,
          paperSize: f.paperSize,
          paperType: f.paperType,
          collate: f.collate,
          preset: f.preset,
        }));
      if (restoredFiles.length === 0) return;
      setDraft(parsed.draft);
      setFiles(restoredFiles);
      setActiveIdx(Math.min(parsed.activeIdx ?? 0, restoredFiles.length - 1));
      setCustomerName(parsed.customerName ?? '');
      setCustomerPhone(parsed.customerPhone ?? '');
      setNote(parsed.note ?? '');
      setStep(1); // jump to Options if we have files
    } catch {
      // Corrupt draft — ignore.
    }
  }, [shopSlug]);

  // Restore "already placed" from sessionStorage so a refresh after the
  // Pay button tap doesn't re-enable it. Falls back to the durable
  // localStorage pending order: sessionStorage dies when Android kills
  // the background tab while the customer is in the UPI app, which is
  // exactly the return path this must survive (see order-restore.ts).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PLACED_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlacedOrder & { shopSlug?: string };
        if ((!parsed.shopSlug || parsed.shopSlug === shopSlug) && parsed.token && parsed.orderNumber) {
          setPlaced({
            token: parsed.token,
            orderNumber: parsed.orderNumber,
            pickupCode: parsed.pickupCode,
            totalPaise: parsed.totalPaise,
            placedAt: parsed.placedAt,
          });
          return;
        }
      }
    } catch {
      // ignore — fall through to the durable record below
    }
    const pending = readPendingOrder(shopSlug);
    if (pending) {
      setPlaced({
        token: pending.token,
        orderNumber: pending.orderNumber,
        pickupCode: pending.pickupCode,
        totalPaise: pending.totalPaise,
        placedAt: pending.placedAt,
      });
    }
  }, [shopSlug]);

  // UPI return: when the tab becomes visible again, restore the payment
  // screen if the tab was killed while the customer was in the UPI app,
  // and reopen the UTR sheet if a UPI launch was in flight (the blind
  // setTimeout(1500) in the launch handler fires while the tab is hidden
  // and cannot be relied on). No-op on a plain mount with no pending
  // order and no launch flag.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (!placed) {
        const pending = readPendingOrder(shopSlug);
        if (pending) {
          setPlaced({
            token: pending.token,
            orderNumber: pending.orderNumber,
            pickupCode: pending.pickupCode,
            totalPaise: pending.totalPaise,
            placedAt: pending.placedAt,
          });
        }
        return;
      }
      if (consumeUpiReturnFlag()) setPaymentSheetOpen(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [placed, shopSlug]);

  /* ── Rate card fetch (for preset price badges) ─────────────────────── */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/shops/${shopSlug}`);
        if (!res.ok) return;
        const d = (await res.json()) as {
          data?: {
            rateBwPerPagePaise?: number;
            rateColorPerPagePaise?: number;
            pricingConfig?: string | { bw_a4_per_page?: number; color_a4_per_page?: number };
          };
        };
        if (cancelled || !d.data) return;
        const cfg = typeof d.data.pricingConfig === 'string'
          ? (() => { try { return JSON.parse(d.data.pricingConfig) as { bw_a4_per_page?: number; color_a4_per_page?: number }; } catch { return undefined; } })()
          : d.data.pricingConfig;
        const bw = d.data.rateBwPerPagePaise ?? cfg?.bw_a4_per_page;
        const color = d.data.rateColorPerPagePaise ?? cfg?.color_a4_per_page;
        if (typeof bw === 'number' && typeof color === 'number') {
          setRateCard({ bwPerPagePaise: bw, colorPerPagePaise: color });
        }
      } catch {
        // rate card is for preset badges only — silent on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopSlug]);

  /* ── Upload (init → chunked PUT → complete) ────────────────────────── */

  /**
   * uploadChunks — stream a file's chunks (with checksum + retry) into an
   * already-created upload session, then complete it. Shared by uploadOne
   * and by the first-file path in onPick, which reuses the session its
   * single init call created instead of init-ing twice.
   */
  const uploadChunks = useCallback(
    async (
      file: globalThis.File,
      uploadId: string,
      fileId: string,
      missingChunks: number[] | null,
    ) => {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));
      const indicesToUpload =
        missingChunks && missingChunks.length > 0
          ? missingChunks
          : Array.from({ length: totalChunks }, (_, i) => i);

      for (const index of indicesToUpload) {
        const start = index * CHUNK;
        const end = Math.min(start + CHUNK, file.size);
        const chunk = file.slice(start, end);
        const checksum = await sha256Hex(chunk);

        await retryWithBackoff(async () => {
          const res = await fetch(
            `/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}&index=${index}&checksum=${checksum}`,
            { method: 'PUT', body: chunk },
          );
          if (!res.ok) {
            const e = (await res.json().catch(() => null)) as {
              error?: { message?: string; code?: string };
            };
            const msg = e?.error?.message ?? 'Upload failed';
            const err = new Error(msg);
            // Attach the code so retryWithBackoff can decide whether to retry.
            if (e?.error?.code) (err as Error & { code?: string }).code = e.error.code;
            throw err;
          }
        });

        // Update progress — `end` is the byte offset after this chunk.
        setFiles((fs) =>
          fs.map((f) =>
            f.fileId === fileId
              ? { ...f, progress: Math.round((end / file.size) * 100) }
              : f,
          ),
        );
      }

      // Complete → triggers server-side assembly + size verification.
      setFiles((fs) => fs.map((f) => (f.fileId === fileId ? { ...f, status: 'converting' } : f)));
      const compRes = await fetch(`/api/v1/s/${shopSlug}/uploads/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (!compRes.ok) {
        const e = (await compRes.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        };
        // UPLOAD_INCOMPLETE (409) — the server says some chunks are missing
        // (shouldn't happen here since we just uploaded them all, but a race
        // with the janitor is possible). Surface the error; the customer can
        // retry — the resume logic will pick up where we left off.
        throw new Error(e?.error?.message ?? 'Processing failed');
      }
    },
    [shopSlug],
  );

  /**
   * uploadOne — upload a single file via the chunked protocol.
   *
   * P8.7 enhancements:
   *  - **Resume**: before init, check the IndexedDB draft for an upload
   *    session matching this file's name + size. If found, query
   *    `GET /status` to get the missing-chunk list + skip the chunks
   *    already on disk. If the session is gone (expired by the janitor),
   *    start fresh.
   *  - **Per-chunk checksum**: each chunk is SHA-256'd in the browser via
   *    WebCrypto + sent as `?checksum=<hex>`. The server verifies before
   *    writing — transit corruption is caught without touching the disk.
   *  - **Retry with backoff**: a network error mid-chunk retries with
   *    1s → 2s → 4s → 8s backoff (4 attempts). The chunk route is
   *    idempotent (re-uploading the same index + checksum is a no-op), so
   *    retrying is always safe. 4xx errors that aren't transient (e.g.
   *    CHECKSUM_MISMATCH) re-throw immediately.
   *  - **Cancel cleanup**: a per-file AbortController lets the host cancel
   *    mid-upload; on abort, `DELETE /chunk?uploadId=X` cleans up the
   *    partial bytes server-side (so the janitor doesn't have to).
   */
  const uploadOne = useCallback(
    async (file: globalThis.File, orderId: string, orderToken: string, tempId?: string) => {
      // ── 1. Resume check: is there an in-progress session for this file? ──
      let uploadId: string | null = null;
      let fileId: string | null = null;
      let missingChunks: number[] | null = null;
      try {
        const stored = await loadDraft(shopSlug);
        const match = stored?.files.find(
          (f: DraftFile) =>
            f.uploadId &&
            f.sizeBytes === file.size &&
            f.filename === file.name &&
            f.status === 'uploading',
        );
        if (match?.uploadId) {
          // Query the server's offset — if the session is still alive, reuse
          // the uploadId + skip the chunks already on disk.
          const statusRes = await fetch(
            `/api/v1/s/${shopSlug}/uploads/status?uploadId=${match.uploadId}`,
          );
          if (statusRes.ok) {
            const d = (await statusRes.json()) as {
              data?: { missingChunks?: number[]; status?: string; uploadId?: string };
            };
            if (d.data?.uploadId && d.data.status === 'active') {
              uploadId = match.uploadId;
              fileId = match.fileId;
              missingChunks = d.data.missingChunks ?? [];
            }
          }
          // If the status query 404'd (session expired), fall through + init
          // a fresh session below.
        }
      } catch {
        // Draft load / status query failure — non-fatal; just start fresh.
      }

      // ── 2. Init a fresh session if we didn't resume one. ──
      if (!uploadId || !fileId) {
        const initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            orderId,
            orderToken,
          }),
        });
        const init = (await initRes.json()) as {
          data?: { fileId: string; uploadId: string };
          error?: { message?: string };
        };
        if (!initRes.ok || !init.data) throw new Error(init?.error?.message ?? 'Upload failed');
        uploadId = init.data.uploadId;
        fileId = init.data.fileId;
        // No missingChunks → upload every chunk (0..totalChunks-1).
        missingChunks = null;
      }

      // Bind to consts so closures below can capture non-null values
      // (TypeScript's CFA can't narrow `let` variables across closures).
      const activeUploadId = uploadId;
      const activeFileId = fileId;
      if (!activeUploadId || !activeFileId) {
        throw new Error('Upload session could not be established');
      }

      // Swap the optimistic temp row (if any) for the real file row, or
      // update the existing row when resuming.
      setFiles((fs) => {
        const existingIdx = fs.findIndex(
          (f) => (tempId != null && f.fileId === tempId) || f.fileId === activeFileId,
        );
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));
        const alreadyDone = missingChunks ? totalChunks - missingChunks.length : 0;
        const initialProgress = Math.round((alreadyDone / totalChunks) * 100);
        const row = {
          fileId: activeFileId,
          uploadId: activeUploadId,
          name: file.name,
          sizeBytes: file.size,
          progress: initialProgress,
          status: 'uploading' as FlowFileStatus,
          thumbnails: [],
          suggestion: null,
          pageModes: new Map<number, PageMode>(),
          copies: 1,
          sides: 'SINGLE' as const,
          pagesPerSheet: 1 as const,
          paperSize: 'A4',
          paperType: 'PLAIN',
          collate: true,
          preset: null,
        };
        if (existingIdx >= 0) {
          const next = [...fs];
          next[existingIdx] = { ...next[existingIdx]!, ...row };
          return next;
        }
        return [...fs, row];
      });

      // ── 3. Stream the chunks, then complete. ──
      await uploadChunks(file, activeUploadId, activeFileId, missingChunks);
    },
    [shopSlug, uploadChunks],
  );

  /**
   * cancelUpload — abort an in-progress upload + clean up server-side.
   *
   * Calls `DELETE /chunk?uploadId=X` so the partial bytes are removed
   * immediately (the janitor cron would eventually expire them, but a
   * deliberate cancel should free the disk + the session slot right away).
   * Also removes the file row from the UI.
   */
  const cancelUpload = useCallback(
    async (fileId: string) => {
      const file = files.find((f) => f.fileId === fileId);
      if (!file) return;
      // Best-effort cancel — don't block the UI on the network call.
      void (async () => {
        try {
          await fetch(
            `/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${file.uploadId}`,
            { method: 'DELETE' },
          );
        } catch {
          // The session will expire via the janitor either way.
        }
      })();
      setFiles((fs) => fs.filter((f) => f.fileId !== fileId));
    },
    [files, shopSlug],
  );

  const onPick = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) return;
      setError(null);
      // ── Optimistic UI (diagnosis §4.4): seed a row for every picked
      // file + switch to the files step BEFORE any network call, so the
      // tap always has visible feedback. Client-side validation runs
      // first (same extension set + 50 MB limit the server enforces);
      // rejected files become failed rows with a plain-language reason
      // (spec screen 36). No server order exists until the first valid
      // file's init call below.
      setStep(0);
      const stamp = Date.now().toString(36);
      const tempIds = new Map<File, string>();
      const rejectedRows: FlowFile[] = [];
      const uploadable: File[] = [];
      for (const [i, f] of picked.entries()) {
        if (!SUPPORTED_EXT.test(f.name)) {
          rejectedRows.push(failedRow(f, `Not supported. Use a ${SUPPORTED_LABEL} file.`));
        } else if (f.size > MAX_FILE_BYTES) {
          rejectedRows.push(failedRow(f, 'Too big. The limit is 50 MB.'));
        } else {
          const tempId = `temp-${stamp}-${i}`;
          tempIds.set(f, tempId);
          uploadable.push(f);
        }
      }
      if (rejectedRows.length > 0) setFiles((fs) => [...fs, ...rejectedRows]);
      if (uploadable.length > 0) {
        setFiles((fs) => [...fs, ...uploadable.map((f) => tempRow(f, tempIds.get(f)!))]);
      }
      if (uploadable.length === 0) {
        setError(
          `Couldn't add ${rejectedRows.length === 1 ? 'that file' : 'those files'}. See the reason on each file and try again with a supported file.`,
        );
        return;
      }
      // Analytics: upload_started — file_count + total size bucket (no file names).
      const totalBytes = uploadable.reduce((s, f) => s + f.size, 0);
      const sizeBucket =
        totalBytes < 512 * 1024 ? '<512KB' :
        totalBytes < 2 * 1024 * 1024 ? '512KB-2MB' :
        totalBytes < 10 * 1024 * 1024 ? '2MB-10MB' : '10MB+';
      track(ANALYTICS_EVENTS.uploadStarted, {
        shop_slug: shopSlug,
        file_count: uploadable.length,
        size_bucket: sizeBucket,
      });
      // Mark one file's row failed. Matches by temp id, or — once init has
      // swapped the temp id for the real fileId — by name + size while the
      // row is still in flight.
      const markFailed = (file: File, err: unknown) => {
        const reason = err instanceof Error ? err.message : 'Upload failed';
        const bucket =
          /network|fetch|failed to fetch/i.test(reason) ? 'network' :
          /size|too large|quota/i.test(reason) ? 'size' :
          /mime|type|unsupported/i.test(reason) ? 'mime' : 'server';
        track(ANALYTICS_EVENTS.uploadFailed, {
          shop_slug: shopSlug,
          reason: bucket,
          file_count: 1,
        });
        const tempId = tempIds.get(file);
        setFiles((fs) =>
          fs.map((x) =>
            x.fileId === tempId ||
            (x.name === file.name &&
              x.sizeBytes === file.size &&
              (x.status === 'uploading' || x.status === 'converting'))
              ? { ...x, status: 'failed' as FlowFileStatus, failReason: reason }
              : x,
          ),
        );
      };

      let current = draft;
      if (!current) {
        // ONE init for the first file: it creates the draft order AND the
        // file row. (Previously this called init here and then uploadOne
        // called init again, orphaning a never-completed file row.)
        const first = uploadable[0]!;
        let initRes: Response;
        try {
          initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: first.name,
              mimeType: first.type || 'application/octet-stream',
              sizeBytes: first.size,
            }),
          });
        } catch (e) {
          markFailed(first, e);
          setError(e instanceof Error ? e.message : 'Upload failed');
          return;
        }
        const init = (await initRes.json()) as {
          data?: { orderId: string; orderToken: string; fileId: string; uploadId: string };
          error?: { message?: string };
        };
        if (!initRes.ok || !init.data) {
          const err = new Error(init?.error?.message ?? 'Upload failed');
          markFailed(first, err);
          setError(err.message);
          return;
        }
        current = { orderId: init.data.orderId, orderToken: init.data.orderToken };
        setDraft(current);
        // Swap the temp row for the real file row, then stream its chunks.
        setFiles((fs) =>
          fs.map((x) =>
            x.fileId === tempIds.get(first)
              ? { ...x, fileId: init.data!.fileId, uploadId: init.data!.uploadId }
              : x,
          ),
        );
        try {
          await uploadChunks(first, init.data.uploadId, init.data.fileId, null);
        } catch (e) {
          markFailed(first, e);
        }
        for (const f of uploadable.slice(1)) {
          try {
            await uploadOne(f, current.orderId, current.orderToken, tempIds.get(f));
          } catch (e) {
            markFailed(f, e);
          }
        }
      } else {
        for (const f of uploadable) {
          try {
            await uploadOne(f, current.orderId, current.orderToken, tempIds.get(f));
          } catch (e) {
            markFailed(f, e);
          }
        }
      }
    },
    [draft, shopSlug, uploadOne, uploadChunks],
  );

  /* ── Poll converting files until READY ─────────────────────────────── */

  useEffect(() => {
    // Poll files that are still being processed. The server also reports
    // the intermediate 'uploaded' status (row created by uploads/init,
    // before uploads/complete flips it to 'converting'); treat any
    // non-terminal status as 'converting' so polling never stalls and the
    // row never renders an undefined status label.
    const pending = files.filter((f) => f.status === 'converting' || f.status === 'uploaded');
    if (pending.length === 0 || !draft) return;
    const t = setTimeout(async () => {
      for (const f of pending) {
        try {
          const res = await fetch(`/api/v1/s/${shopSlug}/files/${f.fileId}?token=${draft.orderToken}`);
          if (!res.ok) continue;
          const d = (await res.json()) as {
            data?: {
              status: FlowFileStatus;
              failReason?: string | null;
              pageCount?: number | null;
              thumbnails?: Array<{ page: number; url: string }>;
              colorSuggestion?: Array<{ page: number; isColor: boolean }> | null;
            };
          };
          if (!d.data) continue;
          // Analytics: file_ready — fires once per file when the pipeline
          // completes. `f.status` was 'converting' (we only polled those),
          // so a 'ready' response is a transition.
          if (d.data.status === 'ready') {
            const colorPages = d.data.colorSuggestion?.filter((s) => s.isColor).length ?? 0;
            track(ANALYTICS_EVENTS.fileReady, {
              shop_slug: shopSlug,
              page_count: d.data.pageCount ?? 0,
              has_color_suggestion: colorPages > 0,
              color_page_count: colorPages,
            });
          }
          setFiles((fs) =>
            fs.map((x) => {
              if (x.fileId !== f.fileId) return x;
              const pageCount = d.data!.pageCount ?? null;
              // On first READY, seed pageModes from the colorSuggestion (B&W by
              // default, colour where the server detected colour). If pageModes
              // already exist (from a restored draft), keep them.
              const seedModes =
                x.pageModes.size === 0 && pageCount && d.data!.colorSuggestion
                  ? new Map<number, PageMode>(
                      d.data!.colorSuggestion.map((s) => [s.page, (s.isColor ? 'colour' : 'bw') as PageMode]),
                    )
                  : x.pageModes;
              return {
                ...x,
                // Map any non-terminal server status ('uploaded',
                // 'converting', …) to 'converting' so the poll keeps
                // running and the status label never renders undefined.
                status: d.data!.status === 'ready' || d.data!.status === 'failed' ? d.data!.status : 'converting',
                failReason: d.data!.failReason ?? null,
                pageCount,
                thumbnails: d.data!.thumbnails ?? [],
                suggestion: d.data!.colorSuggestion ?? null,
                pageModes: seedModes,
              };
            }),
          );
        } catch {
          // network blip — try again next tick
        }
      }
    }, FILE_POLL_MS);
    return () => clearTimeout(t);
  }, [files, draft, shopSlug]);

  /* ── No auto-advance: the customer moves Files → Options with the
     explicit Continue button (spec screen 3 sticky bar). Auto-advancing
     on the first READY file yanked the customer away from the file list
     while other files were still uploading. ─────────────────────────── */

  /* ── Debounced server quote ────────────────────────────────────────── */

  const readyFiles = files.filter((f) => f.status === 'ready' && (f.pageCount ?? 0) > 0);
  const quoteKey = readyFiles
    .map((f) =>
      [
        f.fileId,
        f.copies,
        f.sides,
        f.pagesPerSheet,
        f.paperSize,
        [...f.pageModes.entries()].sort((a, b) => a[0] - b[0]).map(([p, m]) => `${p}${m}`).join(','),
      ].join(':'),
    )
    .join('|');

  useEffect(() => {
    if (readyFiles.length === 0) {
      setQuote(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    // Abort the previous in-flight quote so its stale response can't race
    // the fresh one (e.g. the customer toggled two pages in quick
    // succession — only the latest toggle's price should land).
    if (quoteAbortRef.current) {
      quoteAbortRef.current.abort();
      quoteAbortRef.current = null;
    }
    setQuoting(true);
    // A fresh controller per cycle. Stored on a ref so the cleanup fn + the
    // next cycle can both reach it.
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    quoteTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/s/${shopSlug}/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: readyFiles.map((f) => ({
              fileId: f.fileId,
              spec: {
                pageModes: Array.from({ length: f.pageCount! }, (_, i) => ({
                  page: i + 1,
                  mode: toApiMode(f.pageModes.get(i + 1) ?? 'bw'),
                })),
                copies: f.copies,
                sides: f.sides,
                pagesPerSheet: f.pagesPerSheet,
                paperSize: f.paperSize,
                paperType: f.paperType,
                collate: f.collate,
              },
            })),
            addonIds: [],
            urgent: false,
          }),
          signal: controller.signal,
        });
        const d = (await res.json()) as { data?: Quote; error?: { message?: string } };
        if (res.ok && d.data) setQuote(d.data);
        else setError(d?.error?.message ?? 'Could not price the order');
      } catch (e) {
        // AbortError is expected when a fresher quote cycle supersedes this
        // one — silence it so it doesn't surface as a customer-facing error.
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : 'Could not price the order');
        }
      } finally {
        // Only clear the quoting flag if this is still the active request.
        // If a newer cycle has already started (and set quoting=true again),
        // clearing it here would briefly hide the spinner.
        if (quoteAbortRef.current === controller) {
          setQuoting(false);
          quoteAbortRef.current = null;
        }
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
      // If the effect is re-running (or unmounting), abort the in-flight
      // request so we never leave a dangling fetch that could resolve after
      // the customer has navigated away.
      if (quoteAbortRef.current) {
        quoteAbortRef.current.abort();
        quoteAbortRef.current = null;
      }
    };
  }, [quoteKey, shopSlug]);

  /* ── Page-mode actions ─────────────────────────────────────────────── */

  const patchFile = useCallback((fileId: string, patch: Partial<FlowFile>) => {
    setFiles((fs) => fs.map((f) => (f.fileId === fileId ? { ...f, ...patch } : f)));
  }, []);

  const toggleMode = useCallback((fileId: string, page: number) => {
    setFiles((fs) =>
      fs.map((f) => {
        if (f.fileId !== fileId) return f;
        const m = new Map(f.pageModes);
        const current = m.get(page) ?? 'bw';
        const next: PageMode = current === 'bw' ? 'colour' : current === 'colour' ? 'skip' : 'bw';
        m.set(page, next);
        // Analytics: colour_pages_changed — fire after the state update with
        // the new count so the funnel reflects the customer's actual choice.
        const newColourCount = [...m.values()].filter((v) => v === 'colour').length;
        track(ANALYTICS_EVENTS.colourPagesChanged, {
          shop_slug: shopSlug,
          colour_page_count: newColourCount,
          source: 'toggle',
        });
        return { ...f, pageModes: m };
      }),
    );
  }, [shopSlug]);

  const setAllModes = useCallback((fileId: string, mode: PageMode) => {
    setFiles((fs) =>
      fs.map((f) => {
        if (f.fileId !== fileId) return f;
        const pageCount = f.pageCount ?? 0;
        const newModes = new Map(Array.from({ length: pageCount }, (_, i) => [i + 1, mode] as const));
        if (mode === 'colour') {
          track(ANALYTICS_EVENTS.colourPagesChanged, {
            shop_slug: shopSlug,
            colour_page_count: pageCount,
            source: 'bulk',
          });
        } else if (mode === 'bw') {
          track(ANALYTICS_EVENTS.colourPagesChanged, {
            shop_slug: shopSlug,
            colour_page_count: 0,
            source: 'bulk',
          });
        }
        return { ...f, pageModes: newModes };
      }),
    );
  }, [shopSlug]);

  const applySuggestion = useCallback((fileId: string) => {
    setFiles((fs) =>
      fs.map((f) => {
        if (f.fileId !== fileId || !f.suggestion) return f;
        const newModes = new Map(f.suggestion.map((s) => [s.page, (s.isColor ? 'colour' : 'bw') as PageMode]));
        const newColourCount = f.suggestion.filter((s) => s.isColor).length;
        track(ANALYTICS_EVENTS.colourPagesChanged, {
          shop_slug: shopSlug,
          colour_page_count: newColourCount,
          source: 'suggestion_accepted',
        });
        return { ...f, pageModes: newModes };
      }),
    );
  }, [shopSlug]);

  const pickPreset = useCallback(
    (fileId: string, preset: PresetId) => {
      setFiles((fs) =>
        fs.map((f) => {
          if (f.fileId !== fileId) return f;
          if (f.status !== 'ready' || (f.pageCount ?? 0) === 0) return f;
          const { pageModes, sides, copies } = applyPreset(f, preset);
          return { ...f, pageModes, sides, copies, preset };
        }),
      );
      // Analytics: preset_chosen — which preset the customer picked.
      track(ANALYTICS_EVENTS.presetChosen, {
        shop_slug: shopSlug,
        preset_name: preset,
      });
      // Analytics: page_picker_opened — only when Mix is chosen (the page
      // strip renders, opening the manual page picker).
      if (preset === 'mix') {
        track(ANALYTICS_EVENTS.pagePickerOpened, { shop_slug: shopSlug });
      }
      // Remember last choices — only for non-Mix presets (Mix is file-specific).
      // The active file's options are captured so the next visit can restore them.
      const file = files.find((f) => f.fileId === fileId);
      if (file && preset !== 'mix') {
        saveLastChoices(shopSlug, {
          preset,
          copies: file.copies,
          paperSize: file.paperSize,
          sides: file.sides,
          pagesPerSheet: file.pagesPerSheet,
        });
      }
    },
    [shopSlug, files],
  );

  /* ── Smart defaults: pre-select the customer's last preset ─────────── */

  // When the first file becomes READY and we haven't yet applied the saved
  // last-choices preset, apply it now. This gives returning customers their
  // usual preset without re-clicking. "Mix" is normalised to "Notes BW" by
  // loadLastChoices — so this never auto-opens the page strip.
  useEffect(() => {
    if (lastChoicesAppliedRef.current) return;
    const firstReady = files.find((f) => f.status === 'ready' && (f.pageCount ?? 0) > 0);
    if (!firstReady) return;
    if (firstReady.preset !== null) return; // the customer (or restored draft) already chose
    const last = loadLastChoices(shopSlug);
    if (!last) {
      lastChoicesAppliedRef.current = true;
      return;
    }
    lastChoicesAppliedRef.current = true;
    pickPreset(firstReady.fileId, last.preset as PresetId);
    // Apply the saved copies + paperSize + sides + pagesPerSheet too.
    patchFile(firstReady.fileId, {
      copies: last.copies,
      paperSize: last.paperSize,
      sides: last.sides as 'SINGLE' | 'DOUBLE',
      pagesPerSheet: last.pagesPerSheet as 1 | 2 | 4 | 6 | 9,
    });
  }, [files, shopSlug, pickPreset, patchFile]);

  /* ── Place the order ───────────────────────────────────────────────── */

  const place = useCallback(async () => {
    if (!draft || placing) return;
    setPlacing(true);
    setError(null);
    // Analytics: checkout_started — the customer tapped "Pay" / "Place order".
    track(ANALYTICS_EVENTS.checkoutStarted, {
      shop_slug: shopSlug,
      file_count: readyFiles.length,
      amount_paise_range: amountPaiseRange(quote?.totalPaise ?? null),
    });
    try {
      // Sync specs to the server for every ready file (placeOrder requires
      // a PrintSpec row to exist for each file).
      for (const f of readyFiles) {
        const pageCount = f.pageCount ?? 0;
        const colorPages: number[] = [];
        const skipPages: number[] = [];
        for (let p = 1; p <= pageCount; p++) {
          const m = f.pageModes.get(p) ?? 'bw';
          if (m === 'colour') colorPages.push(p);
          else if (m === 'skip') skipPages.push(p);
        }
        const res = await fetch(`/api/v1/s/${shopSlug}/specs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: draft.orderId,
            orderToken: draft.orderToken,
            fileId: f.fileId,
            pageRangeText: '',
            copies: f.copies,
            sides: f.sides,
            pagesPerSheet: f.pagesPerSheet,
            paperSize: f.paperSize,
            paperType: f.paperType,
            collate: f.collate,
            colorPages,
            skipPages,
          }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
          throw new Error(e?.error?.message ?? `Could not save options for ${f.name}`);
        }
      }

      const res = await fetch(`/api/v1/s/${shopSlug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: draft.orderId,
          orderToken: draft.orderToken,
          addonIds: [],
          urgent: false,
          customerName: customerName || null,
          customerPhone: customerPhone.replace(/\D/g, '') || null,
          note: note || null,
          clientTotalPaise: totalPaise,
        }),
      });
      const d = (await res.json()) as {
        data?: { token: string; orderNumber: string; pickupCode: string; totalPaise: number };
        error?: { code?: string; message?: string };
      };
      if (res.status === 409 && d?.error?.code === 'PRICES_CHANGED') {
        setPricesChanged(d.data?.totalPaise ?? null);
        setError('Prices changed while you were ordering. Check the new total and confirm again.');
        return;
      }
      if (!res.ok || !d.data) throw new Error(d?.error?.message ?? 'Could not place the order');

      const placedOrder: PlacedOrder = {
        token: d.data.token,
        orderNumber: d.data.orderNumber,
        pickupCode: d.data.pickupCode,
        totalPaise: d.data.totalPaise,
        placedAt: Date.now(),
      };
      setPlaced(placedOrder);
      try {
        sessionStorage.setItem(
          PLACED_SESSION_KEY,
          JSON.stringify({ ...placedOrder, shopSlug }),
        );
      } catch {
        // sessionStorage may be unavailable — the in-memory state still works.
      }
      // Durable pending-order record (localStorage): sessionStorage dies
      // with the tab, and Android kills the background tab while the
      // customer is in the UPI app. Without this, returning from UPI
      // lands on an empty flow / homepage. See order-restore.ts.
      savePendingOrder({ ...placedOrder, shopSlug, shopName });
      // Persist the order summary on the device so the "My orders" page
      // (/orders) can list it. The shopSlug is captured here because the
      // tracking API doesn't expose it; the tracking page later refreshes
      // the status snapshot but preserves the slug (see saveRecentOrder merge).
      try {
        saveRecentOrder({
          token: placedOrder.token,
          shopSlug,
          shopName,
          orderNumber: placedOrder.orderNumber,
          pickupCode: placedOrder.pickupCode,
          totalPaise: placedOrder.totalPaise,
          status: 'awaiting_payment',
          placedAt: new Date(placedOrder.placedAt).toISOString(),
        });
      } catch {
        // localStorage may be unavailable — the order still works without it.
      }
      // Remember the active file's options as the customer's last choices so
      // the next visit gets smart defaults. Only for non-Mix presets.
      const activeFile = files[activeIdx] ?? files[0];
      if (activeFile && activeFile.preset && activeFile.preset !== 'mix') {
        saveLastChoices(shopSlug, {
          preset: activeFile.preset,
          copies: activeFile.copies,
          paperSize: activeFile.paperSize,
          sides: activeFile.sides,
          pagesPerSheet: activeFile.pagesPerSheet,
        });
      }
      // The draft is now consumed — clear both localStorage AND IndexedDB
      // so a future visit starts fresh.
      try {
        localStorage.removeItem(DRAFT_LOCAL_KEY);
      } catch {
        // ignore
      }
      void draftRecovery.clearDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the order');
    } finally {
      setPlacing(false);
    }
  }, [draft, placing, readyFiles, shopSlug, shopName, customerName, customerPhone, note, quote, files, activeIdx, draftRecovery]);

  /* ── Payment: UTR submission + counter ─────────────────────────────── */

  const submitUtr = useCallback(async () => {
    if (!placed) return;
    setError(null);
    // Analytics: paid_clicked + utr_submitted — the customer tapped "I've paid"
    // (the submit button) and a 12-digit UTR is being submitted.
    track(ANALYTICS_EVENTS.paidClicked, {
      shop_slug: shopSlug,
      method: 'upi',
    });
    track(ANALYTICS_EVENTS.utrSubmitted, {
      shop_slug: shopSlug,
      // No UTR value — just the fact of submission + length bucket.
      utr_length_bucket: '12',
    });
    try {
      const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'upi',
          utr: utr.replace(/\D/g, '').slice(0, 12),
        }),
      });
      const d = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not submit the payment');
      // Payment reference submitted — the pending-order record has served
      // its purpose; clear it so the homepage resume card disappears.
      clearPendingOrder();
      // Head to the tracking page — the shop confirms there.
      window.location.href = `/o/${placed.token}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    }
  }, [placed, utr, shopSlug]);

  const counterPayment = useCallback(async () => {
    if (!placed) return;
    setError(null);
    // Analytics: paid_clicked — counter-cash variant.
    track(ANALYTICS_EVENTS.paidClicked, {
      shop_slug: shopSlug,
      method: 'counter_cash',
    });
    try {
      const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'counter_cash' }),
      });
      if (res.ok) {
        clearPendingOrder();
        window.location.href = `/o/${placed.token}`;
      } else {
        const d = (await res.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(d?.error?.message ?? 'Could not switch to counter payment');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch to counter payment');
    }
  }, [placed, shopSlug]);

  /* ── Elapsed timer for the "Waiting for shop" screen ───────────────── */

  useEffect(() => {
    if (!placed) return;
    setPayElapsed(0);
    payTimer.current = setInterval(() => {
      setPayElapsed(Math.floor((Date.now() - placed.placedAt) / 1000));
    }, 1000);
    return () => {
      if (payTimer.current) clearInterval(payTimer.current);
    };
  }, [placed]);

  /* ── Derived values ────────────────────────────────────────────────── */

  const activeTotals = useMemo(() => {
    if (!active?.pageModes) return { bw: 0, colour: 0, skip: 0 };
    const counts = [...active.pageModes.values()];
    return {
      bw: counts.filter((m) => m === 'bw').length,
      colour: counts.filter((m) => m === 'colour').length,
      skip: counts.filter((m) => m === 'skip').length,
    };
  }, [active?.pageModes]);

  const phoneValid = /^[6-9]\d{9}$/.test(customerPhone);
  /**
   * Client-side estimate fallback — used ONLY when the server quote has
   * no total (e.g. the shop has no price rules configured). Same per-page
   * rates as the shop home; the server quote is authoritative whenever
   * it returns a total, and the placed order's server total replaces
   * this estimate at checkout. Labelled "Estimated" in the UI until then.
   */
  const fallbackTotalPaise = useMemo(() => {
    if (!rateCard || readyFiles.length === 0) return null;
    let total = 0;
    for (const f of readyFiles) {
      const modes = [...f.pageModes.values()];
      const bw = modes.filter((m) => m === 'bw').length;
      const colour = modes.filter((m) => m === 'colour').length;
      total += (bw * rateCard.bwPerPagePaise + colour * rateCard.colorPerPagePaise) * f.copies;
    }
    return total;
  }, [rateCard, readyFiles]);
  const totalPaise = placed?.totalPaise ?? quote?.totalPaise ?? fallbackTotalPaise;
  const canPlace = readyFiles.length > 0 && phoneValid && !placing && totalPaise != null;

  /* ── Payment screen (after order placed) ───────────────────────────── */

  if (placed) {
    return <PaymentWaitingScreen
      placed={placed}
      shopName={shopName}
      upiId={upiId}
      upiPayeeName={upiPayeeName}
      paymentMode={paymentMode}
      utr={utr}
      setUtr={setUtr}
      onSubmitUtr={submitUtr}
      onCounterPayment={counterPayment}
      paymentSheetOpen={paymentSheetOpen}
      setPaymentSheetOpen={setPaymentSheetOpen}
      elapsed={payElapsed}
      error={error}
    />;
  }

  /* ── Main flow (Files → Options → Pay) ─────────────────────────────── */

  return (
    <section className="flex flex-col gap-4" aria-labelledby="flow-heading">
      <h2 id="flow-heading" className="sr-only">Order flow</h2>

      <Stepper steps={3} current={step} />

      {/* Visible step headings (spec screens 3, 4, 6) — the Stepper bars
          alone carry no step name for sighted users. */}
      {step === 0 && <StepHeading title="Your files" sub="Step 1 of 3" />}
      {step === 1 && (
        <StepHeading
          title="How should we print it?"
          sub={`Step 2 of 3${active ? `, ${active.name}` : ''}`}
        />
      )}
      {step === 2 && <StepHeading title="Review order" sub="Step 3 of 3" />}

      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius-default)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/5 p-3 text-sm text-[var(--color-error)]"
        >
          {error}
        </div>
      )}

      {/* ── Restore offer (from IndexedDB draft recovery) ── */}
      {draftRecovery.restoreOffer && files.length === 0 && !placed && (
        <DraftRestoreCard
          savedAt={draftRecovery.restoreOffer.updatedAt}
          fileCount={draftRecovery.restoreOffer.files.length}
          onAccept={() => {
            // The existing localStorage draft restoration handles the actual
            // restore (it loads files + draft + customer details). The
            // IndexedDB offer is just the prompt. Decline = dismiss.
            // If IndexedDB has a draft but localStorage doesn't (e.g. cleared),
            // we accept by re-using the orderToken from the IndexedDB draft.
            const offer = draftRecovery.restoreOffer;
            if (offer?.orderId && offer?.orderToken) {
              setDraft({ orderId: offer.orderId, orderToken: offer.orderToken });
              setCustomerName(offer.customer.name ?? '');
              setCustomerPhone(offer.customer.phone ?? '');
              setNote(offer.customer.note ?? '');
            }
            draftRecovery.dismissRestore();
          }}
          onDecline={() => draftRecovery.dismissRestore()}
        />
      )}

      {/* ── Step 1: Files ── */}
      {step === 0 && (
        <div className="flex flex-col gap-4">
          <UploadDropzone
            onFiles={onPick}
            accept={DROPZONE_ACCEPT}
            acceptedFormatsLabel="PDF, JPG, PNG, WebP, HEIC, DOCX, DOC, PPTX, XLSX · up to 50 MB per file"
          />
          {files.length > 0 && (
            <FileList
              files={files}
              activeIdx={activeIdx}
              onSelect={(i) => setActiveIdx(i)}
              onRemove={(fileId) => {
                setFiles((fs) => fs.filter((f) => f.fileId !== fileId));
                if (activeIdx >= files.length - 1) setActiveIdx(Math.max(0, activeIdx - 1));
              }}
              onRetry={(fileId) => {
                // Re-poll a failed/stuck file: back to 'converting' so the
                // status poll picks it up again.
                setFiles((fs) => fs.map((f) => (f.fileId === fileId ? { ...f, status: 'converting', failReason: null } : f)));
              }}
            />
          )}
        </div>
      )}

      {/* ── Step 2: Options ── */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          {active ? (
            <ActiveFileSummary name={active.name} pageCount={active.pageCount ?? 0} totals={activeTotals} />
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Upload a file to choose options.</p>
          )}

          {active?.status === 'ready' && (active.pageCount ?? 0) > 0 && (
            <>
              {/* Color-suggestion prompt — shown ABOVE the preset cards when
                  the server detected colour pages AND the customer hasn't
                  dismissed it for this file. Accepting applies the suggestion
                  (colour pages → 'colour', rest → 'bw'); Customize opens the
                  Mix page strip for manual selection. */}
              {active.suggestion &&
                active.suggestion.some((s) => s.isColor) &&
                !dismissedSuggestions.has(active.fileId) &&
                active.preset !== 'mix' && (
                  <ColorSuggestionPrompt
                    suggestion={active.suggestion}
                    filename={active.name}
                    onAccept={() => {
                      applySuggestion(active.fileId);
                      // Apply the suggestion without opening the Mix page strip.
                      // Track the accept path separately from the page-strip accept.
                      track(ANALYTICS_EVENTS.colourPagesChanged, {
                        shop_slug: shopSlug,
                        colour_page_count: active.suggestion?.filter((s) => s.isColor).length ?? 0,
                        source: 'suggestion_prompt_accepted',
                      });
                      setDismissedSuggestions((prev) => new Set(prev).add(active.fileId));
                    }}
                    onCustomize={() => {
                      // Dismiss the prompt + open the Mix page strip.
                      setDismissedSuggestions((prev) => new Set(prev).add(active.fileId));
                      pickPreset(active.fileId, 'mix');
                    }}
                  />
                )}

              <p className="text-sm font-medium text-[var(--color-ink)]">Choose a preset:</p>
              <div className="grid grid-cols-2 gap-3">
                {PRESETS.map((preset) => {
                  const selected = active.preset === preset.id;
                  const price = rateCard
                    ? estimatePresetPrice(active, preset.id, rateCard.bwPerPagePaise, rateCard.colorPerPagePaise)
                    : null;
                  return (
                    <PresetCard
                      key={preset.id}
                      name={preset.name}
                      description={preset.description}
                      pricePaise={price}
                      selected={selected}
                      onSelect={() => pickPreset(active.fileId, preset.id)}
                    />
                  );
                })}
              </div>

              {/* "More options" — one row, opens a BottomSheet. */}
              <button
                type="button"
                onClick={() => {
                  setMoreOptionsOpen(true);
                  track(ANALYTICS_EVENTS.moreOptionsOpened, { shop_slug: shopSlug });
                }}
                className="touch-target flex items-center justify-between w-full min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors"
              >
                <span>More options</span>
                <ChevronRight className="size-4 text-[var(--color-muted)]" aria-hidden="true" />
              </button>

              {/* Color-suggestion prompt (in-Mix variant) — shown ABOVE the
                  page strip when Mix is selected and the customer hasn't
                  dismissed the suggestion for this file. This is the same
                  prompt as above, but rendered in the Mix context so the
                  Customize action collapses to just dismissing (the page
                  strip is already open). */}
              {active.preset === 'mix' &&
                active.suggestion &&
                active.suggestion.some((s) => s.isColor) &&
                !dismissedSuggestions.has(active.fileId) && (
                  <ColorSuggestionPrompt
                    suggestion={active.suggestion}
                    filename={active.name}
                    onAccept={() => {
                      applySuggestion(active.fileId);
                      setDismissedSuggestions((prev) => new Set(prev).add(active.fileId));
                    }}
                    onCustomize={() => {
                      setDismissedSuggestions((prev) => new Set(prev).add(active.fileId));
                    }}
                  />
                )}

              {/* Page strip — only when "Mix" is selected. */}
              {active.preset === 'mix' && (
                <PageStrip
                  pages={Array.from({ length: active.pageCount ?? 0 }, (_, i) => ({
                    pageNumber: i + 1,
                    mode: active.pageModes.get(i + 1) ?? 'bw',
                  }))}
                  onToggle={(page) => toggleMode(active.fileId, page)}
                  onBulkSet={(mode) => setAllModes(active.fileId, mode)}
                  suggestionAvailable={!!active.suggestion && active.suggestion.some((s) => s.isColor)}
                  onUseSuggestion={() => applySuggestion(active.fileId)}
                  moneyNudge={
                    active.sides === 'SINGLE' && (active.pageCount ?? 0) > 1 && rateCard
                      ? `Double-sided saves about ${formatRupees(Math.ceil((active.pageCount ?? 0) / 2) * rateCard.bwPerPagePaise)}.`
                      : undefined
                  }
                />
              )}
            </>
          )}

          {files.length > 1 && (
            <FileList
              files={files}
              activeIdx={activeIdx}
              onSelect={(i) => setActiveIdx(i)}
              onRemove={(fileId) => {
                setFiles((fs) => fs.filter((f) => f.fileId !== fileId));
                if (activeIdx >= files.length - 1) setActiveIdx(Math.max(0, activeIdx - 1));
              }}
              onRetry={(fileId) => {
                setFiles((fs) => fs.map((f) => (f.fileId === fileId ? { ...f, status: 'converting', failReason: null } : f)));
              }}
              compact
            />
          )}
        </div>
      )}

      {/* ── Step 3: Pay ── */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          {/* File list with mode summary (collapsed). */}
          <section
            className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4"
            aria-label="Files in this order"
          >
            <h3 className="text-base font-semibold text-[var(--color-ink)] mb-2">Your files</h3>
            <ul className="flex flex-col gap-2">
              {readyFiles.map((f) => {
                const counts = [...f.pageModes.values()];
                const bw = counts.filter((m) => m === 'bw').length;
                const colour = counts.filter((m) => m === 'colour').length;
                const sidesLabel = f.sides === 'DOUBLE' ? 'Double-sided' : 'One-sided';
                return (
                  <li key={f.fileId} className="flex items-start gap-3 py-1">
                    <FileText className="size-4 shrink-0 mt-1 text-[var(--color-muted)]" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-ink)] truncate">{f.name}</p>
                      <p className="text-xs text-[var(--color-muted)] tnum">
                        {bw} B&W · {colour} Colour · {sidesLabel} · {f.copies} cop{f.copies === 1 ? 'y' : 'ies'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Price breakdown (collapsed by default). */}
          {quote && quote.totalPaise != null && (
            <PriceBreakdown
              totalPaise={quote.totalPaise}
              lines={quoteLinesFromQuote(quote)}
            />
          )}
          <p className="text-xs text-[var(--color-muted)]">
            Estimated total — the final amount is confirmed when you place the order.
          </p>

          {pricesChanged !== null && (
            <div
              role="alert"
              className="rounded-[var(--radius-default)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-ink)]"
            >
              The total is now {formatRupees(pricesChanged)}. Confirm again to place the order.
            </div>
          )}

          {/* Contact details. */}
          <PhoneField
            id="customer-phone"
            value={customerPhone}
            onChange={setCustomerPhone}
          />
          <TextField
            id="customer-name"
            label="Name"
            value={customerName}
            onChange={setCustomerName}
            placeholder="Optional"
            required={false}
            autoComplete="name"
            maxLength={120}
          />
          <TextField
            id="customer-note"
            label="Note to shop"
            value={note}
            onChange={setNote}
            placeholder="Optional"
            required={false}
            maxLength={300}
          />
        </div>
      )}

      {/* ── StickyActionBar with total + primary CTA ──
          Total is "Estimated" until checkout locks it (placed orders
          show "Confirmed" on the waiting screen instead). Never both. */}
      {files.length > 0 && (
        <StickyActionBar
          caption="Estimated total"
          total={
            quoting ? (
              <span className="text-[var(--color-muted)]">Updating…</span>
            ) : totalPaise != null ? (
              formatRupees(totalPaise)
            ) : (
              '—'
            )
          }
          action={
            step === 0 ? (
              <PrimaryButton
                onClick={() => setStep(1)}
                disabled={readyFiles.length === 0}
              >
                Continue
              </PrimaryButton>
            ) : step === 1 ? (
            <PrimaryButton
              onClick={() => setStep(2)}
              disabled={quoting || totalPaise == null}
            >
              Continue
            </PrimaryButton>
          ) : (
            <PrimaryButton
              onClick={place}
              disabled={!canPlace}
              loading={placing}
            >
              {placing ? 'Placing…' : totalPaise != null ? `Pay ${formatRupees(totalPaise)}` : 'Pay'}
            </PrimaryButton>
          )
          }
        />
      )}

      {/* ── More options bottom sheet ── */}
      {active && (
        <BottomSheet
          open={moreOptionsOpen}
          onClose={() => setMoreOptionsOpen(false)}
          title={`Options · ${active.name}`}
        >
          <MoreOptionsContent
            file={active}
            onPatch={(patch) => {
              patchFile(active.fileId, patch);
            }}
          />
        </BottomSheet>
      )}
    </section>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

/** Visible step heading + "Step N of 3" subtitle (spec screens 3, 4, 6). */
function StepHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-2xl font-extrabold tracking-tight text-[var(--color-ink)]">{title}</h2>
      <p className="mt-0.5 text-sm text-[var(--color-muted)]">{sub}</p>
    </div>
  );
}

/** Collapsed list of files (used in step 1 and the bottom of step 2). */
function FileList({
  files,
  activeIdx,
  onSelect,
  onRemove,
  onRetry,
  compact = false,
}: {
  files: FlowFile[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onRemove: (fileId: string) => void;
  onRetry?: (fileId: string) => void;
  compact?: boolean;
}) {
  return (
    <ul className={`flex flex-col gap-2 ${compact ? 'mt-2' : ''}`}>
      {files.map((f, i) => {
        const cardFile = {
          name: f.name,
          size: f.sizeBytes,
          pageCount: f.pageCount ?? undefined,
          status: f.status as FileCardStatus,
          progress: f.progress,
          error: f.failReason ?? undefined,
        };
        return (
          <li key={f.fileId}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              className={`block w-full text-left rounded-[var(--radius-default)] border transition-colors ${
                i === activeIdx && !compact
                  ? 'border-[var(--color-cyan-ink)]'
                  : 'border-transparent'
              } focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-cyan-ink)]`}
              aria-pressed={i === activeIdx}
              aria-label={`Select file ${f.name}`}
            >
              <FileCard
                file={cardFile}
                onRemove={() => onRemove(f.fileId)}
                onRetry={onRetry ? () => onRetry(f.fileId) : undefined}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Active file summary at the top of step 2 — name + page count + totals. */
function ActiveFileSummary({
  name,
  pageCount,
  totals,
}: {
  name: string;
  pageCount: number;
  totals: { bw: number; colour: number; skip: number };
}) {
  return (
    <div className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4">
      <p className="text-sm font-medium text-[var(--color-ink)] truncate">{name}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)] tnum">
        {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        {pageCount > 0 && (
          <> · {totals.bw} B&W · {totals.colour} Colour{totals.skip > 0 ? ` · ${totals.skip} skip` : ''}</>
        )}
      </p>
    </div>
  );
}

/**
 * DraftRestoreCard — the "Restore your previous order?" prompt shown when
 * useDraftRecovery surfaces a draft < 2h old from IndexedDB. Accept
 * re-uses the orderToken + customer details; Decline dismisses the prompt
 * (the draft remains in IndexedDB and will be overwritten on the next
 * save).
 *
 * The card is intentionally compact: one heading line, one sub-line with
 * the file count + relative save time, two buttons. The customer should
 * be able to decide in under a second.
 */
function DraftRestoreCard({
  savedAt,
  fileCount,
  onAccept,
  onDecline,
}: {
  savedAt: number;
  fileCount: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // Relative-time label: "saved 3 min ago" / "saved just now".
  const elapsedMs = Date.now() - savedAt;
  const mins = Math.floor(elapsedMs / 60_000);
  const rel =
    mins < 1 ? 'just now' :
    mins < 60 ? `${mins} min ago` :
    `${Math.floor(mins / 60)} hr ago`;
  return (
    <section
      className="rounded-[var(--radius-default)] border border-[var(--color-cyan-ink)]/40 bg-[var(--color-cyan-ink)]/5 p-4"
      aria-labelledby="draft-restore-heading"
      role="note"
    >
      <div className="flex items-start gap-3">
        <RotateCcw className="size-5 shrink-0 mt-0.5 text-[var(--color-cyan-ink)]" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p id="draft-restore-heading" className="text-sm font-medium text-[var(--color-ink)]">
            Resume your previous order?
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {fileCount} {fileCount === 1 ? 'file' : 'files'} · saved {rel}
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onAccept}
              className="touch-target inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] text-white font-medium text-sm hover:bg-[var(--color-cyan-ink)]/90 active:bg-[var(--color-cyan-ink)]/80 transition-colors"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onDecline}
              className="touch-target inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-border-ink)] font-medium text-sm hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors"
            >
              Start fresh
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** One preset card — name + description + estimated price. */
function PresetCard({
  name,
  description,
  pricePaise,
  selected,
  onSelect,
}: {
  name: string;
  description: string;
  pricePaise: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'touch-target flex flex-col items-start gap-1 p-4 min-h-[120px]',
        'rounded-[var(--radius-default)] border-2 text-left',
        'transition-colors duration-150',
        selected
          ? 'border-[var(--color-cyan-ink)] bg-[var(--color-cyan-ink)]/5'
          : 'border-[var(--color-border-ink)] bg-[var(--color-surface)] hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)]',
      ].join(' ')}
    >
      <span className="text-base font-semibold text-[var(--color-ink)]">{name}</span>
      <span className="text-xs text-[var(--color-muted)] flex-1">{description}</span>
      {pricePaise != null && (
        <span className="text-sm font-semibold text-[var(--color-ink)] tnum">
          {formatRupees(pricePaise)}
        </span>
      )}
    </button>
  );
}

/** The contents of the "More options" bottom sheet. */
function MoreOptionsContent({
  file,
  onPatch,
}: {
  file: FlowFile;
  onPatch: (patch: Partial<FlowFile>) => void;
}) {
  return (
    <div className="flex flex-col gap-5 pt-2">
      <NumberStepper
        label="Copies"
        value={file.copies}
        min={1}
        max={100}
        onChange={(copies) => onPatch({ copies })}
      />

      <ChipGroup label="Paper size">
        {PAPER_SIZES.map((size) => (
          <Chip
            key={size}
            label={size}
            selected={file.paperSize === size}
            onClick={() => onPatch({ paperSize: size })}
          />
        ))}
      </ChipGroup>

      <div>
        <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Sides</p>
        <SegmentedControl
          ariaLabel="Page sides"
          value={file.sides}
          onChange={(v) => onPatch({ sides: v as 'SINGLE' | 'DOUBLE' })}
          options={[
            { value: 'SINGLE', label: 'One-sided' },
            { value: 'DOUBLE', label: 'Double-sided' },
          ]}
        />
      </div>

      <ChipGroup label="Pages per sheet">
        {PAGES_PER_SHEET_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={String(file.pagesPerSheet) === opt.value}
            onClick={() => onPatch({ pagesPerSheet: parseInt(opt.value, 10) as 1 | 2 | 4 | 6 | 9 })}
          />
        ))}
      </ChipGroup>

      <SegmentedControl
        ariaLabel="Orientation"
        value="AUTO"
        onChange={() => undefined}
        options={[
          { value: 'AUTO', label: 'Auto' },
          { value: 'PORTRAIT', label: 'Portrait' },
          { value: 'LANDSCAPE', label: 'Landscape' },
        ]}
      />

      <TextField
        id="note-to-shop"
        label="Note to shop"
        value={file.paperType === 'PLAIN' ? '' : file.paperType}
        onChange={(v) => onPatch({ paperType: v || 'PLAIN' })}
        placeholder="Optional"
        required={false}
        maxLength={120}
      />
    </div>
  );
}

/** Convert a Quote into the PriceLine[] the PriceBreakdown expects. */
function quoteLinesFromQuote(q: Quote): PriceLine[] {
  const lines: PriceLine[] = [];
  for (const l of q.lines) {
    const label = `${l.pages} ${l.colorMode === 'COLOR' ? 'Colour' : 'B&W'} × ${l.copies}`;
    const amount = l.perPagePaise != null ? l.perPagePaise * l.pages * l.copies : 0;
    lines.push({ label, amountPaise: amount });
  }
  if (q.urgentPaise > 0) {
    lines.push({ label: 'Urgent surcharge', amountPaise: q.urgentPaise });
  }
  if (q.addonsPaise > 0) {
    lines.push({ label: 'Add-ons', amountPaise: q.addonsPaise });
  }
  return lines;
}

/* ── Payment waiting screen ──────────────────────────────────────────── */

function PaymentWaitingScreen({
  placed,
  shopName,
  upiId,
  upiPayeeName,
  paymentMode,
  utr,
  setUtr,
  onSubmitUtr,
  onCounterPayment,
  paymentSheetOpen,
  setPaymentSheetOpen,
  elapsed,
  error,
}: {
  placed: PlacedOrder;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  utr: string;
  setUtr: (v: string) => void;
  onSubmitUtr: () => void;
  onCounterPayment: () => void;
  paymentSheetOpen: boolean;
  setPaymentSheetOpen: (open: boolean) => void;
  elapsed: number;
  error: string | null;
}) {
  // Build the real UPI deep-link from the shop's VPA + the order amount.
  // This is the P0-1 fix from the audit — no more `pa=TODO` placeholder.
  const upiUri = useMemo(() => {
    try {
      return buildUpiIntentUrl({
        payeeUpi: upiId,
        payeeName: upiPayeeName,
        amountPaise: placed.totalPaise,
        orderShortId: placed.orderNumber,
      });
    } catch {
      return null;
    }
  }, [upiId, upiPayeeName, placed.totalPaise, placed.orderNumber]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timerDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const launchUpiApp = useCallback(() => {
    if (!upiUri) return;
    // Analytics: payment_app_tapped — the customer tapped the primary
    // "Pay by UPI" button (which launches the OS UPI app chooser).
    track(ANALYTICS_EVENTS.paymentAppTapped, {
      app_id: 'upi_intent',
      amount_paise_range: amountPaiseRange(placed.totalPaise),
    });
    // Trigger the platform UPI intent picker. On Android this opens the
    // OS UPI app chooser; on desktop it falls through silently.
    // Mark the launch FIRST: the return path restores from the durable
    // pending order + reopens the UTR sheet on visibilitychange (the
    // setTimeout below fires while the tab is hidden and is only a
    // fallback for a fast same-tab return).
    markUpiLaunched();
    window.location.href = upiUri;
    // After the customer returns, open the UTR sheet so they can paste.
    setTimeout(() => setPaymentSheetOpen(true), 1500);
  }, [upiUri, setPaymentSheetOpen, placed.totalPaise]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="waiting-heading">
      <h2 id="waiting-heading" className="text-lg font-semibold text-[var(--color-ink)]">
        Waiting for the shop to confirm your payment
      </h2>

      {/* Elapsed timer — gives the customer a sense of time without anxiety. */}
      <div className="flex flex-col items-center gap-2 py-4">
        <Clock className="size-6 text-[var(--color-muted)]" aria-hidden="true" />
        <p className="text-2xl font-bold tnum text-[var(--color-ink)]" aria-live="polite">
          {timerDisplay}
        </p>
        <p className="text-xs text-[var(--color-muted)] tnum">
          Order #{placed.orderNumber} · Pickup code {placed.pickupCode}
        </p>
      </div>

      {/* Total to pay + UPI deep-link (the real one, not a placeholder). */}
      <div className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4">
        <p className="text-xs text-[var(--color-muted)]">Confirmed total to pay</p>
        <p className="text-2xl font-bold tnum text-[var(--color-ink)]">{formatRupees(placed.totalPaise)}</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Pay {shopName} directly by UPI. The shop confirms — the app never marks it paid by itself.
        </p>

        {paymentMode !== 'PRINT_THEN_PAY' && upiUri && (
          <PrimaryButton
            onClick={launchUpiApp}
            className="mt-3 w-full"
            aria-label={`Pay ${formatRupees(placed.totalPaise)} by UPI`}
          >
            Pay {formatRupees(placed.totalPaise)} by UPI
          </PrimaryButton>
        )}
      </div>

      {/* Reassurance card — never claims payment is verified. */}
      <div className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4">
        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          The shop will verify your payment. This usually takes 1–2 minutes.
          If it takes longer, call the shop or enter your UTR again below.
        </p>
      </div>

      {/* UTR submission — the customer pastes their 12-digit reference. */}
      <div className="rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4 flex flex-col gap-3">
        <p className="text-sm font-medium text-[var(--color-ink)]">Did you pay?</p>
        <UTRInput value={utr} onChange={setUtr} onSubmit={onSubmitUtr} error={error ?? undefined} />
        <PrimaryButton
          onClick={onSubmitUtr}
          disabled={utr.replace(/\D/g, '').length !== 12}
        >
          Submit payment reference
        </PrimaryButton>
      </div>

      {/* Secondary actions. */}
      <div className="flex flex-col gap-2">
        <SecondaryButton onClick={() => setPaymentSheetOpen(true)} className="w-full">
          Open UPI app again
        </SecondaryButton>
        <TextButton onClick={onCounterPayment} className="w-full">
          Pay at the counter instead
        </TextButton>
      </div>

      {/* Payment sheet (mobile only — UPI app buttons + copy UPI ID). */}
      <BottomSheet
        open={paymentSheetOpen}
        onClose={() => setPaymentSheetOpen(false)}
        title="Pay with UPI"
      >
        {upiUri ? (
          <PaymentSheet
            upiId={upiId}
            upiUri={upiUri}
            onAppTap={(appId) => {
              // Most Android UPI apps accept the generic upi:// intent and
              // route through the OS picker. We launch the same URI for every
              // app button — the OS handles the routing. The brand dot is
              // decorative only; the app NAME is the accessible label.
              // Analytics: payment_app_tapped — which UPI app brand the
              // customer tapped in the sheet.
              track(ANALYTICS_EVENTS.paymentAppTapped, {
                app_id: appId,
                amount_paise_range: amountPaiseRange(placed.totalPaise),
              });
              markUpiLaunched();
              window.location.href = upiUri;
              setTimeout(() => setPaymentSheetOpen(false), 800);
            }}
            isDesktop={false}
          />
        ) : (
          <div className="p-4 text-sm text-[var(--color-muted)]">
            This shop has not configured a UPI ID. Pay at the counter.
          </div>
        )}
      </BottomSheet>
    </section>
  );
}

/* ── Re-exports ──────────────────────────────────────────────────────── */

// Keep the legacy file's default-export shape so any accidental import of
// the old name still resolves (the file is renamed to .legacy.tsx, but a
// stray import would otherwise break the build).
export default CustomerOrderFlowV2;
