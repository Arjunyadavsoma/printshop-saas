'use client';

/**
 * ReferenceCustomerFlow — the 7-screen customer order flow that 1:1 matches
 * the reference HTML design (the `.ref-*` CSS classes in globals.css).
 *
 * Screens (step state):
 *   1. landing  — shop open + Add files CTA + rate board + hours
 *   2. files    — file rows (uploading/ready) + Add more files + Continue
 *   3. options  — 4 print-style presets + pages/more-options + Choose colour pages
 *   4. review   — file summary + total + mobile/name + Pay ₹{total}
 *   5. pay      — UPI app rows + Shop UPI ID + I've paid / Pay at counter
 *   6. waiting  — amount + UTR + elapsed chip + Call shop / Enter UTR again
 *   7. track    — pickup code + timeline + Call shop / Cancel order
 *
 * API contract (unchanged from V2):
 *   uploads/init → uploads/chunk → uploads/complete → files/{id} (poll)
 *   → specs (PUT per file) → quote (POST) → orders (POST) → o/{token}/payment → o/{token} (poll)
 *
 * The component is a single client component with step-based navigation.
 * No shadcn/ui — only `.ref-*` CSS classes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReferenceColorPages } from './ReferenceColorPages';

/* ── Types ──────────────────────────────────────────────────────────── */

type Step = 'landing' | 'files' | 'options' | 'colorpages' | 'review' | 'pay' | 'waiting' | 'track';

type PresetId = 'notes' | 'colour' | 'photo' | 'mix';

interface FlowFile {
  fileId: string;
  uploadId: string;
  name: string;
  sizeBytes: number;
  progress: number;
  status: 'uploading' | 'converting' | 'ready' | 'failed';
  pageCount: number | null;
  colorPages: number;
}

interface DraftHandle {
  orderId: string;
  orderToken: string;
}

interface PlacedOrder {
  token: string;
  orderNumber: string;
  pickupCode: string;
  totalPaise: number;
  placedAt: number;
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

export interface ReferenceCustomerFlowProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  /** Pre-formatted display strings: "₹2", "₹10" — used on the landing screen. */
  bwPrice: string;
  colorPrice: string;
  hours: string;
  waitMinutes: number;
  printerCount: number;
  /** Optional shop phone for "Call shop" rows. */
  shopPhone?: string;
  /** Optional shop address for "Directions". */
  shopAddress?: string;
}

/* ── Constants ──────────────────────────────────────────────────────── */

const CHUNK_SIZE = 2 * 1024 * 1024;
const FILE_POLL_MS = 1500;
const ORDER_POLL_MS = 4000;

const PRESETS: Array<{
  id: PresetId;
  name: string;
  description: string;
}> = [
  { id: 'notes', name: 'Notes', description: 'Black & white, double-sided' },
  { id: 'colour', name: 'Colour everything', description: 'All pages in colour' },
  { id: 'photo', name: 'Photo or ID copy', description: 'Single-sided, best quality' },
  { id: 'mix', name: 'Mix', description: 'Some pages look colourful' },
];

/* ── Helpers ────────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRupees(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return `₹${Math.round(paise / 100)}`;
}

/** Parse a "₹2" / "₹10" string back to a per-page paise integer. */
function parsePricePaise(s: string): number | null {
  if (!s) return null;
  const m = s.match(/₹\s*([\d.]+)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]!) * 100);
}

/** SHA-256 hex of a Blob slice via WebCrypto (per-chunk checksums). */
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Map a server order status to a customer-facing label. */
function upiIntentUrl(vpa: string, amountPaise: number, orderNumber: string | null): string {
  const params = new URLSearchParams({
    pa: vpa,
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
  });
  if (orderNumber) params.set('tr', orderNumber);
  return `upi://pay?${params.toString()}`;
}

/** Map a server order status to a customer-facing label. */
function statusLabel(status: string): string {
  switch (status) {
    case 'awaiting_payment':
    case 'payment_submitted':
      return 'Waiting for confirmation';
    case 'paid':
    case 'queued':
      return 'In queue';
    case 'printing':
      return 'Printing';
    case 'printed':
      return 'Finishing';
    case 'ready':
      return 'Ready for pickup';
    case 'collected':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** Rough "minutes left" estimate based on order status. */
function estimateMinutesLeft(status: string, pageCount: number): number {
  if (status === 'ready' || status === 'collected') return 0;
  if (status === 'printing') return Math.max(1, Math.ceil(pageCount / 10));
  return Math.max(3, Math.ceil(pageCount / 5) + 2);
}

/* ── Component ──────────────────────────────────────────────────────── */

export function ReferenceCustomerFlow(props: ReferenceCustomerFlowProps) {
  const {
    shopSlug,
    shopName,
    upiId,
    bwPrice,
    colorPrice,
    hours,
    waitMinutes,
    printerCount,
    shopPhone,
    shopAddress,
  } = props;

  const [step, setStep] = useState<Step>('landing');
  // Clear design: mobile boards render under 1024px, desktop boards
  // (dtop + two-column wrap) from 1024px. JS-driven, same pattern as
  // ReferenceColorPages.
  const [isDesktop, setIsDesktop] = useState(false);
  const [files, setFiles] = useState<FlowFile[]>([]);
  const [draft, setDraft] = useState<DraftHandle | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<PresetId>('mix');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [utr, setUtr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [trackStatus, setTrackStatus] = useState<string>('awaiting_payment');
  const [trackPages, setTrackPages] = useState<number>(0);
  const [waitElapsed, setWaitElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect viewport (desktop boards ≥1024px)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /* ── Step indicator (3 dots for files/options/review) ── */
  const dotsStep: 0 | 1 | 2 | null =
    step === 'files' ? 0 : step === 'options' ? 1 : step === 'review' ? 2 : null;

  /* ── Hidden file input trigger ── */
  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /* ── Upload one file via the chunked upload API ── */
  const uploadOne = useCallback(
    async (file: globalThis.File, handle: DraftHandle) => {
      // 1. Init a fresh upload session.
      const initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          orderId: handle.orderId,
          orderToken: handle.orderToken,
        }),
      });
      const init = (await initRes.json()) as {
        data?: { fileId: string; uploadId: string };
        error?: { message?: string };
      };
      if (!initRes.ok || !init.data) {
        throw new Error(init?.error?.message ?? 'Upload init failed');
      }
      const { fileId, uploadId } = init.data;

      // Seed the UI row with progress=0 so the customer sees the file appear.
      setFiles((fs) => [
        ...fs,
        {
          fileId,
          uploadId,
          name: file.name,
          sizeBytes: file.size,
          progress: 0,
          status: 'uploading',
          pageCount: null,
          colorPages: 0,
        },
      ]);

      // 2. Upload each chunk (with checksum).
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const checksum = await sha256Hex(chunk);
        const res = await fetch(
          `/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}&index=${index}&checksum=${checksum}`,
          { method: 'PUT', body: chunk },
        );
        if (!res.ok) {
          const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
          throw new Error(e?.error?.message ?? 'Chunk upload failed');
        }
        setFiles((fs) =>
          fs.map((f) =>
            f.fileId === fileId ? { ...f, progress: Math.round((end / file.size) * 100) } : f,
          ),
        );
      }

      // 3. Complete → triggers server-side assembly + pipeline.
      setFiles((fs) => fs.map((f) => (f.fileId === fileId ? { ...f, status: 'converting' } : f)));
      const compRes = await fetch(`/api/v1/s/${shopSlug}/uploads/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (!compRes.ok) {
        const e = (await compRes.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(e?.error?.message ?? 'Processing failed');
      }
      // The pipeline now runs in the background; the file-status poll below
      // will pick up the READY transition + pageCount.
    },
    [shopSlug],
  );

  /* ── Pick files from the hidden input ── */
  const onPick = useCallback(
    async (picked: FileList | File[]) => {
      const list = Array.from(picked);
      if (list.length === 0) return;
      setError(null);
      // AUDIT P0-2: client-side type gate. The accept attribute only filters
      // the OS picker — drag-and-drop and programmatic picks bypass it, so
      // validate the extension here (same supported set as the pipeline).
      const SUPPORTED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|docx?|pptx?|xlsx?)$/i;
      const rejected = list.filter((f) => !SUPPORTED_EXT.test(f.name));
      if (rejected.length > 0) {
        setError(`Unsupported file type: ${rejected.map((f) => f.name).join(', ')}. Supported: PDF, JPG, PNG, WEBP, HEIC, DOCX, DOC, PPTX, XLSX.`);
        if (rejected.length === list.length) return;
      }
      const uploadable = list.filter((f) => SUPPORTED_EXT.test(f.name));
      try {
        let handle = draft;
        if (!handle) {
          // init creates the draft order on the first file
          const first = uploadable[0]!;
          const initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: first.name,
              mimeType: first.type || 'application/octet-stream',
              sizeBytes: first.size,
            }),
          });
          const init = (await initRes.json()) as {
            data?: { orderId: string; orderToken: string; fileId: string; uploadId: string };
            error?: { message?: string };
          };
          if (!initRes.ok || !init.data) {
            throw new Error(init?.error?.message ?? 'Upload init failed');
          }
          handle = { orderId: init.data.orderId, orderToken: init.data.orderToken };
          setDraft(handle);

          // Seed the first file row, then chunk-upload it (init already
          // created the fileId for the first file, so we go straight to
          // chunk uploads for that file).
          const { fileId: firstFileId, uploadId: firstUploadId } = init.data;
          setFiles((fs) => [
            ...fs,
            {
              fileId: firstFileId,
              uploadId: firstUploadId,
              name: first.name,
              sizeBytes: first.size,
              progress: 0,
              status: 'uploading',
              pageCount: null,
              colorPages: 0,
            },
          ]);

          // Chunk-upload the first file.
          const totalChunks = Math.max(1, Math.ceil(first.size / CHUNK_SIZE));
          for (let index = 0; index < totalChunks; index++) {
            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, first.size);
            const chunk = first.slice(start, end);
            const checksum = await sha256Hex(chunk);
            const res = await fetch(
              `/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${firstUploadId}&index=${index}&checksum=${checksum}`,
              { method: 'PUT', body: chunk },
            );
            if (!res.ok) {
              const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
              throw new Error(e?.error?.message ?? 'Chunk upload failed');
            }
            setFiles((fs) =>
              fs.map((f) =>
                f.fileId === firstFileId
                  ? { ...f, progress: Math.round((end / first.size) * 100) }
                  : f,
              ),
            );
          }

          setFiles((fs) =>
            fs.map((f) => (f.fileId === firstFileId ? { ...f, status: 'converting' } : f)),
          );
          const compRes = await fetch(`/api/v1/s/${shopSlug}/uploads/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId: firstUploadId }),
          });
          if (!compRes.ok) {
            const e = (await compRes.json().catch(() => null)) as { error?: { message?: string } };
            throw new Error(e?.error?.message ?? 'Processing failed');
          }

          // Upload any remaining picked files via the multi-file path.
          for (const f of uploadable.slice(1)) {
            await uploadOne(f, handle);
          }
        } else {
          // Existing draft — upload every picked file.
          for (const f of uploadable) {
            await uploadOne(f, handle);
          }
        }

        // Move to the files screen so the customer sees the upload rows.
        if (step === 'landing') setStep('files');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      }
    },
    [draft, shopSlug, step, uploadOne],
  );

  /* ── Poll converting files until READY ── */
  useEffect(() => {
    if (!draft) return;
    const pending = files.filter((f) => f.status === 'converting' || f.status === 'uploading');
    if (pending.length === 0) {
      if (filePollRef.current) {
        clearTimeout(filePollRef.current);
        filePollRef.current = null;
      }
      return;
    }
    if (filePollRef.current) return; // already polling
    const poll = async () => {
      for (const f of pending) {
        try {
          const res = await fetch(
            `/api/v1/s/${shopSlug}/files/${f.fileId}?token=${draft.orderToken}`,
          );
          if (!res.ok) continue;
          const d = (await res.json()) as {
            data?: {
              status: FlowFile['status'];
              pageCount?: number | null;
              colorSuggestion?: Array<{ page: number; isColor: boolean }> | null;
            };
          };
          if (!d.data) continue;
          if (d.data.status === 'ready') {
            const colorPages = d.data.colorSuggestion?.filter((s) => s.isColor).length ?? 0;
            setFiles((fs) =>
              fs.map((x) =>
                x.fileId === f.fileId
                  ? {
                      ...x,
                      status: 'ready',
                      pageCount: d.data!.pageCount ?? null,
                      colorPages,
                    }
                  : x,
              ),
            );
          } else if (d.data.status === 'failed') {
            setFiles((fs) =>
              fs.map((x) => (x.fileId === f.fileId ? { ...x, status: 'failed' } : x)),
            );
          }
        } catch {
          // network blip — try again next tick
        }
      }
      filePollRef.current = setTimeout(poll, FILE_POLL_MS);
    };
    filePollRef.current = setTimeout(poll, FILE_POLL_MS);
    return () => {
      if (filePollRef.current) {
        clearTimeout(filePollRef.current);
        filePollRef.current = null;
      }
    };
  }, [files, draft, shopSlug]);

  /* ── Derived: ready files + totals ── */
  const readyFiles = files.filter((f) => f.status === 'ready' && (f.pageCount ?? 0) > 0);
  const totalPages = readyFiles.reduce((sum, f) => sum + (f.pageCount ?? 0), 0);
  const totalColorPages = readyFiles.reduce((sum, f) => sum + f.colorPages, 0);
  const totalBwPages = totalPages - totalColorPages;
  const activeFile = readyFiles[0] ?? null;

  /**
   * Local price fallback — used only when the /quote API returns null (e.g.
   * the demo shop has no price rules configured). Computes an estimate from
   * the bwPrice/colorPrice props (parsed back to paise) so the demo flow can
   * proceed end-to-end without server-side pricing rules.
   */
  const bwPaiseFallback = parsePricePaise(bwPrice) ?? 200; // ₹2/page
  const colorPaiseFallback = parsePricePaise(colorPrice) ?? 1000; // ₹10/page
  const fallbackTotalPaise = (() => {
    if (totalPages === 0) return null;
    switch (selectedPreset) {
      case 'notes':
        return Math.ceil(totalPages / 2) * bwPaiseFallback;
      case 'colour':
        return totalPages * colorPaiseFallback;
      case 'photo':
        return colorPaiseFallback * readyFiles.length;
      case 'mix':
        return totalBwPages * bwPaiseFallback + totalColorPages * colorPaiseFallback;
    }
  })();
  const totalPaise = placed?.totalPaise ?? quote?.totalPaise ?? fallbackTotalPaise;

  /* ── Quote: debounced re-quote whenever readyFiles / preset changes ── */
  useEffect(() => {
    if (readyFiles.length === 0 || !draft) {
      setQuote(null);
      return;
    }
    let aborted = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        // Build the spec per file based on the selected preset.
        const bodyFiles = readyFiles.map((f) => {
          const pageCount = f.pageCount ?? 0;
          const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
          let sides: 'SINGLE' | 'DOUBLE' = 'SINGLE';
          const modes: Array<{ page: number; mode: 'color' | 'bw' | 'skip' }> = [];
          switch (selectedPreset) {
            case 'notes':
              sides = 'DOUBLE';
              modes.push(...pages.map((p) => ({ page: p, mode: 'bw' as const })));
              break;
            case 'colour':
              modes.push(...pages.map((p) => ({ page: p, mode: 'color' as const })));
              break;
            case 'photo':
              modes.push(
                ...pages.map((p) => ({
                  page: p,
                  mode: (p === 1 ? 'color' : 'skip') as 'color' | 'skip',
                })),
              );
              break;
            case 'mix':
              // Color where the server suggested, B&W otherwise.
              modes.push(...pages.map((p) => ({ page: p, mode: 'bw' as const })));
              break;
          }
          return {
            fileId: f.fileId,
            spec: {
              pageModes: modes,
              copies: 1,
              sides,
              pagesPerSheet: 1 as const,
              paperSize: 'A4',
              paperType: 'PLAIN',
              collate: true,
            },
          };
        });
        const res = await fetch(`/api/v1/s/${shopSlug}/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: bodyFiles, addonIds: [], urgent: false }),
        });
        const d = (await res.json()) as { data?: Quote; error?: { message?: string } };
        if (aborted) return;
        if (res.ok && d.data) setQuote(d.data);
        else setError(d?.error?.message ?? 'Could not price the order');
      } catch (e) {
        if (!aborted) setError(e instanceof Error ? e.message : 'Could not price the order');
      } finally {
        if (!aborted) setQuoting(false);
      }
    }, 400);
    return () => {
      aborted = true;
      clearTimeout(t);
    };
  }, [readyFiles.map((f) => `${f.fileId}:${f.pageCount}:${f.colorPages}`).join('|'), selectedPreset, draft, shopSlug]);

  /* ── Place the order: PUT specs for each file → POST orders ── */
  const placeOrder = useCallback(async () => {
    if (!draft || placing || readyFiles.length === 0) return;
    const phoneValid = /^[6-9]\d{9}$/.test(phone);
    if (!phoneValid) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (totalPaise == null) {
      setError('Pricing is not ready yet.');
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      // Sync specs for each file.
      for (const f of readyFiles) {
        const pageCount = f.pageCount ?? 0;
        const colorPages: number[] = [];
        const skipPages: number[] = [];
        for (let p = 1; p <= pageCount; p++) {
          if (selectedPreset === 'colour') colorPages.push(p);
          else if (selectedPreset === 'photo' && p > 1) skipPages.push(p);
          else if (selectedPreset === 'mix' && f.colorPages > 0 && p <= f.colorPages) colorPages.push(p);
        }
        const sides: 'SINGLE' | 'DOUBLE' = selectedPreset === 'notes' ? 'DOUBLE' : 'SINGLE';
        const res = await fetch(`/api/v1/s/${shopSlug}/specs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: draft.orderId,
            orderToken: draft.orderToken,
            fileId: f.fileId,
            pageRangeText: '',
            copies: 1,
            sides,
            pagesPerSheet: 1,
            paperSize: 'A4',
            paperType: 'PLAIN',
            collate: true,
            colorPages,
            skipPages,
          }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
          throw new Error(e?.error?.message ?? `Could not save options for ${f.name}`);
        }
      }

      // Place the order.
      const res = await fetch(`/api/v1/s/${shopSlug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: draft.orderId,
          orderToken: draft.orderToken,
          addonIds: [],
          urgent: false,
          customerName: name || null,
          customerPhone: phone.replace(/\D/g, '') || null,
          note: null,
          clientTotalPaise: totalPaise,
        }),
      });
      const d = (await res.json()) as {
        data?: { token: string; orderNumber: string; pickupCode: string; totalPaise: number };
        error?: { message?: string };
      };
      if (!res.ok || !d.data) {
        throw new Error(d?.error?.message ?? 'Could not place the order');
      }
      setPlaced({
        token: d.data.token,
        orderNumber: d.data.orderNumber,
        pickupCode: d.data.pickupCode,
        totalPaise: d.data.totalPaise,
        placedAt: Date.now(),
      });
      setStep('pay');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the order');
    } finally {
      setPlacing(false);
    }
  }, [draft, placing, readyFiles, phone, name, shopSlug, selectedPreset, totalPaise]);

  /* ── Pay: submit UTR via /o/{token}/payment ── */
  const submitPayment = useCallback(
    async (utrValue: string): Promise<boolean> => {
      if (!placed || submitting) return false;
      const clean = utrValue.replace(/\D/g, '').slice(0, 12);
      if (clean.length !== 12) {
        setError('Enter the 12-digit UTR / reference number from your UPI app.');
        return false;
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'upi',
            utr: clean,
            declaredAmountPaise: placed.totalPaise,
          }),
        });
        const d = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) {
          throw new Error(d?.error?.message ?? 'Could not submit the payment');
        }
        setUtr(clean);
        setStep('waiting');
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not submit the payment');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [placed, submitting],
  );

  /* ── Pay at counter: counter_cash (no UTR needed) ── */
  const payAtCounter = useCallback(async () => {
    if (!placed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'counter_cash' }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(d?.error?.message ?? 'Could not switch to counter payment');
      }
      setStep('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch to counter payment');
    } finally {
      setSubmitting(false);
    }
  }, [placed, submitting]);

  /* ── Waiting screen: poll /o/{token} for payment confirmation ── */
  useEffect(() => {
    if (step !== 'waiting' || !placed) return;
    setTrackStatus('awaiting_payment');
    setWaitElapsed(0);
    // Tick the elapsed timer every second.
    waitTimerRef.current = setInterval(() => {
      setWaitElapsed(Math.floor((Date.now() - placed.placedAt) / 1000));
    }, 1000);
    // Poll the order status.
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/o/${placed.token}`);
        if (!res.ok) return;
        const d = (await res.json()) as {
          data?: {
            order?: { status?: string };
            files?: Array<{ pageCount?: number | null }>;
          };
        };
        if (!d.data?.order) return;
        const status = d.data.order.status ?? 'awaiting_payment';
        setTrackStatus(status);
        const pages = (d.data.files ?? []).reduce((s, f) => s + (f.pageCount ?? 0), 0);
        setTrackPages(pages);
        // Confirmed when the shop transitions past awaiting_payment / payment_submitted.
        const confirmed = !['awaiting_payment', 'payment_submitted'].includes(status);
        if (confirmed) {
          if (orderPollRef.current) clearInterval(orderPollRef.current);
          if (waitTimerRef.current) clearInterval(waitTimerRef.current);
          setStep('track');
        }
      } catch {
        // network blip — try again next tick
      }
    };
    void poll();
    orderPollRef.current = setInterval(poll, ORDER_POLL_MS);
    return () => {
      if (orderPollRef.current) clearInterval(orderPollRef.current);
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    };
  }, [step, placed]);

  /* ── Track screen: keep polling for status updates ── */
  useEffect(() => {
    if (step !== 'track' || !placed) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/o/${placed.token}`);
        if (!res.ok) return;
        const d = (await res.json()) as {
          data?: {
            order?: { status?: string };
            files?: Array<{ pageCount?: number | null }>;
          };
        };
        if (!d.data?.order) return;
        setTrackStatus(d.data.order.status ?? 'awaiting_payment');
        const pages = (d.data.files ?? []).reduce((s, f) => s + (f.pageCount ?? 0), 0);
        setTrackPages(pages);
      } catch {
        // ignore
      }
    };
    orderPollRef.current = setInterval(poll, ORDER_POLL_MS);
    return () => {
      if (orderPollRef.current) clearInterval(orderPollRef.current);
    };
  }, [step, placed]);

  /* ── Cancel order ── */
  const cancelOrder = useCallback(async () => {
    if (!placed) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/o/${placed.token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer cancelled from tracking screen.' }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(d?.error?.message ?? 'Could not cancel the order');
      }
      setTrackStatus('cancelled');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the order');
    }
  }, [placed]);

  /* ── UTR entry (I've paid / re-enter) — inline sheet. This replaces
     window.prompt(): prompt() is suppressed by several mobile in-app
     browsers and by automated browsers, which made "I've paid" look dead.
     The API contract is unchanged (POST /o/{token}/payment). ── */
  const [utrSheetOpen, setUtrSheetOpen] = useState(false);
  const [utrDraft, setUtrDraft] = useState('');

  const openUtrSheet = useCallback(() => {
    setUtrDraft(utr);
    setUtrSheetOpen(true);
  }, [utr]);

  const submitUtrFromSheet = useCallback(async () => {
    const ok = await submitPayment(utrDraft);
    if (ok) setUtrSheetOpen(false);
  }, [submitPayment, utrDraft]);

  /* ── Copy shop UPI ID to clipboard ── */
  const copyUpiId = useCallback(() => {
    if (!upiId) return;
    try {
      void navigator.clipboard?.writeText(upiId);
    } catch {
      // ignore
    }
  }, [upiId]);

  /* ── Build a 3-dot step indicator (`<i class="on">` for completed steps) ── */
  const StepDots = () => {
    if (dotsStep === null) return null;
    return (
      <div className="ref-st">
        <i className={dotsStep >= 0 ? 'on' : ''} />
        <i className={dotsStep >= 1 ? 'on' : ''} />
        <i className={dotsStep >= 2 ? 'on' : ''} />
      </div>
    );
  };

  /* ── Per-preset price estimate (for the options screen rows) ── */
  const presetPrice = useCallback(
    (preset: PresetId): string => {
      const bwPaise = parsePricePaise(bwPrice) ?? 200;
      const colorPaise = parsePricePaise(colorPrice) ?? 1000;
      const pages = activeFile?.pageCount ?? 0;
      if (pages === 0) return '—';
      switch (preset) {
        case 'notes':
          return formatRupees(Math.ceil(pages / 2) * bwPaise);
        case 'colour':
          return formatRupees(pages * colorPaise);
        case 'photo':
          return formatRupees(colorPaise);
        case 'mix':
          // Use the live quote total when available; fall back to the local
          // mix estimate when the shop has no pricing rules (demo env).
          return formatRupees(quote?.totalPaise ?? (totalBwPages * bwPaise + totalColorPages * colorPaise));
      }
    },
    [bwPrice, colorPrice, activeFile, quote, totalBwPages, totalColorPages],
  );

  /* ── File description for the review screen ── */
  const fileDesc = useCallback((f: FlowFile): string => {
    const pageCount = f.pageCount ?? 0;
    const color = f.colorPages;
    const bw = pageCount - color;
    if (selectedPreset === 'notes') return `${pageCount} pages · B&W · double-sided`;
    if (selectedPreset === 'colour') return `${pageCount} pages · all colour`;
    if (selectedPreset === 'photo') return `1 page · colour · single-sided`;
    return `${pageCount} pages · ${bw} B&W · ${color} colour`;
  }, [selectedPreset]);

  /* ── Order timeline (track screen) ── */
  const timeline = [
    { label: 'Order placed', detail: '', done: true, current: false },
    {
      label: 'Payment confirmed',
      detail: '',
      done: ['paid', 'queued', 'printing', 'printed', 'ready', 'collected'].includes(trackStatus),
      current: trackStatus === 'paid' || trackStatus === 'queued',
    },
    {
      label: 'Printing',
      detail: trackPages > 0 ? `${trackPages} pages` : '',
      done: ['printing', 'printed', 'ready', 'collected'].includes(trackStatus),
      current: trackStatus === 'printing' || trackStatus === 'printed',
    },
    {
      label: 'Ready for pickup',
      detail: '',
      done: ['ready', 'collected'].includes(trackStatus),
      current: trackStatus === 'ready',
    },
  ];

  /* ══════════════════════════════════════════════════════════════════
     RENDER — pick the screen by `step`
     ══════════════════════════════════════════════════════════════════ */

  // Hidden file input — used by the "Add files" buttons on landing + files.
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style={{ display: 'none' }}
      onChange={(e) => {
        if (e.target.files) void onPick(e.target.files);
        // Reset so picking the same file twice still fires onChange.
        e.target.value = '';
      }}
    />
  );

  return (
    <>
      {hiddenInput}

      {error && (
        <div
          role="alert"
          style={{
            margin: '16px 20px 0',
            padding: '12px 14px',
            background: '#FBE3E1',
            color: '#9C1F18',
            borderRadius: '12px',
            fontSize: '14px',
            lineHeight: 1.4,
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: '8px', background: 'transparent', border: 0, color: '#9C1F18', fontWeight: 600, cursor: 'pointer' }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Screen 01: Landing ── */}
      {step === 'landing' && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}, open</div>
          <h1 className="ref-h">Print without the queue</h1>
          <p className="ref-sub">{printerCount} {printerCount === 1 ? 'printer' : 'printers'} online, about {waitMinutes} min wait</p>
          <div className="ref-g p" style={{ textAlign: 'center', padding: '28px 16px' }}>
            <div style={{ fontSize: '17px', fontWeight: 600 }}>Add files to print</div>
            <div className="ref-v" style={{ textAlign: 'center', margin: '4px 0 16px' }}>
              PDF, photos or Word files
            </div>
            <button type="button" className="ref-btn" style={{ width: '100%' }} onClick={triggerFileInput}>
              Add files
            </button>
          </div>
          <div className="ref-g">
            <div className="ref-r">
              <span>Black &amp; white<small>per page</small></span>
              <b style={{ fontSize: '20px' }}>{bwPrice}</b>
            </div>
            <div className="ref-r">
              <span>Colour<small>per page</small></span>
              <b style={{ fontSize: '20px' }}>{colorPrice}</b>
            </div>
            <div className="ref-r">
              <span>Double-sided</span>
              <span className="ref-v">Costs less per page</span>
            </div>
          </div>
          <div className="ref-g">
            <div className="ref-r">
              <span>Open today</span>
              <span className="ref-v" style={{ whiteSpace: 'nowrap' }}>{hours}</span>
            </div>
            <div className="ref-r">
              <a
                href={shopPhone ? `tel:${shopPhone}` : '#'}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                Call shop
              </a>
              <a
                className="ref-v"
                href={shopAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions
              </a>
            </div>
          </div>
          <p className="ref-cap">Your files are deleted 24 hours after pickup.</p>
        </div>
      )}

      {/* ── Screen 01: Landing — desktop (board 32) ── */}
      {step === 'landing' && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}, open</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <h1 className="ref-h1">Print without the queue</h1>
              <p className="ref-s2">{printerCount} {printerCount === 1 ? 'printer' : 'printers'} online, about {waitMinutes} min wait</p>
              <div className="ref-g p" style={{ textAlign: 'center', padding: '48px 16px' }}>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>Add files to print</div>
                <div className="ref-v" style={{ textAlign: 'center', margin: '6px 0 20px' }}>
                  PDF, photos or Word files
                </div>
                {/* board 32: compact centred pill, not a full-width bar */}
                <button type="button" className="ref-bt" style={{ width: 220, margin: '0 auto' }} onClick={triggerFileInput}>
                  Add files
                </button>
              </div>
            </div>
            <div className="ref-rt">
              <div className="ref-g">
                <div className="ref-r">
                  <span>Black &amp; white<small>per page</small></span>
                  <span className="ref-v">{bwPrice}</span>
                </div>
                <div className="ref-r">
                  <span>Colour<small>per page</small></span>
                  <span className="ref-v">{colorPrice}</span>
                </div>
                <div className="ref-r">
                  <span>Double-sided</span>
                  <span className="ref-v">Costs less</span>
                </div>
              </div>
              <div className="ref-g">
                <div className="ref-r">
                  <span>Open today</span>
                  <span className="ref-v" style={{ whiteSpace: 'nowrap' }}>{hours}</span>
                </div>
                <div className="ref-r">
                  <a href={shopPhone ? `tel:${shopPhone}` : '#'} style={{ color: 'inherit', textDecoration: 'none' }}>
                    Call shop
                  </a>
                  <a
                    className="ref-v"
                    href={shopAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Directions
                  </a>
                </div>
              </div>
              <p className="ref-cap">Your files are deleted 24 hours after pickup.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 02: Files ── */}
      {step === 'files' && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <StepDots />
          <h1 className="ref-h">Your files</h1>
          <p className="ref-sub">Step 1 of 3</p>

          {/* Error banner — dismissible, with retry */}
          {error && (
            <div style={{
              margin: '12px 20px 0',
              background: '#FBE3E1',
              color: '#9C1F18',
              borderRadius: '12px',
              padding: '12px 14px',
              fontSize: '14px',
              lineHeight: '1.4',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}>
              <span style={{ flex: 1 }}>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
                style={{
                  border: '0',
                  background: 'transparent',
                  color: '#9C1F18',
                  fontSize: '18px',
                  lineHeight: '1',
                  cursor: 'pointer',
                  padding: '0 0 0 4px',
                  flex: 'none',
                }}
              >
                ×
              </button>
            </div>
          )}

          <div className="ref-g">
            {files.length === 0 && (
              <div className="ref-r">
                <span>No files yet<small>Tap "Add more files" to upload</small></span>
              </div>
            )}
            {files.map((f) => {
              const sizeMb = formatBytes(f.sizeBytes);
              const fileExt = f.name.split('.').pop()?.toLowerCase() ?? '';
              const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);
              const truncatedName = f.name.length > 28 ? f.name.slice(0, 25) + '…' : f.name;

              if (f.status === 'ready') {
                return (
                  <div className="ref-r" key={f.fileId}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isImage ? '🖼️ ' : '📄 '}{truncatedName}
                      <small>{f.pageCount ?? 0} {f.pageCount === 1 ? 'page' : 'pages'}, {sizeMb}</small>
                    </span>
                    <span className="ref-chip ok">Ready</span>
                  </div>
                );
              }
              if (f.status === 'failed') {
                return (
                  <div className="ref-r" key={f.fileId}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isImage ? '🖼️ ' : '📄 '}{truncatedName}
                      <small>Failed to process — tap to retry</small>
                    </span>
                    <span className="ref-chip rd">Failed</span>
                  </div>
                );
              }
              // Uploading or converting
              const isConverting = f.status === 'converting';
              const isUploading = f.status === 'uploading';
              return (
                  <div className="ref-r" key={f.fileId}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isImage ? '🖼️ ' : '📄 '}{truncatedName}
                      <small>{isUploading && f.progress < 100 ? `Uploading… ${f.progress}%` : isConverting || (isUploading && f.progress >= 100) ? 'Processing…' : 'Uploading…'}</small>
                    </span>
                    {isUploading && f.progress < 100 ? (
                      <span className="ref-chip">{f.progress}%</span>
                    ) : (
                      <span className="ref-chip">Processing</span>
                    )}
                  </div>
                );
            })}
          </div>
          <div className="ref-g" style={{ padding: 0 }}>
            <button
              type="button"
              className="ref-btn s"
              style={{ width: '100%', borderRadius: '22px', height: '56px' }}
              onClick={triggerFileInput}
            >
              Add more files
            </button>
          </div>
          <div className="ref-bar">
            <div style={{ flex: 1 }}>
              <small>{files.length} {files.length === 1 ? 'file' : 'files'}</small>
              <b>{totalPages > 0 ? `${totalPages} ${totalPages === 1 ? 'page' : 'pages'}` : 'Processing…'}</b>
            </div>
            <button
              type="button"
              className="ref-btn"
              disabled={readyFiles.length === 0}
              onClick={() => setStep('options')}
            >
              {readyFiles.length === 0 ? 'Waiting for files…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 02: Files — desktop (board 33) ── */}
      {step === 'files' && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <div className="ref-st">
                <i className={dotsStep !== null && dotsStep >= 0 ? 'on' : ''}></i>
                <i className={dotsStep !== null && dotsStep >= 1 ? 'on' : ''}></i>
                <i></i>
              </div>
              <h1 className="ref-h1" style={{ marginTop: 12 }}>Your files</h1>
              <p className="ref-s2">Step 1 of 3</p>
              {error && (
                <div style={{ background: '#FBE3E1', color: '#9C1F18', borderRadius: 12, padding: '12px 14px', fontSize: 14, marginTop: 12, display: 'flex', gap: 8 }}>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" style={{ border: 0, background: 'transparent', color: '#9C1F18', fontSize: 18, cursor: 'pointer' }}>×</button>
                </div>
              )}
              <div className="ref-g">
                {files.length === 0 && (
                  <div className="ref-r"><span>No files yet<small>Tap "Add more files" to upload</small></span></div>
                )}
                {files.map((f) => {
                  const sizeMb = formatBytes(f.sizeBytes);
                  const truncatedName = f.name.length > 34 ? f.name.slice(0, 31) + '…' : f.name;
                  return (
                    <div className="ref-r" key={f.fileId}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncatedName}
                        <small>
                          {f.status === 'ready'
                            ? `${f.pageCount ?? 0} ${f.pageCount === 1 ? 'page' : 'pages'}, ${sizeMb}`
                            : f.status === 'failed'
                              ? 'Failed to process — tap to retry'
                              : f.status === 'uploading' && f.progress < 100
                                ? `Uploading… ${f.progress}%`
                                : 'Preparing your file'}
                        </small>
                      </span>
                      {f.status === 'ready' && <span className="ref-chip ok">Ready</span>}
                      {f.status === 'failed' && <span className="ref-chip rd">Failed</span>}
                      {(f.status === 'uploading' || f.status === 'converting') && (
                        <span className="ref-chip">{f.status === 'uploading' && f.progress < 100 ? `${f.progress}%` : 'Preparing'}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 16 }}>
                <button type="button" className="ref-bt s" onClick={triggerFileInput}>Add more files</button>
              </div>
            </div>
            <div className="ref-rt">
              <div className="ref-g p">
                <div className="ref-v">{files.length} {files.length === 1 ? 'file' : 'files'}</div>
                <b style={{ fontSize: 28, display: 'block', marginTop: 4 }}>{totalPages > 0 ? `${totalPages} ${totalPages === 1 ? 'page' : 'pages'}` : 'Processing…'}</b>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="ref-bt"
                    style={{ display: 'block', width: '100%' }}
                    disabled={readyFiles.length === 0}
                    onClick={() => setStep('options')}
                  >
                    {readyFiles.length === 0 ? 'Waiting for files…' : 'Continue'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 03: Options (print style) ── */}
      {step === 'options' && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <StepDots />
          <h1 className="ref-h">How should we print it?</h1>
          <p className="ref-sub">
            Step 2 of 3{activeFile ? `, ${activeFile.name}` : ''}
          </p>
          <div className="ref-g">
            {PRESETS.map((p) => {
              const on = selectedPreset === p.id;
              return (
                <div className="ref-r" key={p.id} onClick={() => setSelectedPreset(p.id)} style={{ cursor: 'pointer' }}>
                  <span className={`ref-rad${on ? ' on' : ''}`}></span>
                  <span style={{ flex: 1 }}>
                    {p.name}
                    <small>{p.description}{p.id === 'mix' && totalColorPages > 0 ? ` · ${totalColorPages} pages look colourful` : ''}</small>
                  </span>
                  <b>{presetPrice(p.id)}</b>
                </div>
              );
            })}
          </div>
          <div className="ref-g">
            <div className="ref-r">
              <span>Pages</span>
              <span className="ref-v">All {totalPages}</span>
            </div>
            <div className="ref-r">
              <span>More options<small>Copies, paper, binding</small></span>
              <span className="ref-v">1 copy</span>
            </div>
          </div>
          <div className="ref-bar">
            <div style={{ flex: 1 }}>
              <small>{totalBwPages} B&amp;W, {totalColorPages} colour</small>
              <b>{formatRupees(totalPaise)}</b>
            </div>
            <button
              type="button"
              className="ref-btn"
              disabled={quoting || totalPaise == null}
              onClick={() => setStep('colorpages')}
            >
              Choose colour pages
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 03: Options — desktop (board 34) ── */}
      {step === 'options' && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <div className="ref-st">
                <i className="on"></i>
                <i className="on"></i>
                <i></i>
              </div>
              <h1 className="ref-h1" style={{ marginTop: 12 }}>How should we print it?</h1>
              <p className="ref-s2">Step 2 of 3{activeFile ? `, ${activeFile.name}` : ''}</p>
              <div className="ref-g">
                {PRESETS.map((p) => {
                  const on = selectedPreset === p.id;
                  return (
                    <div className="ref-r" key={p.id} onClick={() => setSelectedPreset(p.id)} style={{ cursor: 'pointer' }}>
                      <span className={`ref-rad${on ? ' on' : ''}`}></span>
                      <span style={{ flex: 1 }}>
                        {p.name}
                        <small>{p.description}{p.id === 'mix' && totalColorPages > 0 ? ` · ${totalColorPages} pages look colourful` : ''}</small>
                      </span>
                      <b>{presetPrice(p.id)}</b>
                    </div>
                  );
                })}
              </div>
              <div className="ref-g">
                <div className="ref-r">
                  <span>Pages</span>
                  <span className="ref-v">All {totalPages}</span>
                </div>
                <div className="ref-r">
                  <span>More options<small>Copies, paper, binding</small></span>
                  <span className="ref-v">›</span>
                </div>
              </div>
            </div>
            <div className="ref-rt">
              <div className="ref-g p">
                <div className="ref-r">
                  <span>{totalBwPages} B&amp;W pages</span>
                  <span className="ref-v">{formatRupees((parsePricePaise(bwPrice) ?? 200) * totalBwPages)}</span>
                </div>
                <div className="ref-r">
                  <span>{totalColorPages} colour pages</span>
                  <span className="ref-v">{formatRupees((parsePricePaise(colorPrice) ?? 1000) * totalColorPages)}</span>
                </div>
                <div className="ref-r">
                  <span><b>Total</b></span>
                  <span className="ref-v"><b>{formatRupees(totalPaise)}</b></span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="ref-bt"
                    style={{ display: 'block', width: '100%' }}
                    disabled={quoting || totalPaise == null}
                    onClick={() => setStep('colorpages')}
                  >
                    Choose colour pages
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 13/08: Color Pages (B Clear / Desktop Builder) ── */}
      {step === 'colorpages' && readyFiles.length > 0 && (
        <ReferenceColorPages
          shopName={shopName}
          shopSlug={shopSlug}
          files={readyFiles.map((f) => ({
            fileId: f.fileId,
            fileName: f.name,
            pageCount: f.pageCount || 1,
            initialColorPages: Array.from(
              { length: Math.min(f.colorPages || 0, f.pageCount || 1) },
              (_, i) => i + 1,
            ),
          }))}
          bwPrice={bwPaiseFallback}
          colorPrice={colorPaiseFallback}
          copies={1}
          sides="SINGLE"
          paperSize="A4"
          duplex={selectedPreset === 'notes'}
          onReview={() => setStep('review')}
          onBack={() => setStep('options')}
        />
      )}

      {/* ── Screen 04: Review ── */}
      {step === 'review' && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <StepDots />
          <h1 className="ref-h">Review order</h1>
          <p className="ref-sub">Step 3 of 3</p>
          <div className="ref-g">
            {readyFiles.map((f) => (
              <div className="ref-r" key={f.fileId}>
                <span>
                  {f.name}
                  <small>{fileDesc(f)}</small>
                </span>
                <b>{formatRupees(totalPaise)}</b>
              </div>
            ))}
            <div className="ref-r">
              <b>Total</b>
              <b>{formatRupees(totalPaise)}</b>
            </div>
          </div>
          <div className="ref-g p">
            <label style={{ fontSize: '14px', fontWeight: 600 }}>Mobile number</label>
            <input
              className="ref-in"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            />
            <label style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginTop: '14px' }}>
              Name (optional)
            </label>
            <input
              className="ref-in"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="ref-cap">You pay the shop directly by UPI. No extra fees.</p>
          <div className="ref-bar">
            <div style={{ flex: 1 }}>
              <small>{readyFiles.length} {readyFiles.length === 1 ? 'file' : 'files'}, {totalPages} {totalPages === 1 ? 'page' : 'pages'}</small>
              <b>{formatRupees(totalPaise)}</b>
            </div>
            <button
              type="button"
              className="ref-btn"
              disabled={placing || totalPaise == null}
              onClick={() => void placeOrder()}
            >
              {placing ? 'Placing…' : `Pay ${formatRupees(totalPaise)}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 04: Review — desktop (derived: files + details left, total + Pay right) ── */}
      {step === 'review' && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <div className="ref-st">
                <i className="on"></i>
                <i className="on"></i>
                <i className="on"></i>
              </div>
              <h1 className="ref-h1" style={{ marginTop: 12 }}>Review order</h1>
              <p className="ref-s2">Step 3 of 3</p>
              <div className="ref-g">
                {readyFiles.map((f) => (
                  <div className="ref-r" key={f.fileId}>
                    <span>{f.name}<small>{fileDesc(f)}</small></span>
                    <b>{formatRupees(totalPaise)}</b>
                  </div>
                ))}
              </div>
              <div className="ref-g p">
                <label htmlFor="rv-phone" style={{ fontSize: '14px', fontWeight: 600 }}>Mobile number</label>
                <input
                  id="rv-phone"
                  className="ref-in"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                />
                <label htmlFor="rv-name" style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginTop: '14px' }}>Name (optional)</label>
                <input
                  id="rv-name"
                  className="ref-in"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <p className="ref-cap">You pay the shop directly by UPI. No extra fees.</p>
            </div>
            <div className="ref-rt">
              <div className="ref-g p">
                <div className="ref-v">{readyFiles.length} {readyFiles.length === 1 ? 'file' : 'files'}, {totalPages} {totalPages === 1 ? 'page' : 'pages'}</div>
                <b style={{ fontSize: 28, display: 'block', marginTop: 4 }}>{formatRupees(totalPaise)}</b>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="ref-bt"
                    style={{ display: 'block', width: '100%' }}
                    disabled={placing || totalPaise == null}
                    onClick={() => void placeOrder()}
                  >
                    {placing ? 'Placing…' : `Pay ${formatRupees(totalPaise)}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 05: Pay ── */}
      {step === 'pay' && placed && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <h1 className="ref-h">Pay {formatRupees(placed.totalPaise)}</h1>
          <p className="ref-sub">Choose your UPI app</p>
          {/* Real UPI intent links (audit P1: these rows were static divs —
              "Open" labels with no action). On a phone each row launches the
              chosen app with the shop's VPA + amount prefilled. On desktop
              the OS cannot handle upi:// — the Copy UPI ID row below is the
              universal path, so the rows degrade gracefully there. */}
          <div className="ref-g">
            {[
              { label: 'Google Pay' },
              { label: 'PhonePe' },
              { label: 'Paytm' },
              { label: 'BHIM' },
              { label: 'Other UPI apps' },
            ].map((app) => (
              <a
                key={app.label}
                className="ref-r"
                href={upiIntentUrl(upiId, placed.totalPaise, placed.orderNumber)}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span>{app.label}</span>
                <span className="ref-v">Open</span>
              </a>
            ))}
          </div>
          <div className="ref-g">
            <div className="ref-r">
              <span>Shop UPI ID<small>{upiId}</small></span>
              <button
                type="button"
                className="ref-chip"
                onClick={copyUpiId}
                style={{ border: 0, cursor: 'pointer' }}
              >
                Copy
              </button>
            </div>
          </div>
          <p className="ref-cap">After you pay, come back here and tap I&apos;ve paid.</p>
          <div className="ref-bar">
            <button
              type="button"
              className="ref-btn s"
              style={{ flex: 1 }}
              disabled={submitting}
              onClick={() => void payAtCounter()}
            >
              Pay at counter
            </button>
            <button
              type="button"
              className="ref-btn"
              disabled={submitting}
              onClick={openUtrSheet}
            >
              {submitting ? 'Submitting…' : "I've paid"}
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 05: Pay — desktop (board 35) ── */}
      {step === 'pay' && placed && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <div className="ref-st">
                <i className="on"></i>
                <i className="on"></i>
                <i className="on"></i>
              </div>
              <h1 className="ref-h1" style={{ marginTop: 12 }}>Pay {formatRupees(placed.totalPaise)}</h1>
              <p className="ref-s2">Open your UPI app, or scan the code.</p>
              <div className="ref-g">
                {[
                  { label: 'Google Pay' },
                  { label: 'PhonePe' },
                  { label: 'Paytm' },
                  { label: 'BHIM' },
                  { label: 'Other UPI apps' },
                ].map((app) => (
                  <a
                    key={app.label}
                    className="ref-r"
                    href={upiIntentUrl(upiId, placed.totalPaise, placed.orderNumber)}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span>{app.label}</span>
                    <span className="ref-v">Open</span>
                  </a>
                ))}
              </div>
              <div className="ref-g">
                <div className="ref-r">
                  <span>Mobile number</span>
                  <span className="ref-v">{phone || '—'}</span>
                </div>
                <div className="ref-r">
                  <span>Name<small>Optional</small></span>
                  <span className="ref-v">{name || '—'}</span>
                </div>
              </div>
            </div>
            <div className="ref-rt">
              <div className="ref-g p">
                <div className="ref-v" style={{ textAlign: 'center' }}>Scan with any UPI app</div>
                <div className="ref-qr" aria-hidden="true" />
                <div className="ref-r">
                  <span>Shop UPI ID<small>{upiId}</small></span>
                  <span className="ref-v">
                    <button type="button" className="ref-chip" onClick={copyUpiId} style={{ border: 0, cursor: 'pointer' }}>Copy</button>
                  </span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="ref-bt"
                    style={{ display: 'block', width: '100%' }}
                    disabled={submitting}
                    onClick={openUtrSheet}
                  >
                    {submitting ? 'Submitting…' : "I've paid"}
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="ref-bt s"
                    style={{ display: 'block', width: '100%' }}
                    disabled={submitting}
                    onClick={() => void payAtCounter()}
                  >
                    Pay at counter
                  </button>
                </div>
              </div>
              <p className="ref-cap">You pay the shop directly. No extra fees.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 06: Waiting ── */}
      {step === 'waiting' && placed && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <h1 className="ref-h">Waiting for the shop</h1>
          <p className="ref-sub">{shopName} will confirm your payment.</p>
          <div className="ref-g">
            <div className="ref-r">
              <span>Amount</span>
              <b>{formatRupees(placed.totalPaise)}</b>
            </div>
            <div className="ref-r">
              <span>UTR</span>
              <span className="ref-v">{utr || '—'}</span>
            </div>
            <div className="ref-r">
              <span>Waiting</span>
              <span className="ref-chip a">{formatElapsed(waitElapsed)}</span>
            </div>
          </div>
          <p className="ref-cap">
            This page updates by itself. You can close it and come back from your order link.
          </p>
          <div className="ref-bar">
            <button type="button" className="ref-btn s" style={{ flex: 1 }} onClick={() => {
              if (shopPhone) window.location.href = `tel:${shopPhone}`;
            }}>
              Call shop
            </button>
            <button type="button" className="ref-btn k" onClick={openUtrSheet}>
              Enter UTR again
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 06: Waiting — desktop (board 36) ── */}
      {step === 'waiting' && placed && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <h1 className="ref-h1">Waiting for the shop</h1>
              <p className="ref-s2">{shopName} will confirm your payment.</p>
              <div className="ref-g">
                <div className="ref-r">
                  <span>Amount</span>
                  <span className="ref-v"><b>{formatRupees(placed.totalPaise)}</b></span>
                </div>
                <div className="ref-r">
                  <span>UTR</span>
                  <span className="ref-v">{utr || '—'}</span>
                </div>
                <div className="ref-r">
                  <span>Waiting</span>
                  <span className="ref-v"><span className="ref-chip a">{formatElapsed(waitElapsed)}</span></span>
                </div>
              </div>
              <p className="ref-cap">This page updates by itself. You can close it and come back from your order link.</p>
            </div>
            <div className="ref-rt">
              <div className="ref-g">
                <a className="ref-r" href={shopPhone ? `tel:${shopPhone}` : '#'} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span>Call shop</span>
                  <span className="ref-v">›</span>
                </a>
                <button type="button" className="ref-r" onClick={openUtrSheet} style={{ cursor: 'pointer' }}>
                  <span>Enter UTR again</span>
                  <span className="ref-v">›</span>
                </button>
                <button type="button" className="ref-r" onClick={() => void payAtCounter()} style={{ cursor: 'pointer' }}>
                  <span>Pay at counter</span>
                  <span className="ref-v">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UTR entry sheet (inline — replaces window.prompt) ── */}
      {utrSheetOpen && placed && (
        <div className="ref-utrsheet" role="dialog" aria-modal="true" aria-label="Enter UTR">
          <div className="ref-utrsheet-card">
            <h2 className="ref-h" style={{ fontSize: 20, margin: 0 }}>Enter UTR</h2>
            <p className="ref-cap">The 12-digit reference number shown in your UPI app after payment.</p>
            <input
              className="ref-in"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="12-digit UTR"
              aria-label="12-digit UTR"
              value={utrDraft}
              autoFocus
              onChange={(e) => setUtrDraft(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            {error && <p className="ref-cap" role="alert">{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ref-btn s" style={{ flex: 1 }} onClick={() => setUtrSheetOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ref-btn"
                style={{ flex: 1 }}
                disabled={utrDraft.length !== 12 || submitting}
                onClick={() => void submitUtrFromSheet()}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Screen 07: Track ── */}
      {step === 'track' && placed && !isDesktop && (
        <div className="ref-screen m">
          <div className="ref-top"><i className="ref-dot"></i>{shopName}</div>
          <h1 className="ref-h">Order {placed.orderNumber}</h1>
          <p className="ref-sub">
            {statusLabel(trackStatus)}, about {estimateMinutesLeft(trackStatus, trackPages)} min left
          </p>
          <div className="ref-g p">
            <div className="ref-v" style={{ textAlign: 'center' }}>Pickup code</div>
            <div className="ref-code">{placed.pickupCode}</div>
            <div className="ref-perf"></div>
            <div className="ref-v" style={{ textAlign: 'center' }}>Show this at the counter</div>
          </div>
          <div className="ref-g">
            {timeline.map((t) => (
              <div className="ref-r" key={t.label}>
                <span className={`ref-rad${t.done ? ' dn' : t.current ? ' on' : ''}`}></span>
                <span style={{ flex: 1 }}>
                  {t.label}
                  {t.detail ? <small>{t.detail}</small> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="ref-bar">
            <button type="button" className="ref-btn s" style={{ flex: 1 }} onClick={() => {
              if (shopPhone) window.location.href = `tel:${shopPhone}`;
            }}>
              Call shop
            </button>
            <button type="button" className="ref-btn k" onClick={() => void cancelOrder()}>
              Cancel order
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 07: Track — desktop (board 37) ── */}
      {step === 'track' && placed && isDesktop && (
        <div className="ref-screen d">
          <div className="ref-dtop">
            <b><i className="ref-dot"></i>{shopName}</b>
            <a className="ref-v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
          </div>
          <div className="ref-wrap">
            <div className="ref-l">
              <h1 className="ref-h1">Order {placed.orderNumber}</h1>
              <p className="ref-s2">
                {statusLabel(trackStatus)}, about {estimateMinutesLeft(trackStatus, trackPages)} min left
              </p>
              <div className="ref-g">
                {timeline.map((t) => (
                  <div className="ref-r" key={t.label}>
                    <span className={`ref-rad${t.done ? ' dn' : t.current ? ' on' : ''}`}></span>
                    <span style={{ flex: 1 }}>
                      {t.label}
                      {t.detail ? <small>{t.detail}</small> : null}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <a className="ref-bt s" href={shopPhone ? `tel:${shopPhone}` : '#'} style={{ textDecoration: 'none' }}>Call shop</a>
                <button type="button" className="ref-bt s" onClick={() => void cancelOrder()}>Cancel order</button>
              </div>
            </div>
            <div className="ref-rt">
              <div className="ref-g p">
                <div className="ref-v" style={{ textAlign: 'center' }}>Pickup code</div>
                <div className="ref-code">{placed.pickupCode}</div>
                <div className="ref-perf"></div>
                <div className="ref-v" style={{ textAlign: 'center' }}>Show this at the counter</div>
              </div>
              <div className="ref-g">
                <div className="ref-r">
                  <span>{shopName}<small>{hours}</small></span>
                  <span className="ref-v" />
                </div>
                <a
                  className="ref-r"
                  href={shopAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}` : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <span>Directions</span>
                  <span className="ref-v">›</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Inline helpers used in JSX ─────────────────────────────────────── */

/** Format elapsed seconds as "Xm Ys" / "Xs". */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
