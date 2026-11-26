'use client';

/**
 * Smart Print Studio — the main orchestrator.
 *
 * A premium 5-step document-upload + print-configuration experience that
 * wraps the EXISTING Printelyx backend. No mock data, no new APIs.
 *
 * Steps: Upload → Print settings → Review → Payment → Confirmation
 *
 * State management follows the existing project pattern (React useState +
 * localStorage/IndexedDB persistence — no new libraries). The draft is
 * persisted on every change and restored on mount so a refresh never loses
 * progress.
 *
 * The server quote is authoritative — the client never invents prices. The
 * quote is debounced-refreshed whenever a file's settings or page modes
 * change, and re-validated at place-order time (409 PRICES_CHANGED).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShopCapabilities, StudioFile, StudioStep, Quote, PlacedOrder, PrintSettings, DEFAULT_SETTINGS, formatRupees } from './types';
import {
  startUpload, uploadChunk, cancelUpload, completeUpload, uploadStatus,
  pollFile, fetchQuote, saveSpec, placeOrder, submitPayment,
  CHUNK_SIZE, MAX_FILE_BYTES, MAX_ORDER_BYTES, retryWithBackoff,
} from './studio-api';
import { StudioStepper } from './StudioStepper';
import { StudioSummary } from './StudioSummary';
import { StepUpload } from './steps/StepUpload';
import { StepPrintSettings } from './steps/StepPrintSettings';
import { StepPreview } from './steps/StepPreview';
import { StepPayment } from './steps/StepPayment';
import { StepConfirmation } from './steps/StepConfirmation';
import { buildUpiIntentUrl } from '@/lib/payments/upi';
import { saveRecentOrder } from '@/lib/customer/recent-orders';
import { savePendingOrder, readPendingOrder, clearPendingOrder } from '@/lib/customer/order-restore';
import { useApiClient } from '@/components/portal/use-api-client';

const DRAFT_KEY = 'printelyx:studio-draft';
const QUOTE_DEBOUNCE_MS = 600;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 120_000;

interface DraftSnapshot {
  orderId: string | null;
  orderToken: string | null;
  files: Array<{
    id: string;
    fileId: string | null;
    uploadId: string | null;
    name: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number | null;
    settings: PrintSettings;
  }>;
  customerName: string;
  customerPhone: string;
  note: string;
}

function loadDraft(shopSlug: string): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}:${shopSlug}`);
    if (!raw) return null;
    return JSON.parse(raw) as DraftSnapshot;
  } catch { return null; }
}

function saveDraft(shopSlug: string, draft: DraftSnapshot): void {
  try { localStorage.setItem(`${DRAFT_KEY}:${shopSlug}`, JSON.stringify(draft)); } catch { /* ignore */ }
}

function clearDraft(shopSlug: string): void {
  try { localStorage.removeItem(`${DRAFT_KEY}:${shopSlug}`); } catch { /* ignore */ }
}

let idCounter = 0;
function tempId(): string {
  idCounter += 1;
  return `tmp-${Date.now()}-${idCounter}`;
}

export interface SmartPrintStudioProps {
  shop: ShopCapabilities;
  shopName: string;
}

export function SmartPrintStudio({ shop, shopName }: SmartPrintStudioProps) {
  const api = useApiClient();
  const [step, setStep] = useState<StudioStep>('upload');
  const [files, setFiles] = useState<StudioFile[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderToken, setOrderToken] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [pricesChanged, setPricesChanged] = useState<number | null>(null);

  const abortersRef = useRef<Map<string, AbortController>>(new Map());
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteAbortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);

  /* ── Restore draft on mount ─────────────────────────────────────────── */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const draft = loadDraft(shop.slug);
    if (draft) {
      setOrderId(draft.orderId);
      setOrderToken(draft.orderToken);
      setCustomerName(draft.customerName);
      setCustomerPhone(draft.customerPhone);
      setNote(draft.note);
      setFiles(draft.files.map((f) => ({
        id: f.id,
        fileId: f.fileId,
        uploadId: f.uploadId,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        progress: f.fileId ? 100 : 0,
        status: f.fileId ? 'ready' : 'queued',
        pageCount: f.pageCount,
        thumbnails: [],
        colorSuggestion: null,
        settings: f.settings,
      })));
    }
    // Restore a placed-but-unpaid order (e.g. returning from UPI app).
    const pending = readPendingOrder();
    if (pending && pending.shopSlug === shop.slug) {
      setPlaced({ token: pending.token, orderNumber: pending.orderNumber, pickupCode: pending.pickupCode, totalPaise: pending.totalPaise, placedAt: pending.placedAt });
      setStep('payment');
    }
  }, [shop.slug]);

  /* ── Persist draft on every change ──────────────────────────────────── */
  useEffect(() => {
    if (!restoredRef.current) return;
    saveDraft(shop.slug, {
      orderId, orderToken,
      files: files.map((f) => ({
        id: f.id, fileId: f.fileId, uploadId: f.uploadId,
        name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes,
        pageCount: f.pageCount ?? null, settings: f.settings,
      })),
      customerName, customerPhone, note,
    });
  }, [files, orderId, orderToken, customerName, customerPhone, note, shop.slug]);

  /* ── Cleanup timers on unmount ──────────────────────────────────────── */
  useEffect(() => {
    const aborters = abortersRef.current;
    const polls = pollTimersRef.current;
    const quoteTimer = quoteTimerRef.current;
    return () => {
      polls.forEach((t) => clearTimeout(t));
      aborters.forEach((a) => a.abort());
      if (quoteTimer) clearTimeout(quoteTimer);
    };
  }, []);

  const readyFiles = useMemo(() => files.filter((f) => f.status === 'ready' && f.fileId && f.pageCount), [files]);
  const totalFiles = files.length;
  const totalPages = useMemo(() => readyFiles.reduce((sum, f) => sum + (f.pageCount ?? 0) * f.settings.copies, 0), [readyFiles]);
  const colourPages = useMemo(() => {
    return readyFiles.reduce((sum, f) => {
      if (f.settings.mode === 'colour') return sum + (f.pageCount ?? 0);
      if (f.settings.mode === 'mixed') return sum + f.settings.colourPages.length;
      return sum;
    }, 0);
  }, [readyFiles]);
  const bwPages = totalPages - colourPages;

  /* ── Upload one file via the chunked protocol ───────────────────────── */
  const uploadOne = useCallback(async (file: globalThis.File, existingOrderId?: string, existingOrderToken?: string) => {
    const tempFileId = tempId();
    const initial: StudioFile = {
      id: tempFileId, fileId: null, uploadId: null,
      name: file.name, mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size, progress: 0, status: 'uploading',
      thumbnails: [], colorSuggestion: null,
      settings: { ...DEFAULT_SETTINGS, paperSize: shop.paperSizes[0] ?? 'A4' },
    };
    setFiles((fs) => [...fs, initial]);

    const aborter = new AbortController();
    abortersRef.current.set(tempFileId, aborter);

    try {
      // 1. Init
      const init = await startUpload(shop.slug, { name: file.name, type: file.type, size: file.size }, existingOrderId, existingOrderToken);
      if (aborter.signal.aborted) { await cancelUpload(shop.slug, init.uploadId).catch(() => {}); return; }
      // Capture the order credentials created by init.
      if (!existingOrderId && init.orderId) { setOrderId(init.orderId); setOrderToken(init.orderToken); }
      setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, fileId: init.fileId, uploadId: init.uploadId } : f));

      // 2. Upload chunks
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index++) {
        if (aborter.signal.aborted) { await cancelUpload(shop.slug, init.uploadId).catch(() => {}); return; }
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        await retryWithBackoff(() => uploadChunk(shop.slug, init.uploadId, index, chunk));
        setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, progress: Math.round((end / file.size) * 100) } : f));
      }

      // 3. Complete → triggers server-side page-count + thumbnail extraction
      setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, status: 'converting', progress: 100 } : f));
      await completeUpload(shop.slug, init.uploadId);

      // 4. Poll for readiness (page count + thumbnails)
      const startedAt = Date.now();
      const poll = async () => {
        if (aborter.signal.aborted) return;
        const status = await pollFile(shop.slug, init.fileId, init.orderToken);
        if (!status) { schedulePoll(); return; }
        if (status.status === 'ready' || status.status === 'processed') {
          setFiles((fs) => fs.map((f) => f.id === tempFileId ? {
            ...f, status: 'ready', pageCount: status.pageCount,
            pageWidthPt: status.pageWidthPt, pageHeightPt: status.pageHeightPt,
            thumbnails: status.thumbnails ?? [], colorSuggestion: status.colorSuggestion,
          } : f));
          return;
        }
        if (status.failReason || status.status === 'failed') {
          setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, status: 'failed', failReason: status.failReason ?? 'Processing failed' } : f));
          return;
        }
        if (Date.now() - startedAt > POLL_MAX_MS) {
          setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, status: 'failed', failReason: 'Processing timed out — please try again' } : f));
          return;
        }
        schedulePoll();
      };
      const schedulePoll = () => {
        if (aborter.signal.aborted) return;
        pollTimersRef.current.set(tempFileId, setTimeout(poll, POLL_INTERVAL_MS));
      };
      schedulePoll();
    } catch (err) {
      if (aborter.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setFiles((fs) => fs.map((f) => f.id === tempFileId ? { ...f, status: 'failed', failReason: msg } : f));
    } finally {
      abortersRef.current.delete(tempFileId);
    }
  }, [shop.slug, shop.paperSizes]);

  /* ── Retry a failed upload ──────────────────────────────────────────── */
  const retryUpload = useCallback((fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    // Re-create a File object — we can't, so we re-init from the stored metadata.
    // The original File object isn't retained; the customer must re-pick.
    // Instead, remove the failed entry and let them re-add.
    setFiles((fs) => fs.filter((f) => f.id !== fileId));
  }, [files]);

  /* ── Remove a file (cancel + delete server-side) ────────────────────── */
  const removeFile = useCallback((fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    const aborter = abortersRef.current.get(fileId);
    if (aborter) aborter.abort();
    if (file.uploadId) void cancelUpload(shop.slug, file.uploadId).catch(() => {});
    pollTimersRef.current.get(fileId) && clearTimeout(pollTimersRef.current.get(fileId)!);
    setFiles((fs) => fs.filter((f) => f.id !== fileId));
  }, [files, shop.slug]);

  /* ── Add files (from the picker / dropzone) ─────────────────────────── */
  const addFiles = useCallback((picked: FileList | File[]) => {
    const arr = Array.from(picked);
    setError(null);
    const totalSize = files.reduce((s, f) => s + f.sizeBytes, 0);
    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is too large. Maximum file size is 50 MB.`);
        continue;
      }
      if (totalSize + file.size > MAX_ORDER_BYTES) {
        setError('Total order size would exceed 200 MB. Remove a file or upload a smaller one.');
        break;
      }
      // Duplicate detection by name + size
      if (files.some((f) => f.name === file.name && f.sizeBytes === file.size)) {
        setError(`${file.name} is already added.`);
        continue;
      }
      void uploadOne(file, orderId ?? undefined, orderToken ?? undefined);
    }
  }, [files, orderId, orderToken, uploadOne]);

  /* ── Patch a file's settings ────────────────────────────────────────── */
  const patchFile = useCallback((id: string, patch: Partial<StudioFile>) => {
    setFiles((fs) => fs.map((f) => f.id === id ? { ...f, ...patch } : f));
  }, []);
  const patchSettings = useCallback((id: string, patch: Partial<PrintSettings>) => {
    setFiles((fs) => fs.map((f) => f.id === id ? { ...f, settings: { ...f.settings, ...patch } } : f));
  }, []);

  /* ── Apply settings to all files ────────────────────────────────────── */
  const applyToAll = useCallback((settings: Partial<PrintSettings>) => {
    setFiles((fs) => fs.map((f) => f.id ? { ...f, settings: { ...f.settings, ...settings } } : f));
  }, []);

  /* ── Debounced quote refresh ────────────────────────────────────────── */
  const quoteKey = useMemo(() => {
    return readyFiles.map((f) => `${f.fileId}:${f.settings.mode}:${f.settings.copies}:${f.settings.sides}:${f.settings.paperSize}:${f.settings.colourPages.length}:${f.settings.skipPages.length}`).join('|');
  }, [readyFiles]);

  useEffect(() => {
    if (readyFiles.length === 0) { setQuote(null); return; }
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    setQuoting(true);
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    quoteTimerRef.current = setTimeout(async () => {
      try {
        const q = await fetchQuote(shop.slug, readyFiles.map((f) => ({ fileId: f.fileId!, pageCount: f.pageCount!, settings: f.settings })));
        if (!controller.signal.aborted) { setQuote(q); setError(null); }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not price the order');
      } finally {
        if (quoteAbortRef.current === controller) { setQuoting(false); quoteAbortRef.current = null; }
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
      if (quoteAbortRef.current) quoteAbortRef.current.abort();
    };
  }, [quoteKey, shop.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Navigation guards ──────────────────────────────────────────────── */
  const canGoSettings = readyFiles.length > 0;
  const canGoPreview = readyFiles.length > 0 && readyFiles.every((f) => f.pageCount != null);
  const canGoPayment = readyFiles.length > 0 && quote != null && quote.totalPaise != null && customerPhone.replace(/\D/g, '').length >= 10;

  /* ── Place order + submit payment ───────────────────────────────────── */
  const placeTheOrder = useCallback(async (): Promise<boolean> => {
    if (!orderId || !orderToken) { setError('Session expired. Please re-add your files.'); return false; }
    setError(null);
    setPricesChanged(null);
    try {
      // Sync specs for every ready file
      for (const f of readyFiles) {
        await saveSpec(shop.slug, { orderId, orderToken, fileId: f.fileId!, pageCount: f.pageCount!, settings: f.settings });
      }
      const result = await placeOrder(shop.slug, {
        orderId, orderToken, addonIds: [],
        customerName: customerName || null,
        customerPhone: customerPhone.replace(/\D/g, '') || null,
        note: note || null,
        clientTotalPaise: quote?.totalPaise ?? null,
        authToken: api.ready && api.role === 'customer' ? api.token : null,
      });
      if (!result.ok) {
        if (result.code === 'PRICES_CHANGED') {
          setPricesChanged(result.newTotal);
          setError('Prices changed while you were ordering. The total has been updated — review and confirm again.');
          return false;
        }
        setError(result.message);
        return false;
      }
      setPlaced(result.data);
      setStep('payment');
      savePendingOrder({ ...result.data, shopSlug: shop.slug, shopName });
      try {
        saveRecentOrder({
          token: result.data.token, shopSlug: shop.slug, shopName,
          orderNumber: result.data.orderNumber, pickupCode: result.data.pickupCode,
          totalPaise: result.data.totalPaise, status: 'awaiting_payment',
          placedAt: new Date(result.data.placedAt).toISOString(),
        });
      } catch { /* ignore */ }
      clearDraft(shop.slug);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place the order');
      return false;
    }
  }, [orderId, orderToken, readyFiles, shop.slug, shopName, customerName, customerPhone, note, quote, api]);

  const submitUtr = useCallback(async (utr: string): Promise<boolean> => {
    if (!placed) return false;
    setError(null);
    const result = await submitPayment(placed.token, { method: 'upi', utr, declaredAmountPaise: placed.totalPaise });
    if (!result.ok) { setError(result.message ?? 'Could not submit the UTR'); return false; }
    clearPendingOrder();
    setStep('confirmation');
    return true;
  }, [placed]);

  const chooseCounter = useCallback(async (method: 'counter_cash' | 'counter_upi'): Promise<boolean> => {
    if (!placed) return false;
    setError(null);
    const result = await submitPayment(placed.token, { method, declaredAmountPaise: placed.totalPaise });
    if (!result.ok) { setError(result.message ?? 'Could not submit'); return false; }
    clearPendingOrder();
    setStep('confirmation');
    return true;
  }, [placed]);

  const upiIntentUrl = useMemo(() => {
    if (!placed || !shop.upiId) return null;
    return buildUpiIntentUrl({ payeeUpi: shop.upiId, payeeName: shopName, amountPaise: placed.totalPaise, orderShortId: placed.orderNumber });
  }, [placed, shop.upiId, shopName]);

  /* ── Render ─────────────────────────────────────────────────────────── */
  if (step === 'confirmation' && placed) {
    return <StepConfirmation placed={placed} shop={shop} shopName={shopName} />;
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      {/* Top progress bar */}
      <div className="sticky top-0 z-30 border-b border-[var(--hairline)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <StudioStepper current={step} />
          <button
            type="button"
            onClick={() => { if (confirm('Leave the print studio? Your uploaded files will be kept for this session.')) window.location.href = `/s/${shop.slug}`; }}
            className="hidden text-[14px] font-medium text-[var(--label-2)] hover:text-[var(--label)] sm:block"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Main layout: content + sticky summary (desktop) */}
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {error && (
            <div className="mb-4 rounded-[10px] border border-[var(--error)]/30 bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#991B1B]" role="alert">
              {error}
            </div>
          )}
          {step === 'upload' && (
            <StepUpload
              files={files}
              shop={shop}
              onAddFiles={addFiles}
              onRemove={removeFile}
              onRetry={retryUpload}
              onNext={() => setStep('settings')}
              canNext={canGoSettings}
            />
          )}
          {step === 'settings' && (
            <StepPrintSettings
              files={files}
              shop={shop}
              onPatchSettings={patchSettings}
              onApplyToAll={applyToAll}
              onBack={() => setStep('upload')}
              onNext={() => setStep('preview')}
              canNext={canGoPreview}
            />
          )}
          {step === 'preview' && (
            <StepPreview
              files={files}
              shop={shop}
              onBack={() => setStep('settings')}
              onNext={() => setStep('payment')}
              canNext={canGoPayment}
              customerName={customerName}
              customerPhone={customerPhone}
              onCustomerName={setCustomerName}
              onCustomerPhone={setCustomerPhone}
              note={note}
              onNote={setNote}
            />
          )}
          {step === 'payment' && placed && (
            <StepPayment
              placed={placed}
              shop={shop}
              shopName={shopName}
              upiIntentUrl={upiIntentUrl}
              onSubmitUtr={submitUtr}
              onChooseCounter={chooseCounter}
              onBack={() => setStep('preview')}
            />
          )}
          {step === 'payment' && !placed && (
            <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-6 text-center">
              <p className="text-[15px] font-semibold text-[var(--label)]">Placing your order…</p>
              <button onClick={() => void placeTheOrder()} className="mt-4 inline-flex min-h-[44px] items-center rounded-[10px] bg-[var(--accent)] px-6 text-[14px] font-semibold text-white hover:bg-[var(--accent-press)]">
                Place order
              </button>
            </div>
          )}
        </div>

        {/* Sticky summary (desktop right rail + mobile bottom bar) */}
        <aside className="hidden lg:block">
          <div className="sticky top-[72px]">
            <StudioSummary
              quote={quote}
              quoting={quoting}
              totalFiles={totalFiles}
              totalPages={totalPages}
              colourPages={colourPages}
              bwPages={bwPages}
              copies={readyFiles.reduce((s, f) => s + f.settings.copies, 0)}
              shop={shop}
            />
          </div>
        </aside>
      </div>

      {/* Mobile sticky bottom summary */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--hairline)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] lg:hidden">
        <MobileSummary
          quote={quote}
          quoting={quoting}
          totalPages={totalPages}
          totalFiles={totalFiles}
        />
      </div>
    </div>
  );
}

/* ── Mobile bottom summary (compact) ──────────────────────────────────── */
function MobileSummary({ quote, quoting, totalPages, totalFiles }: { quote: Quote | null; quoting: boolean; totalPages: number; totalFiles: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-[12px] font-medium text-[var(--label-2)]">
          {totalFiles} {totalFiles === 1 ? 'file' : 'files'} · {totalPages} pages
        </p>
        <p className="text-[18px] font-bold text-[var(--label)]">
          {quoting ? 'Calculating…' : quote ? formatRupees(quote.totalPaise) : '—'}
        </p>
      </div>
      {quote?.warnings && quote.warnings.length > 0 && (
        <span className="rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warning)]">Estimate</span>
      )}
    </div>
  );
}
