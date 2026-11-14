'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Progress } from '@/components/ui/progress';
import { useApiClient } from '@/components/portal/use-api-client';
import { PdfPreview } from '@/components/portal/pdf-preview';
import { PageRangeBuilder } from '@/components/portal/page-range-builder';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { PageSkeleton } from '@/components/shared/loading-skeleton';
import { OrderStatusBadge, StatusIndicator, type StatusVariant } from '@/components/shared/status-indicator';
import { formatINRFromPaise } from '@platform/utils';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import type {
  ShopPricingConfig, ColorMode, PaperSize, OrderStatus, FileStatus,
} from '@platform/core/domain';
import {
  UploadCloud, FileText, Trash2, Loader2, AlertCircle, ArrowLeft, ArrowRight,
  CheckCircle2, RefreshCw, CreditCard, QrCode, ShieldCheck, Info,
  Home, Download, XCircle, Smartphone, Clock,
} from 'lucide-react';

// Also need Label + ToggleGroup already imported above

// ──────────────────────────── API response shapes ────────────────────────────

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  paymentProvider: string;
  pricingConfig: ShopPricingConfig;
  timezone: string;
  privacy: {
    filesPrivateByDefault: boolean;
    downloadUrlsExpireSeconds: number;
    autoDeleteAfterCollectSeconds: number;
    autoDeleteCronHours: number;
  };
}

interface StatusFile {
  id: string;
  filename: string;
  status: FileStatus;
  copies: number;
  colorMode: ColorMode;
  duplex: boolean;
  pageCount?: number | null;
  pageCountSource?: string;
  processingError?: string | null;
  pricePaise?: number;
  printedAt: string | null;
}

interface OrderStatusResponse {
  orderId: string;
  customerToken: string;
  tokenNumber: string | null;
  status: OrderStatus;
  totalAmountPaise: number;
  totalFormatted: string;
  currency: string;
  paidAt: string | null;
  paymentTxnId: string | null;
  paymentUtr: string | null;
  files: StatusFile[];
  updatedAt: string;
}

interface UploadUrlResponse {
  fileId: string;
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

interface ConfirmFileResponse {
  fileId: string;
  pageCount: number | null;
  pageCountSource: 'auto_extracted' | 'placeholder';
  pageCountEstimated: boolean;
  status: 'pending' | 'needs_review';
  pricePaise: number;
  processingError: string | null;
  orderTotalPaise: number;
  needsReview: boolean;
}

interface PatchFileResponse {
  file: {
    id: string;
    pageCount: number | null;
    pageCountSource: string;
    copies: number;
    colorMode: ColorMode;
    paperSize: PaperSize;
    duplex: boolean;
    pricePaise: number;
    status: string;
    processingError: string | null;
  };
  orderTotalPaise: number;
  lineItems: Array<{ label: string; quantity: number; unitPaise: number; subtotalPaise: number }>;
}

interface CheckoutResponse {
  orderId: string;
  merchantOrderId: string;
  amountPaise: number;
  currency: string;
  provider: string;
  checkoutUrl: string | null;
  upiUri: string | null;
  qrPayload: string | null;
  expiresAt: string | null;
}

interface SimulateResponse {
  sent: { txnId: string; outcome: string };
  processed: { statusCode: number; summary: string; applied: boolean; orderId: string };
  note: string;
}

// ──────────────────────────── Local state shape ────────────────────────────

type Step = 'upload' | 'configure' | 'checkout' | 'pay' | 'track';

interface LocalFile {
  fileId: string;
  filename: string;
  pageCount: number;
  pageCountSource: string;
  processingError: string | null;
  size: number;
  copies: number;
  colorMode: ColorMode;
  duplex: boolean;
  paperSize: PaperSize;
  pageRange: string;
  pricePaise: number;
  status: 'uploading' | 'uploaded' | 'needs_review' | 'failed';
  uploadProgress: number;
  uploadError: string | null;
  dirty: boolean; // local edits not yet saved to server
  patching: boolean;
  /** The raw File object for client-side preview (only available before page refresh) */
  rawFile?: File | null;
  /** Pages selected for printing (1-indexed). Null = all pages. */
  selectedPages?: number[] | null;
}

const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: 'upload', label: 'Upload' },
  { key: 'configure', label: 'Configure' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'pay', label: 'Pay' },
  { key: 'track', label: 'Track' },
];

const STATUS_AFTER_PAYMENT: OrderStatus[] = ['paid', 'printing', 'ready', 'collected', 'cancelled', 'refunded'];

// ──────────────────────────── Page ────────────────────────────

export default function OrderFlowPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const api = useApiClient();
  // Read shopSlug from URL query param (avoids useSearchParams() which
  // requires a Suspense boundary during next build).
  const [shopSlug, setShopSlug] = useState<string | null>(null);
  // ── SEC-001 fix: per-order access token ──
  // The customer-facing order routes (/api/v1/orders/:id/*) now require an
  // X-Order-Token header (or ?t= query) that constant-time-matches the
  // order's customerToken. The token is issued at order-creation time
  // (POST /api/v1/shops/:slug/orders returns it) + the shop page redirects
  // here with ?t=<token>. We store it in sessionStorage (per-tab, survives
  // refresh, not permanent) keyed by orderId so multiple orders in
  // different tabs don't conflict.
  const [orderToken, setOrderToken] = useState<string | null>(null);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setShopSlug(search.get('shop'));
    // Read the order-access token from ?t= (preferred) OR sessionStorage
    // (for refreshes — the URL's ?t= is stripped after first load so it
    // doesn't leak via referrer/history). On first load with ?t=, persist
    // to sessionStorage; on subsequent loads, read from sessionStorage.
    const tokenFromUrl = search.get('t');
    if (tokenFromUrl) {
      setOrderToken(tokenFromUrl);
      try { sessionStorage.setItem(`order-token:${orderId}`, tokenFromUrl); } catch { /* ignore */ }
      // Strip ?t= from the URL so it doesn't leak via the browser history
      // or referrer header (the token stays in sessionStorage for refreshes).
      try {
        const cleanUrl = window.location.pathname + (search.toString().replace(/(^|&)t=[^&]*/, '') ? `?${search.toString().replace(/(^|&)t=[^&]*/, '')}` : '');
        window.history.replaceState(null, '', cleanUrl);
      } catch { /* ignore */ }
    } else {
      try {
        const stored = sessionStorage.getItem(`order-token:${orderId}`);
        if (stored) setOrderToken(stored);
      } catch { /* ignore */ }
    }
  }, [orderId]);
  // Headers to attach to every /api/v1/orders/:id/* request. Empty when no
  // token is known (the routes will return 403 with a clear message).
  const orderAuthHeaders = useMemo<Record<string, string> | undefined>(
    () => (orderToken ? { 'X-Order-Token': orderToken } : undefined),
    [orderToken],
  );

  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workstream-2 fix: track in-flight XHRs per file so we can cancel
  // an upload mid-flight (xhr.abort()). Without this the only way to stop
  // an upload was to wait for it to finish (or fail with a network error).
  // Keyed by the placeholderId used in `handleFiles` (so the cancel can
  // be wired to the FileCard before the file is confirmed on the server).
  const uploadXhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [shopkeeperQrUrl, setShopkeeperQrUrl] = useState<string | null>(null);

  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);

  const [orderTotalPaise, setOrderTotalPaise] = useState(0);
  const [serverCalculated, setServerCalculated] = useState(false);

  // Track whether initial load has happened (used to decide whether to jump to 'track').
  const initialisedRef = useRef(false);

  // ─── Initial load ───
  const loadOrder = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setFatalError(null);
    }
    const r = await api.request<{ data?: OrderStatusResponse; error?: { message?: string } }>('GET', `/api/v1/orders/${orderId}/status`, { headers: orderAuthHeaders });
    if (!opts?.silent) setLoading(false);
    if (r.status >= 400 || !r.data?.data) {
      setFatalError(r.data?.error?.message ?? 'Order not found.');
      return;
    }
    const data = r.data.data;
    setOrder(data);
    setOrderTotalPaise(data.totalAmountPaise);
    setServerCalculated(true);

    // Hydrate local file state from the server. The status endpoint may
    // omit pageCount/pageCountSource/processingError/pricePaise on legacy
    // deployments — fall back to existing local values, then to safe defaults
    // ('placeholder' / 0 / null). needs_review files keep that status so the
    // Configure / Checkout UIs can prompt the customer for a page count.
    setFiles((prev) => {
      const byId = new Map(prev.map((f) => [f.fileId, f]));
      const next: LocalFile[] = data.files.map((f) => {
        const isReview = f.status === 'needs_review' || f.pageCountSource === 'placeholder';
        const existing = byId.get(f.id);
        if (existing) {
          return {
            ...existing,
            filename: f.filename,
            pageCount: f.pageCount ?? existing.pageCount ?? 0,
            pageCountSource: f.pageCountSource ?? existing.pageCountSource ?? 'placeholder',
            processingError: f.processingError ?? existing.processingError ?? null,
            copies: f.copies,
            colorMode: f.colorMode,
            duplex: f.duplex,
            pricePaise: f.pricePaise ?? existing.pricePaise ?? 0,
            status: isReview ? 'needs_review' : 'uploaded',
          };
        }
        return {
          fileId: f.id,
          filename: f.filename,
          pageCount: f.pageCount ?? 0,
          pageCountSource: f.pageCountSource ?? 'placeholder',
          processingError: f.processingError ?? null,
          size: 0,
          copies: f.copies,
          colorMode: f.colorMode,
          duplex: f.duplex,
          paperSize: 'a4' as PaperSize,
          pageRange: '',
          pricePaise: f.pricePaise ?? 0,
          status: isReview ? 'needs_review' : 'uploaded',
          uploadProgress: 100,
          uploadError: null,
          dirty: false,
          patching: false,
        };
      });
      return next;
    });

    // On first load, jump to the right step based on order state.
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      if (STATUS_AFTER_PAYMENT.includes(data.status)) {
        setStep('track');
      }
    }
  }, [api, orderId, orderAuthHeaders]);

  // Fetch shop info (if slug in query) so we can do client-side price estimates.
  const loadShop = useCallback(async () => {
    if (!shopSlug) return;
    const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>('GET', `/api/v1/shops/${shopSlug}`);
    if (r.status >= 400 || !r.data?.data) return;
    setShop(r.data.data);
  }, [api, shopSlug]);

  useEffect(() => {
    // Wait for the order-access token to hydrate (from ?t= on first load
    // or sessionStorage on refresh) before fetching the order status. The
    // /api/v1/orders/:id/* routes are token-gated (SEC-001 fix); calling
    // them before the token is known returns a 403 that would briefly
    // flash a "link incomplete" fatal error. loadShop doesn't need the
    // token but it's fine to wait — the token loads in milliseconds.
    if (!api.ready || !orderId || !orderToken) return;
    void (async () => {
      await Promise.all([loadOrder(), loadShop()]);
    })();
  }, [api.ready, orderId, orderToken, loadOrder, loadShop]);

  // ─── Client-side price estimate ───
  const clientEstimate = useCallback((f: LocalFile): number => {
    if (!shop) return f.pricePaise;
    try {
      // Use selectedPages count if available, else pageCount
      const effectivePages = f.selectedPages && f.selectedPages.length > 0
        ? f.selectedPages.length
        : f.pageCount || 1;
      const input: PricingInput = {
        pages: effectivePages,
        copies: f.copies,
        colorMode: f.colorMode,
        paperSize: f.paperSize,
        duplex: f.duplex,
        shopPricingConfig: shop.pricingConfig,
      };
      return priceFile(input).totalPaise;
    } catch {
      return f.pricePaise;
    }
  }, [shop]);

  const orderTotal = useMemo(() => {
    return files.reduce((acc, f) => acc + (f.dirty ? clientEstimate(f) : f.pricePaise), 0);
  }, [files, clientEstimate]);

  // ─── File upload ───
  /** Run the presign → PUT → confirm → auto-PATCH flow for one file.
   *
   * Workstream-2 fixes:
   *  - `placeholderId` is the LocalFile.fileId of the row to update (it
   *    may already exist as a 'failed' row when called from retry).
   *  - The XHR is registered in uploadXhrsRef so cancelUpload() can abort
   *    it; on abort the rejection propagates to the catch and the file is
   *    marked 'failed' with 'Upload cancelled' (NOT 'uploaded').
   *  - On retry the caller passes the preserved rawFile — we always mint
   *    a FRESH presigned URL inside this function (never reuse an expired
   *    one).
   *
   * Declared BEFORE handleFiles/retryUpload so they can reference it
   * without a TDZ / exhaustive-deps warning. */
  const uploadOne = useCallback(async (placeholderId: string, file: File) => {
    if (!orderId) return;
    try {
      // Reset state for retries: clear any prior error + bump to uploading.
      setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? {
        ...f, status: 'uploading', uploadProgress: 0, uploadError: null,
      } : f));

      // 1) Mint a FRESH presigned upload URL (retry never reuses an expired one).
      const uu = await api.request<{ data?: UploadUrlResponse; error?: { message?: string } }>(
        'POST',
        `/api/v1/orders/${orderId}/files/upload-url`,
        { body: { filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }, headers: orderAuthHeaders },
      );
      const u = uu.data?.data;
      if (!u?.uploadUrl) {
        throw new Error(uu.data?.error?.message ?? 'Could not mint upload URL');
      }

      // 2) PUT the bytes to the presigned URL (relative path) with progress.
      // Register the XHR so cancelUpload() can abort it. The abort handler
      // rejects with 'Upload cancelled' — the catch below marks the file
      // 'failed' with that message (NOT 'uploaded').
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrsRef.current.set(placeholderId, xhr);
        xhr.open('PUT', u.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? { ...f, uploadProgress: pct } : f));
          }
        };
        xhr.onload = () => { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`)); };
        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
        xhr.send(file);
      });

      // 3) Confirm via POST /files → server parses page count.
      const cf = await api.request<{ data?: ConfirmFileResponse; error?: { message?: string } }>(
        'POST',
        `/api/v1/orders/${orderId}/files`,
        { body: { fileId: u.fileId, storageKey: u.storageKey, filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }, headers: orderAuthHeaders },
      );
      const c = cf.data?.data;
      if (!c?.fileId) {
        throw new Error(cf.data?.error?.message ?? 'File confirmation failed');
      }

      // 4) Replace placeholder with the real file. The confirm endpoint
      // either priced the file (pageCountSource='auto_extracted',
      // status='pending') OR marked it needs_review (pageCountSource=
      // 'placeholder', pricePaise=0, status='needs_review'). For placeholder
      // files the customer must enter the page count via PATCH before checkout.
      setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? {
        ...f,
        fileId: c.fileId,
        pageCount: c.pageCount ?? 0,
        pageCountSource: c.pageCountSource,
        processingError: c.processingError,
        pricePaise: c.pricePaise,
        status: c.status === 'needs_review' ? 'needs_review' : 'uploaded',
        uploadProgress: 100,
        dirty: false,
      } : f));
      setOrderTotalPaise(c.orderTotalPaise);
      setServerCalculated(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? { ...f, status: 'failed', uploadError: msg } : f));
      // Don't overwrite a global uploadError caused by a CANCEL — the user
      // initiated it intentionally, so a banner saying "Upload cancelled"
      // is just noise. Network/server errors should still surface.
      if (!msg.toLowerCase().includes('cancel')) {
        setUploadError(msg);
      }
    } finally {
      // Always drop the XHR ref so a stale handle can't abort a future upload.
      uploadXhrsRef.current.delete(placeholderId);
    }
  }, [api, orderId, orderAuthHeaders]);

  const handleFiles = useCallback(async (selected: FileList | File[]) => {
    if (!orderId) return;
    setUploadError(null);
    const arr = Array.from(selected);
    for (const file of arr) {
      // Optimistically insert a placeholder.
      const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const placeholder: LocalFile = {
        fileId: placeholderId,
        filename: file.name,
        pageCount: 0,
        pageCountSource: 'placeholder',
        processingError: null,
        size: file.size,
        copies: 1,
        colorMode: 'bw',
        duplex: false,
        paperSize: 'a4',
        pageRange: '',
        pricePaise: 0,
        status: 'uploading',
        uploadProgress: 0,
        uploadError: null,
        dirty: false,
        patching: false,
        rawFile: file,
        selectedPages: null,
      };
      setFiles((prev) => [...prev, placeholder]);

      // uploadOne (declared above) runs presign→PUT→confirm→auto-PATCH.
      await uploadOne(placeholderId, file);
    }
  }, [api, orderId, orderAuthHeaders, uploadOne]);

  /** Cancel an in-flight upload. Aborts the XHR (if any) and lets the
   * uploadOne catch handler mark the file 'failed' with 'Upload cancelled'.
   * Safe to call when there's no in-flight XHR (no-op). */
  const cancelUpload = useCallback((fileId: string) => {
    const xhr = uploadXhrsRef.current.get(fileId);
    if (xhr) {
      try { xhr.abort(); } catch { /* already finished */ }
    }
    // Optimistically mark the file failed so the UI flips immediately —
    // the rejection from xhr.onabort will confirm via uploadOne's catch.
    setFiles((prev) => prev.map((f) => f.fileId === fileId && f.status === 'uploading' ? {
      ...f, status: 'failed', uploadError: 'Upload cancelled',
    } : f));
    uploadXhrsRef.current.delete(fileId);
  }, []);

  /** Retry a failed upload. Uses the failed entry's preserved rawFile +
   * mints a FRESH presigned URL (uploadOne never reuses an expired one).
   * No-op if the file isn't in the failed state or has no rawFile. */
  const retryUpload = useCallback((fileId: string) => {
    // Read the rawFile from the failed entry — it's preserved across the
    // failure so the user can retry without re-selecting the file.
    const failed = files.find((f) => f.fileId === fileId);
    if (!failed || failed.status !== 'failed' || !failed.rawFile) return;
    void uploadOne(fileId, failed.rawFile);
  }, [files, uploadOne]);

  const removeFile = useCallback((fileId: string) => {
    // Workstream-2 fix: explicitly clear the rawFile reference + abort any
    // in-flight XHR so a removed file cannot keep uploading in the
    // background or hold a stale File/Blob in memory (which would also
    // leave the PdfPreview pointing at a stale object URL). The filter
    // below drops the entire LocalFile entry, so rawFile is gone with it —
    // this also covers the "file replacement invalidates the previous
    // preview" case: a removed entry's rawFile is no longer reachable.
    const xhr = uploadXhrsRef.current.get(fileId);
    if (xhr) { try { xhr.abort(); } catch { /* already done */ } }
    uploadXhrsRef.current.delete(fileId);
    setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
    // The API has no delete-file endpoint; the file is left out of the priced set.
  }, []);

  // ─── File settings update ───
  // PATCHing is allowed for ANY priced file AND for needs_review files —
  // the customer sets the page count on a placeholder by PATCHing pageCount,
  // which transitions the server-side source to 'customer_declared' and
  // prices the file (status → 'pending').
  const updateFile = useCallback(async (fileId: string, patch: Partial<LocalFile>) => {
    setFiles((prev) => prev.map((f) => {
      if (f.fileId !== fileId) return f;
      return { ...f, ...patch, dirty: true };
    }));

    // If the file hasn't been confirmed yet, defer PATCH.
    const f = files.find((x) => x.fileId === fileId);
    if (!f || f.status === 'uploading' || f.status === 'failed') return;

    // PATCH the patch to the server. The server recalculates the price.
    setFiles((prev) => prev.map((x) => x.fileId === fileId ? { ...x, patching: true } : x));
    const body: Record<string, unknown> = {};
    if (patch.copies !== undefined) body.copies = patch.copies;
    if (patch.pageCount !== undefined) body.pageCount = patch.pageCount;
    if (patch.colorMode !== undefined) body.colorMode = patch.colorMode;
    if (patch.paperSize !== undefined) body.paperSize = patch.paperSize;
    if (patch.duplex !== undefined) body.duplex = patch.duplex;
    // Convert selectedPages array to pageRange string (e.g., [1,2,3,5,6] → "1-3,5-6")
    if (patch.selectedPages !== undefined) {
      const pages = patch.selectedPages;
      if (pages === null || pages.length === 0) {
        body.pageRange = null;
      } else {
        // Compress to ranges: [1,2,3,5,6] → "1-3,5-6"
        const sorted = [...pages].sort((a, b) => a - b);
        const ranges: string[] = [];
        let start = sorted[0], end = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === end + 1) { end = sorted[i]; }
          else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = end = sorted[i]; }
        }
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        body.pageRange = ranges.join(',');
      }
    } else if (patch.pageRange !== undefined) {
      body.pageRange = patch.pageRange === '' ? null : patch.pageRange;
    }

    const r = await api.request<{ data?: PatchFileResponse; error?: { message?: string } }>(
      'PATCH',
      `/api/v1/orders/${orderId}/files/${fileId}`,
      { body, headers: orderAuthHeaders },
    );
    const d = r.data?.data;
    setFiles((prev) => prev.map((x) => {
      if (x.fileId !== fileId) return x;
      if (!d) return { ...x, patching: false };
      return {
        ...x,
        pageCount: d.file.pageCount ?? 0,
        pageCountSource: d.file.pageCountSource,
        processingError: d.file.processingError,
        copies: d.file.copies,
        colorMode: d.file.colorMode,
        paperSize: d.file.paperSize,
        duplex: d.file.duplex,
        pricePaise: d.file.pricePaise,
        status: d.file.status === 'needs_review' ? 'needs_review' : 'uploaded',
        dirty: false,
        patching: false,
      };
    }));
    if (d) {
      setOrderTotalPaise(d.orderTotalPaise);
      setServerCalculated(true);
    }
  }, [api, orderId, files, orderAuthHeaders]);

  // ─── Checkout ───
  const doCheckout = useCallback(async () => {
    setBusy(true);
    setCheckoutError(null);
    setQrDataUrl(null);
    setShopkeeperQrUrl(null);
    const r = await api.request<{ data?: CheckoutResponse; error?: { message?: string } }>('POST', `/api/v1/orders/${orderId}/checkout`, { headers: orderAuthHeaders });
    setBusy(false);
    if (r.status >= 400 || !r.data?.data) {
      setCheckoutError(r.data?.error?.message ?? 'Checkout failed. Make sure all files have settings applied.');
      return;
    }
    setCheckout(r.data.data);

    // Fetch the shopkeeper's ACTUAL uploaded UPI QR (desktop fallback) from
    // the public endpoint. This is the shopkeeper's own QR image — NOT the
    // generated QR from the upiUri. If the shopkeeper hasn't uploaded a QR,
    // the endpoint returns hasUpiQr=false + we fall back to the generated QR.
    if (shopSlug) {
      const qrR = await api.request<{ data?: { hasUpiQr?: boolean; upiQrUrl?: string; upiId?: string } }>('GET', `/api/v1/shops/${shopSlug}/upi-qr`);
      if (qrR.status === 200 && qrR.data?.data?.hasUpiQr && qrR.data.data.upiQrUrl) {
        setShopkeeperQrUrl(qrR.data.data.upiQrUrl);
      }
    }

    // Also generate a QR from the upiUri as a fallback (for desktop scanning
    // if the shopkeeper hasn't uploaded a custom QR).
    const payload = r.data.data.upiUri ?? r.data.data.qrPayload;
    if (payload) {
      const qr = await api.request<{ data?: { pngDataUrl?: string }; error?: { message?: string } }>('GET', `/api/v1/qr?data=${encodeURIComponent(payload)}`);
      if (qr.data?.data?.pngDataUrl) setQrDataUrl(qr.data.data.pngDataUrl);
    }
    setStep('pay');
  }, [api, orderId, shopSlug, orderAuthHeaders]);

  // ─── "I've paid" — move to track WITHOUT marking payment as verified ───
  // The customer taps "I've paid" after completing the UPI payment in their
  // UPI app. This does NOT verify payment — it just moves the customer to the
  // tracking page. The order remains `awaiting_payment` until the shopkeeper
  // manually verifies receipt (or a verified provider webhook confirms).
  // In dev, the customer can use the "Simulate payment" button on the track
  // page (dev-only, gated behind requireDev()).
  const doPay = useCallback(async () => {
    if (!checkout) return;
    setBusy(true);
    setPaymentError(null);
    // In production: just move to track. The shopkeeper verifies manually.
    // In dev: the dev/phonepe/simulate endpoint is available on the track page
    // for testing the paid → printing → ready flow.
    setSimulated(false);
    setStep('track');
    setBusy(false);
    // Pull the fresh status immediately.
    void loadOrder({ silent: true });
  }, [checkout, loadOrder]);

  // ─── Track refresh ───
  const refreshStatus = useCallback(async () => {
    setTrackError(null);
    await loadOrder({ silent: true });
  }, [loadOrder]);

  // Auto-poll while on the track step until terminal.
  useEffect(() => {
    if (step !== 'track') return;
    const terminal: OrderStatus[] = ['collected', 'cancelled', 'refunded'];
    if (order && terminal.includes(order.status)) return;
    const id = setInterval(() => { void loadOrder({ silent: true }); }, 30_000); // 30s — optimized for 500 shops on free tier
    return () => clearInterval(id);
  }, [step, order, loadOrder]);

  // ─── Receipt download ───
  const downloadReceipt = useCallback(async () => {
    // The receipt is fetched as bytes (NOT navigated to), so the
    // X-Order-Token header can be attached directly (no ?t= query needed).
    // If a direct <a href> navigation were used instead, the URL would need
    // `?t=${orderToken ?? ''}` appended — but here we use fetch + Blob.
    const r = await api.request('GET', `/api/v1/orders/${orderId}/receipt`, { raw: 'bytes', headers: orderAuthHeaders });
    if (!r.raw) return;
    const blob = r.raw instanceof Blob ? r.raw : new Blob([r.raw]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${orderId.slice(0, 8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [api, orderId, orderAuthHeaders]);

  // ─── Render ───
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <span className="hidden text-muted-foreground sm:inline">Order</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-foreground">{orderId.slice(0, 8)}</code>
            {order?.tokenNumber && (
              <Badge variant="secondary" className="ml-1 font-mono tabular-nums">{order.tokenNumber}</Badge>
            )}
            {/* customerToken is a BEARER SECRET — never display it. Only show tokenNumber (the shop-facing sequential token). */}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
          {loading ? (
            <PageSkeleton />
          ) : fatalError ? (
            <Card className="border-danger-border bg-danger-soft">
              <CardContent className="flex flex-col items-start gap-3 p-6">
                <div className="flex items-center gap-2 text-danger">
                  <AlertCircle className="h-5 w-5" />
                  <span className="font-medium">Could not load order</span>
                </div>
                <p className="text-sm text-muted-foreground">{fatalError}</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/">Browse shops</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <PageHeader
                title="Place your print order"
                description="Upload files, configure print settings, and pay the shopkeeper directly."
              />

              {/* Stepper */}
              <OrderStepper current={step} />

              {/* Payment notice — only shown in development (sandbox) */}
              {step !== 'track' && process.env.NODE_ENV !== 'production' && (
                <div className="rounded-lg border border-brand-border bg-brand-soft p-3 text-xs text-brand">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Dev mode — simulated payment available.</p>
                      <p className="mt-0.5 text-brand">
                        {'The Pay step can use the dev simulator for testing. In production, real UPI payment is used.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {step === 'upload' && (
                <UploadStep
                  files={files}
                  orderTotal={orderTotal}
                  orderTotalPaise={orderTotalPaise}
                  serverCalculated={serverCalculated}
                  hasShop={!!shop}
                  dragOver={dragOver}
                  fileInputRef={fileInputRef}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files); }}
                  onPick={(e) => { const fs = e.target.files; if (fs) void handleFiles(fs); e.target.value = ''; }}
                  onRemove={removeFile}
                  onUpdate={updateFile}
                  onCancelUpload={cancelUpload}
                  onRetryUpload={retryUpload}
                  onConfigure={() => setStep('configure')}
                  onCheckout={() => setStep('checkout')}
                  uploadError={uploadError}
                />
              )}

              {step === 'configure' && (
                <ConfigureStep
                  files={files}
                  shop={shop}
                  orderTotal={orderTotal}
                  orderTotalPaise={orderTotalPaise}
                  serverCalculated={serverCalculated}
                  onUpdate={updateFile}
                  onBack={() => setStep('upload')}
                  onCheckout={() => {
                    // Auto-select all pages for any file with no explicit
                    // selection (null or empty array). This ensures the
                    // checkout step always has a valid page selection —
                    // the user never ends up with "0 pages selected".
                    setFiles((prev) => prev.map((f) => ({
                      ...f,
                      selectedPages: f.selectedPages && f.selectedPages.length > 0 ? f.selectedPages : null,
                    })));
                    setStep('checkout');
                  }}
                />
              )}

              {step === 'checkout' && (
                <CheckoutStep
                  files={files}
                  shop={shop}
                  orderTotalPaise={orderTotalPaise}
                  busy={busy}
                  error={checkoutError}
                  onCheckout={doCheckout}
                  onBack={() => setStep('configure')}
                />
              )}

              {step === 'pay' && (
                <PayStep
                  checkout={checkout}
                  qrDataUrl={qrDataUrl}
                  shopkeeperQrUrl={shopkeeperQrUrl}
                  shopName={shop?.name ?? null}
                  shopUpiId={shop?.upiId ?? null}
                  busy={busy}
                  error={paymentError}
                  simulated={simulated}
                  onPay={doPay}
                  onBack={() => setStep('checkout')}
                />
              )}

              {step === 'track' && order && (
                <TrackStep
                  order={order}
                  onRefresh={refreshStatus}
                  onDownloadReceipt={downloadReceipt}
                  trackError={trackError}
                />
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t border-border bg-surface">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{'PrintShop SaaS · 0% commission · files auto-delete on collection'}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
            <Link href="/shop/login" className="hover:text-foreground">Shopkeeper portal</Link>
            <Link href="/admin/login" className="hover:text-foreground">Admin portal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ──────────────────────────── Sub-components ────────────────────────────

function OrderStepper({ current }: { current: Step }) {
  const idx = STEP_LABELS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Order progress">
      {/* Desktop / tablet: numbered circles connected by a line */}
      <ol className="hidden items-center sm:flex">
        {STEP_LABELS.map((s, i) => {
          const active = i === idx;
          const done = i < idx;
          const isLast = i === STEP_LABELS.length - 1;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors ${
                    done
                      ? 'bg-brand-soft text-brand'
                      : active
                        ? 'bg-brand text-brand-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : i + 1}
                </div>
                <span className={`text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`h-0.5 flex-1 rounded-full ${i < idx ? 'bg-brand' : 'bg-border'}`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile (≤640px): compact — current step label + segmented progress bar */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold tabular-nums text-brand-foreground">
              {idx + 1}
            </div>
            <span className="text-sm font-medium text-foreground">{STEP_LABELS[idx]?.label}</span>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {idx + 1} / {STEP_LABELS.length}
          </span>
        </div>
        <ol className="mt-2 flex items-center gap-1" aria-hidden="true">
          {STEP_LABELS.map((s, i) => (
            <li
              key={s.key}
              className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-brand' : 'bg-muted'}`}
            />
          ))}
        </ol>
      </div>
    </nav>
  );
}

function UploadStep(props: {
  files: LocalFile[];
  orderTotal: number;
  orderTotalPaise: number;
  serverCalculated: boolean;
  hasShop: boolean;
  dragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (fileId: string) => void;
  onUpdate: (fileId: string, patch: Partial<LocalFile>) => void;
  onCancelUpload: (fileId: string) => void;
  onRetryUpload: (fileId: string) => void;
  onConfigure: () => void;
  onCheckout: () => void;
  uploadError: string | null;
}) {
  const readyFiles = props.files.filter((f) => f.status !== 'uploading' && f.status !== 'failed');
  const hasUploading = props.files.some((f) => f.status === 'uploading');
  return (
    <div className="space-y-4">
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UploadCloud className="h-5 w-5 text-brand" /> Step 1 · Upload your files
          </CardTitle>
          <CardDescription>PDF, images, Word, Excel, PowerPoint, and more — up to 25MB each.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${props.dragOver ? 'border-brand bg-brand-soft' : 'border-border'}`}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm text-foreground">Drag files here, or</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 w-full min-h-[44px] sm:w-auto"
              onClick={() => props.fileInputRef.current?.click()}
            >
              Browse files
            </Button>
            <input
              ref={props.fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.ods,.odp,.rtf,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.tif,.tex"
              multiple
              className="hidden"
              onChange={props.onPick}
            />
            <p className="mt-2 text-xs text-muted-foreground">PDF, images, Office docs, text — max 25MB per file.</p>
          </div>
          {props.uploadError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.uploadError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File list */}
      {props.files.length === 0 ? (
        <Card className="bg-surface">
          <CardContent>
            <EmptyState
              icon={<FileText className="size-6" />}
              title="No files uploaded yet"
              description="Add at least one file to continue."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {props.files.map((f) => (
            <FileCard key={f.fileId} file={f} shop={null} onUpdate={props.onUpdate} onRemove={props.onRemove} onCancelUpload={props.onCancelUpload} onRetryUpload={props.onRetryUpload} />
          ))}
        </div>
      )}

      {/* Sticky pricing summary */}
      <Card className="bg-surface lg:sticky lg:bottom-6">
        <CardContent className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated total</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{formatINRFromPaise(props.orderTotal)}</p>
            <p className="text-xs text-muted-foreground">
              {props.serverCalculated
                ? 'Server-confirmed total · may change if you adjust settings.'
                : props.hasShop
                  ? 'Client estimate · server recalculates at checkout.'
                  : 'Will be set when you upload your first file.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onCheckout} disabled={readyFiles.length === 0 || hasUploading}>
              Skip to checkout <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onConfigure} disabled={readyFiles.length === 0 || hasUploading}>
              Configure files <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigureStep(props: {
  files: LocalFile[];
  shop: ShopInfo | null;
  orderTotal: number;
  orderTotalPaise: number;
  serverCalculated: boolean;
  onUpdate: (fileId: string, patch: Partial<LocalFile>) => void;
  onBack: () => void;
  onCheckout: () => void;
}) {
  return (
    <div className="space-y-4">
      {props.files.map((f) => {
        const isPlaceholder = f.pageCountSource === 'placeholder';
        const pageCountValue = f.pageCount > 0 ? f.pageCount : '';
        return (
        <Card key={f.fileId} className={`bg-surface ${isPlaceholder ? 'border-brand-border' : 'border-border'}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 shrink-0 text-brand" />
              <span className="truncate">{f.filename}</span>
              <Badge
                variant={isPlaceholder ? 'outline' : 'secondary'}
                className={`ml-auto shrink-0 text-xs tabular-nums ${isPlaceholder ? 'border-brand-border bg-brand-soft text-brand' : ''}`}
              >
                {isPlaceholder ? 'Page count required' : `${f.pageCount} page${f.pageCount === 1 ? '' : 's'}`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* PDF Preview — visual reference only. Page selection is handled
                entirely by the PageRangeBuilder below (no onSelectionChange
                callback — the PdfPreview used to auto-select all pages on
                load, which overrode the "All pages" default state). */}
            {f.rawFile && !isPlaceholder && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <PdfPreview
                  file={f.rawFile}
                  mimeType={f.filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*'}
                  pageCount={f.pageCount || null}
                />
              </div>
            )}

            {/* Placeholder hint — the auto-extractor couldn't read this file.
                The customer MUST enter the page count before the file can be
                priced or the other settings unlocked. The page-count input
                lives HERE (not in the settings grid) so it's only shown when
                needed. */}
            {isPlaceholder && (
              <div className={`space-y-3 rounded-lg border border-brand-border bg-brand-soft p-3`}>
                <div className="flex items-start gap-2 text-xs text-brand">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">This file&apos;s page count couldn&apos;t be auto-detected.</p>
                    <p className="mt-0.5">Enter the actual page count below to price it. {f.processingError ? ` ${f.processingError}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor={`pc-${f.fileId}`} className="text-xs text-muted-foreground">Page count</Label>
                    <Input
                      id={`pc-${f.fileId}`}
                      type="number"
                      min={1}
                      max={10000}
                      value={pageCountValue}
                      placeholder="e.g. 12"
                      onChange={(e) => props.onUpdate(f.fileId, { pageCount: Math.max(1, Math.min(10000, Number(e.target.value) || 1)), dirty: true })}
                      className="mt-1 h-10 tabular-nums"
                      aria-required={isPlaceholder}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Print settings — 4-column grid (Copies, Colour, Paper, Sides).
                The Page count field is removed from here — it's auto-detected
                (shown in the badge above) or entered via the placeholder hint.
                Settings are disabled for placeholder files (no page count yet). */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Copies</Label>
                <p className="text-xs text-muted-foreground">1 to 500 copies.</p>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={f.copies}
                  onChange={(e) => props.onUpdate(f.fileId, { copies: Math.max(1, Math.min(500, Number(e.target.value) || 1)), dirty: true })}
                  disabled={isPlaceholder}
                  className="h-10 tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Colour</Label>
                <p className="text-xs text-muted-foreground">Monochrome or full colour.</p>
                <ToggleGroup
                  type="single"
                  value={f.colorMode}
                  onValueChange={(v) => v && props.onUpdate(f.fileId, { colorMode: v as ColorMode, dirty: true })}
                  disabled={isPlaceholder}
                  className="mt-0"
                >
                  <ToggleGroupItem value="bw" className="h-10 text-xs">B&amp;W</ToggleGroupItem>
                  <ToggleGroupItem value="color" className="h-10 text-xs">Colour</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Paper size</Label>
                <p className="text-xs text-muted-foreground">A4, A3, Letter, or Legal.</p>
                <select
                  value={f.paperSize}
                  onChange={(e) => props.onUpdate(f.fileId, { paperSize: e.target.value as PaperSize, dirty: true })}
                  disabled={isPlaceholder}
                  className="h-10 w-full rounded-md border border-input bg-surface px-3 text-sm disabled:opacity-50"
                >
                  <option value="a4">A4</option>
                  <option value="a3">A3</option>
                  <option value="letter">Letter</option>
                  <option value="legal">Legal</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Sides</Label>
                <p className="text-xs text-muted-foreground">Duplex saves paper.</p>
                <ToggleGroup
                  type="single"
                  value={f.duplex ? 'duplex' : 'simplex'}
                  onValueChange={(v) => props.onUpdate(f.fileId, { duplex: v === 'duplex', dirty: true })}
                  disabled={isPlaceholder}
                  className="mt-0"
                >
                  <ToggleGroupItem value="simplex" className="h-10 text-xs">Single</ToggleGroupItem>
                  <ToggleGroupItem value="duplex" className="h-10 text-xs">Double</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {/* Advanced page-range builder — defaults to "All pages"
                (selectedPages=null). If the user clears all ranges, it
                resets to all pages. The builder is shown for any file with
                a known page count (auto-extracted or customer-entered). */}
            {!isPlaceholder && f.pageCount > 0 && (
              <PageRangeBuilder
                pageCount={f.pageCount}
                selectedPages={f.selectedPages ?? null}
                disabled={false}
                onChange={(pages) => props.onUpdate(f.fileId, { selectedPages: pages, dirty: true })}
              />
            )}

            {/* Per-file price display */}
            <div className="flex flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {isPlaceholder
                  ? 'Pending page count'
                  : f.selectedPages && f.selectedPages.length < f.pageCount
                    ? `${f.selectedPages.length} of ${f.pageCount} pages selected`
                    : `${f.pageCount || '?'} pages × ${f.copies} copies`}
              </span>
              <span className="text-lg font-semibold tabular-nums text-foreground sm:text-right">
                {isPlaceholder ? '—' : formatINRFromPaise(f.dirty ? 0 : f.pricePaise)}
              </span>
            </div>
          </CardContent>
        </Card>
        );
      })}

      {/* Sticky pricing summary */}
      <Card className="bg-surface lg:sticky lg:bottom-6">
        <CardContent className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {props.serverCalculated ? 'Server-confirmed total' : 'Estimated total'}
            </p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{formatINRFromPaise(props.orderTotal)}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onCheckout}>
              Review &amp; checkout <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckoutStep(props: {
  files: LocalFile[];
  shop: ShopInfo | null;
  orderTotalPaise: number;
  busy: boolean;
  error: string | null;
  onCheckout: () => void;
  onBack: () => void;
}) {
  // Priced files are those that the server has accepted and priced — they
  // carry a non-placeholder page count and a non-zero price. needs_review /
  // placeholder files are excluded from the line-items total and from
  // checkout (the server rejects placeholder files at checkout anyway).
  // In LocalFile terms, server statuses 'pending' and 'queued' map to
  // 'uploaded' (set by loadOrder / uploadOne), so 'uploaded' covers both.
  const priced = props.files.filter((f) => f.status === 'uploaded');
  const reviewFiles = props.files.filter(
    (f) => f.status === 'needs_review' || f.pageCountSource === 'placeholder',
  );
  const pricedTotal = priced.reduce((acc, f) => acc + f.pricePaise, 0);
  const hasReview = reviewFiles.length > 0;
  return (
    <div className="space-y-4">
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5 text-brand" /> Step 3 · Review &amp; checkout
          </CardTitle>
          <CardDescription>The server recalculates the final price at checkout. We never trust the client&apos;s number.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Banner — files awaiting page count. The customer must resolve
              these in the Configure step before checkout can proceed. */}
          {hasReview && (
            <div className="flex items-start gap-2 rounded-lg border border-brand-border bg-brand-soft p-3 text-sm text-brand">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {reviewFiles.length} file{reviewFiles.length === 1 ? '' : 's'} need{reviewFiles.length === 1 ? 's' : ''} a page count before checkout.
                </p>
                <p className="mt-0.5 text-brand">Enter the page count in the Configure step.</p>
              </div>
            </div>
          )}

          {/* Line items table */}
          <div className="overflow-x-auto rounded-lg border border-border sm:overflow-hidden">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">File</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Settings</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {priced.length === 0 && reviewFiles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-sm text-muted-foreground">No files yet — upload a file to begin.</td>
                  </tr>
                )}
                {priced.map((f) => (
                  <tr key={f.fileId}>
                    <td className="px-3 py-2 text-foreground">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.filename}</span>
                      </div>
                      <span className="ml-6 text-xs tabular-nums text-muted-foreground">{f.pageCount} pages</span>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {f.copies}× · {f.colorMode === 'bw' ? 'B&amp;W' : 'Colour'} · {f.paperSize.toUpperCase()}
                      {f.duplex ? ' · duplex' : ''}
                      {f.pageRange ? ` · ${f.pageRange}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">{formatINRFromPaise(f.pricePaise)}</td>
                  </tr>
                ))}
                {reviewFiles.map((f) => (
                  <tr key={f.fileId} className="bg-brand-soft/30">
                    <td className="px-3 py-2 text-foreground">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.filename}</span>
                        <Badge variant="outline" className="border-brand-border bg-brand-soft text-xs text-brand">Page count required</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40">
                  <td className="px-3 py-2 font-medium text-foreground" colSpan={2}>Server-confirmed total{hasReview ? ' (priced files only)' : ''}</td>
                  <td className="px-3 py-2 text-right text-lg font-semibold tabular-nums text-foreground">{formatINRFromPaise(pricedTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {props.shop && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                <span className="break-words">Pay to <strong className="font-mono">{props.shop.upiId}</strong> · {props.shop.name}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {'Provider: '}{props.shop.paymentProvider}{'. The shopkeeper receives money directly — zero commission.'}
              </p>
            </div>
          )}

          {props.error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-2">
          <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onCheckout} disabled={props.busy || priced.length === 0 || hasReview}>
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Create payment
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function PayStep(props: {
  checkout: CheckoutResponse | null;
  qrDataUrl: string | null;
  shopkeeperQrUrl: string | null;
  shopName: string | null;
  shopUpiId: string | null;
  busy: boolean;
  error: string | null;
  simulated: boolean;
  onPay: () => void;
  onBack: () => void;
}) {
  const amount = props.checkout ? formatINRFromPaise(props.checkout.amountPaise) : '—';
  const upiUri = props.checkout?.upiUri ?? null;
  const desktopQr = props.shopkeeperQrUrl ?? props.qrDataUrl;
  const isShopkeeperQr = !!props.shopkeeperQrUrl;

  const launchUpi = () => {
    if (!upiUri) return;
    window.location.href = upiUri;
  };

  return (
    <div className="space-y-4">
      <Card className="border-brand-border bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-brand" /> Step 4 · Pay {props.shopName ?? 'the shopkeeper'}
          </CardTitle>
          <CardDescription>Pay directly to the shopkeeper&apos;s UPI — 0% commission.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Amount — prominent */}
          <div className="rounded-lg bg-brand-soft p-4 text-center ring-1 ring-brand-border">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount to pay</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-foreground sm:text-4xl lg:text-5xl">{amount}</p>
            <p className="mt-1 text-xs text-muted-foreground">direct to shopkeeper&apos;s UPI · 0% commission</p>
          </div>

          {/* Payment method cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Option 1: Pay by UPI App (GPay / PhonePe / Paytm) */}
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-success-border bg-success-soft p-5 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Pay by UPI App</p>
                <p className="mt-0.5 text-xs text-muted-foreground">GPay · PhonePe · Paytm — amount prefilled.</p>
              </div>
              <button
                type="button"
                onClick={launchUpi}
                disabled={props.busy || !upiUri}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-success px-4 py-3.5 text-sm font-semibold text-success-foreground shadow-sm transition-colors hover:bg-success/90 disabled:opacity-50 min-h-[44px]"
                aria-label={`Pay ${amount} with UPI`}
              >
                <Smartphone className="h-4 w-4" />
                Pay <span className="tabular-nums">{amount}</span> with UPI
              </button>
              {!upiUri && (
                <p className="text-xs text-brand">UPI app payment not available — use the QR instead.</p>
              )}
            </div>

            {/* Option 2: Scan QR Code */}
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-brand-border bg-brand-soft p-5 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Scan QR Code</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Scan with any UPI app to pay the exact amount.</p>
              </div>
              {desktopQr ? (
                <div className="rounded-lg bg-surface p-2 ring-1 ring-border">
                  <img
                    src={desktopQr}
                    alt="UPI payment QR code"
                    className="mx-auto h-36 w-36 sm:h-40 sm:w-40"
                  />
                </div>
              ) : props.checkout ? (
                <div className="flex h-36 w-36 items-center justify-center rounded-lg bg-muted/60 sm:h-40 sm:w-40">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex h-36 w-36 items-center justify-center rounded-lg bg-muted/60 text-xs text-muted-foreground sm:h-40 sm:w-40">
                  No QR
                </div>
              )}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {isShopkeeperQr
                  ? 'Scan with any UPI app (GPay, PhonePe, Paytm) to pay.'
                  : 'Scan this QR with your UPI app to pay.'}
              </p>
            </div>

            {/* UPI ID manual fallback */}
            {props.shopUpiId && (
              <div className="rounded-lg bg-muted/40 p-3 text-center sm:col-span-2">
                <p className="text-xs text-muted-foreground">Or enter UPI ID manually in your app:</p>
                <p className="mt-0.5 font-mono text-sm font-medium text-foreground">{props.shopUpiId}</p>
              </div>
            )}
          </div>

          {/* Payment notice */}
          <div className="rounded-lg border border-brand-border bg-brand-soft p-3 text-xs text-brand">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">After paying, tap &quot;I&apos;ve paid&quot; below.</p>
                <p className="mt-0.5 text-brand">
                  Your payment stays <strong>Pending</strong> until verified. The shopkeeper will confirm receipt (or the system auto-verifies if a payment provider is connected).
                </p>
              </div>
            </div>
          </div>

          {props.error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-2">
          <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onBack} disabled={props.busy}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onPay} disabled={props.busy || !props.checkout || props.simulated}>
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
            {props.simulated ? 'Tracking…' : "I've paid — track my order"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function TrackStep(props: {
  order: OrderStatusResponse;
  onRefresh: () => void;
  onDownloadReceipt: () => void;
  trackError: string | null;
}) {
  const s = props.order.status;
  const done = s === 'ready' || s === 'collected';
  const cancelled = s === 'cancelled' || s === 'refunded';
  return (
    <div className="space-y-4">
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : cancelled ? <XCircle className="h-5 w-5 text-danger" /> : <Loader2 className="h-5 w-5 animate-spin text-brand" />}
            Step 5 · Track your order
          </CardTitle>
          <CardDescription>Refreshed automatically every 30 seconds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Confirmation — show the CANONICAL token (same as the shopkeeper sees) */}
          <div className="rounded-lg bg-muted/60 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Your token</p>
            <p className="font-mono text-2xl font-bold tabular-nums break-words text-brand sm:text-3xl sm:tracking-widest">
              {props.order.tokenNumber ?? props.order.customerToken}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Show this at the counter.</p>
          </div>

          {/* ── Payment status indicator (SEPARATE from order-processing status) ── */}
          {/* ROOT CAUSE FIX: the old code showed a permanent spinner even when
              payment was confirmed (because the spinner was tied to the ORDER
              status, not the PAYMENT status). Now the payment status has its
              own indicator: green checkmark when paidAt !== null, amber clock
              when pending. A UPI app launch, browser return, or customer-
              submitted UTR NEVER sets paidAt — only an authorized shopkeeper
              or a verified provider webhook can do that. */}
          <div className={`rounded-lg p-4 text-center ${props.order.paidAt ? 'bg-success-soft ring-1 ring-success-border' : 'bg-brand-soft ring-1 ring-brand-border'}`}>
            {props.order.paidAt ? (
              <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            ) : (
              <Clock className="mx-auto h-8 w-8 text-brand" />
            )}
            <p className={`mt-1 text-sm font-semibold ${props.order.paidAt ? 'text-success' : 'text-brand'}`}>
              {props.order.paidAt ? 'Payment Confirmed' : 'Payment Pending'}
            </p>
            {props.order.paidAt ? (
              <>
                <p className="mt-0.5 text-xs tabular-nums text-success">
                  Confirmed {new Date(props.order.paidAt).toLocaleString('en-IN')}
                  {props.order.paymentUtr ? ` · UTR ${props.order.paymentUtr}` : ''}
                </p>
                {/* Auto/Manual verification badge */}
                <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  props.order.paymentTxnId?.startsWith('manual-')
                    ? 'bg-brand-soft text-brand'
                    : 'bg-success-soft text-success'
                }`}>
                  {props.order.paymentTxnId?.startsWith('manual-') ? ' Manual verification' : ' Auto-verified'}
                </span>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-brand">
                The shopkeeper will verify your UPI payment after you pay.
              </p>
            )}
          </div>

          {/* ── Order-processing status (SEPARATE from payment status) ── */}
          {/* This shows the ORDER lifecycle: paid → printing → ready → collected.
              The spinner here is correct — it indicates the order is being
              processed, NOT that payment is still being verified. */}
          <div className={`rounded-lg p-4 text-center ${done ? 'bg-success-soft ring-1 ring-success-border' : cancelled ? 'bg-danger-soft ring-1 ring-danger-border' : 'bg-brand-soft ring-1 ring-brand-border'}`}>
            {done ? <CheckCircle2 className="mx-auto h-8 w-8 text-success" /> : cancelled ? <XCircle className="mx-auto h-8 w-8 text-danger" /> : <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" />}
            <div className="mt-2 flex justify-center">
              <OrderStatusBadge status={s} />
            </div>
          </div>

          {/* Order ID + amount */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Order ID</p>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-foreground">{props.order.orderId.slice(0, 8)}…</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{formatINRFromPaise(props.order.totalAmountPaise)}</p>
            </div>
          </div>

          {/* Files table */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Files</p>
            {/* On mobile: horizontal scroll. On >=sm: standard table. */}
            <div className="overflow-x-auto rounded-lg border border-border sm:overflow-hidden">
              <table className="w-full min-w-[320px] text-sm">
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">File</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {props.order.files.map((f) => (
                    <tr key={f.id}>
                      <td className="px-3 py-2 text-foreground">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.filename}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <FileStatusBadge status={f.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {props.trackError && (
            <div className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.trackError}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-2">
          <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onRefresh}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2">
            {done && (
              <Button variant="outline" size="sm" className="w-full min-h-[44px] sm:w-auto" onClick={props.onDownloadReceipt}>
                <Download className="h-4 w-4" /> Download receipt
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="w-full min-h-[44px] sm:w-auto">
              <Link href="/"><Home className="h-4 w-4" /> Back to home</Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function FileStatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { label: string; variant: StatusVariant }> = {
    pending: { label: 'Pending', variant: 'neutral' },
    queued: { label: 'Queued', variant: 'neutral' },
    printing: { label: 'Printing', variant: 'brand' },
    completed: { label: 'Completed', variant: 'success' },
    failed: { label: 'Failed', variant: 'danger' },
    needs_review: { label: 'Needs review', variant: 'warning' },
  };
  const m = map[status];
  return <StatusIndicator variant={m.variant} label={m.label} />;
}

function FileCard(props: {
  file: LocalFile;
  shop: ShopInfo | null;
  onUpdate: (fileId: string, patch: Partial<LocalFile>) => void;
  onRemove: (fileId: string) => void;
  onCancelUpload: (fileId: string) => void;
  onRetryUpload: (fileId: string) => void;
}) {
  const { file: f } = props;
  const isUploading = f.status === 'uploading';
  const isFailed = f.status === 'failed';
  const isReview = f.status === 'needs_review' || f.pageCountSource === 'placeholder';

  return (
    <Card className={`bg-surface ${isFailed ? 'border-danger-border' : isReview ? 'border-brand-border' : 'border-border'}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{f.filename}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {f.size > 0 ? `${(f.size / 1024).toFixed(0)} KB` : '—'}
                {!isReview && f.pageCount > 0 ? ` · ${f.pageCount} pages` : ''}
              </p>
              {isFailed && f.uploadError && (
                <p className="mt-1 text-xs text-danger">{f.uploadError}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {f.patching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {/* Workstream-2: Cancel button for in-flight uploads — aborts the XHR
                via cancelUpload() (sets status='failed' with 'Upload cancelled'). */}
            {isUploading && (
              <button
                type="button"
                onClick={() => props.onCancelUpload(f.fileId)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-danger"
                aria-label="Cancel upload"
                title="Cancel upload"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
            {/* Workstream-2: Retry button for failed uploads — re-runs
                uploadOne with the failed entry's preserved rawFile (a FRESH
                presigned URL is minted inside uploadOne). */}
            {isFailed && f.rawFile && (
              <button
                type="button"
                onClick={() => props.onRetryUpload(f.fileId)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-brand"
                aria-label="Retry upload"
                title="Retry upload"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => props.onRemove(f.fileId)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-danger"
              aria-label="Remove file"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Upload progress */}
        {isUploading && (
          <div className="mt-3">
            <Progress value={f.uploadProgress} className="h-2" />
            <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{f.uploadProgress}%</p>
          </div>
        )}

        {/* Placeholder banner — the file has no trustworthy page count, so it
            can't be priced. Direct the customer to the Configure step. */}
        {isReview && !isFailed && !isUploading && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-brand-border bg-brand-soft p-3 text-xs text-brand">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Page count required</p>
              <p className="mt-0.5">
                Enter the number of pages in the Configure step to get a price.
                {f.processingError ? ` ${f.processingError}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Hint for uploaded files — print settings are configured in the
            Configure step, not here. This avoids duplicate settings. */}
        {!isUploading && !isFailed && !isReview && (
          <p className="mt-3 text-xs text-muted-foreground">
            {f.pageCount > 0 ? `${f.pageCount} page${f.pageCount === 1 ? '' : 's'} detected` : ''}
            {' · '}Configure print settings in the next step
          </p>
        )}
      </CardContent>
    </Card>
  );
}
