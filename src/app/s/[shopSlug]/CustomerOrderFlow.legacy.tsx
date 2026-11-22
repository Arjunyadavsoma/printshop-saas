'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * CustomerOrderFlow (brief §4.2–4.6) — upload → per-file options with the
 * page-strip color selector → sticky server-quoted price bar → details →
 * UPI/counter payment. Design: docs/DESIGN.md ("counter slip / process ink")
 * — the page strip is the one bold moment; everything else stays quiet.
 */

type PageMode = 'color' | 'bw' | 'skip';

type FlowFile = {
  fileId: string;
  uploadId: string;
  name: string;
  sizeBytes: number;
  progress: number;       // 0..100 upload progress
  status: 'uploading' | 'converting' | 'ready' | 'failed';
  failReason?: string | null;
  pageCount?: number | null;
  pageWidthPt?: number | null;
  pageHeightPt?: number | null;
  thumbnails: Array<{ page: number; url: string }>;
  suggestion: Array<{ page: number; isColor: boolean; confidence: number }> | null;
  pageModes: Map<number, PageMode>;
  copies: number;
  sides: 'SINGLE' | 'DOUBLE';
  pagesPerSheet: 1 | 2 | 4 | 6 | 9;
  paperSize: string;
  paperType: string;
  collate: boolean;
  pageRangeText: string;
};

const CHUNK = 2 * 1024 * 1024;

function formatPaise(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  return `₹${(p / 100).toFixed(2)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cycle a page's mode: bw → color → skip → bw. */
function nextMode(m: PageMode): PageMode {
  return m === 'bw' ? 'color' : m === 'color' ? 'skip' : 'bw';
}

export default function CustomerOrderFlow({ shopSlug, paymentMode }: { shopSlug: string; paymentMode: string }) {
  const [draft, setDraft] = useState<{ orderId: string; orderToken: string } | null>(null);
  const [files, setFiles] = useState<FlowFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [step, setStep] = useState<'upload' | 'options' | 'details' | 'pay'>('upload');
  const [quote, setQuote] = useState<{ totalPaise: number | null; subtotalPaise: number | null; addonsPaise: number; urgentPaise: number; lines: Array<{ colorMode: string; pages: number; perPagePaise: number | null; copies: number; paperSize: string; sides: string }>; warnings: string[]; ruleMissing: boolean } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<{ pickupCode: string; orderNumber: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = files[activeIdx];

  // ── upload (init → chunked PUT → complete) ──────────────────────────────
  const uploadOne = useCallback(async (file: globalThis.File, orderId: string, orderToken: string) => {
    const initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, orderId, orderToken }),
    });
    const init = await initRes.json();
    if (!initRes.ok) throw new Error(init?.error?.message ?? 'Upload failed');
    const { fileId, uploadId } = init.data;

    setFiles(fs => [...fs, {
      fileId, uploadId, name: file.name, sizeBytes: file.size, progress: 0,
      status: 'uploading', thumbnails: [], suggestion: null,
      pageModes: new Map(), copies: 1, sides: 'SINGLE', pagesPerSheet: 1,
      paperSize: 'A4', paperType: 'PLAIN', collate: true, pageRangeText: '',
    }]);

    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const chunk = file.slice(offset, offset + CHUNK);
      const res = await fetch(`/api/v1/s/${shopSlug}/uploads/chunk?uploadId=${uploadId}`, { method: 'PUT', body: chunk });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error?.message ?? 'Upload failed');
      }
      const sent = Math.min(offset + CHUNK, file.size);
      setFiles(fs => fs.map(f => f.fileId === fileId ? { ...f, progress: Math.round((sent / file.size) * 100) } : f));
    }

    setFiles(fs => fs.map(f => f.fileId === fileId ? { ...f, status: 'converting' } : f));
    const compRes = await fetch(`/api/v1/s/${shopSlug}/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    if (!compRes.ok) {
      const e = await compRes.json().catch(() => null);
      throw new Error(e?.error?.message ?? 'Processing failed');
    }
  }, [shopSlug]);

  const onPick = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    try {
      let current = draft;
      if (!current) {
        // init creates the draft order on the first file
        const first = list[0]!;
        const initRes = await fetch(`/api/v1/s/${shopSlug}/uploads/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: first.name, mimeType: first.type || 'application/octet-stream', sizeBytes: first.size }),
        });
        const init = await initRes.json();
        if (!initRes.ok) throw new Error(init?.error?.message ?? 'Upload failed');
        current = { orderId: init.data.orderId, orderToken: init.data.orderToken };
        setDraft(current);
        await uploadOne(first, current.orderId, current.orderToken);
        for (const f of Array.from(list).slice(1)) await uploadOne(f, current.orderId, current.orderToken);
      } else {
        for (const f of Array.from(list)) await uploadOne(f, current.orderId, current.orderToken);
      }
      setStep('options');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  }, [draft, shopSlug, uploadOne]);

  // poll converting files until READY (then load page count + thumbnails + suggestion)
  useEffect(() => {
    const pending = files.filter(f => f.status === 'converting');
    if (pending.length === 0 || !draft) return;
    const t = setTimeout(async () => {
      for (const f of pending) {
        const res = await fetch(`/api/v1/s/${shopSlug}/files/${f.fileId}?token=${draft.orderToken}`);
        if (!res.ok) continue;
        const d = (await res.json()).data;
        setFiles(fs => fs.map(x => x.fileId !== f.fileId ? x : {
          ...x,
          status: d.status,
          failReason: d.failReason,
          pageCount: d.pageCount,
          pageWidthPt: d.pageWidthPt,
          pageHeightPt: d.pageHeightPt,
          thumbnails: d.thumbnails ?? [],
          suggestion: d.colorSuggestion ?? null,
          pageModes: x.pageModes.size === 0 && d.pageCount && d.colorSuggestion
            ? new Map(d.colorSuggestion.map((s: { page: number; isColor: boolean }) => [s.page, s.isColor ? 'color' : 'bw' as PageMode]))
            : x.pageModes,
        }));
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [files, draft, shopSlug]);

  // ── debounced server quote ──────────────────────────────────────────────
  const readyFiles = files.filter(f => f.status === 'ready' && (f.pageCount ?? 0) > 0);
  useEffect(() => {
    if (readyFiles.length === 0) { setQuote(null); return; }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setQuoting(true);
    quoteTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/s/${shopSlug}/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: readyFiles.map(f => ({
              fileId: f.fileId,
              spec: {
                pageModes: Array.from({ length: f.pageCount! }, (_, i) => ({ page: i + 1, mode: f.pageModes.get(i + 1) ?? 'bw' })),
                copies: f.copies, sides: f.sides, pagesPerSheet: f.pagesPerSheet,
                paperSize: f.paperSize, paperType: f.paperType, collate: f.collate,
              },
            })),
            addonIds: [], urgent,
          }),
        });
        const d = await res.json();
        if (res.ok) setQuote(d.data); else setError(d?.error?.message ?? 'Could not price the order');
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [readyFiles.map(f => `${f.fileId}:${f.copies}:${f.sides}:${f.pagesPerSheet}:${f.paperSize}:${[...f.pageModes.entries()].sort((a, b) => a[0] - b[0]).map(([p, m]) => `${p}${m}`).join(',')}`).join('|'), urgent, shopSlug]);

  // ── actions ─────────────────────────────────────────────────────────────
  const toggleMode = (fileId: string, page: number) => {
    setFiles(fs => fs.map(f => {
      if (f.fileId !== fileId) return f;
      const m = new Map(f.pageModes);
      m.set(page, nextMode(m.get(page) ?? 'bw'));
      return { ...f, pageModes: m };
    }));
  };
  const setAllModes = (fileId: string, mode: PageMode) => {
    setFiles(fs => fs.map(f => f.fileId !== fileId ? f : {
      ...f, pageModes: new Map(Array.from({ length: f.pageCount ?? 0 }, (_, i) => [i + 1, mode] as const)),
    }));
  };
  // NOTE: this function was originally named `useSuggestion` — renamed to
  // `applySuggestion` because the `use` prefix falsely triggers the
  // `react-hooks/rules-of-hooks` lint rule (which assumes any function
  // starting with `use` is a Hook). This is NOT a Hook — it's a plain
  // event handler that calls the `setFiles` state setter.
  const applySuggestion = (fileId: string) => {
    setFiles(fs => fs.map(f => {
      if (f.fileId !== fileId || !f.suggestion) return f;
      return { ...f, pageModes: new Map(f.suggestion.map(s => [s.page, s.isColor ? 'color' : 'bw' as PageMode])) };
    }));
  };
  const markRange = (fileId: string, text: string, mode: PageMode) => {
    setFiles(fs => fs.map(f => {
      if (f.fileId !== fileId) return f;
      const m = new Map(f.pageModes);
      for (const part of text.split(',')) {
        const mm = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
        if (!mm) continue;
        const a = parseInt(mm[1]!, 10), b = mm[2] ? parseInt(mm[2], 10) : a;
        for (let p = Math.max(1, a); p <= Math.min(f.pageCount ?? 0, b); p++) m.set(p, mode);
      }
      return { ...f, pageModes: m };
    }));
  };
  const patchFile = (fileId: string, patch: Partial<FlowFile>) => {
    setFiles(fs => fs.map(f => f.fileId === fileId ? { ...f, ...patch } : f));
  };

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');
  const [pricesChanged, setPricesChanged] = useState<number | null>(null);
  const [utr, setUtr] = useState('');

  const place = async () => {
    if (!draft) return;
    setPlacing(true); setError(null);
    try {
      const res = await fetch(`/api/v1/s/${shopSlug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: draft.orderId, orderToken: draft.orderToken,
          addonIds: [], urgent,
          customerName: customerName || null,
          customerPhone: customerPhone.replace(/\D/g, '') || null,
          note: note || null,
          clientTotalPaise: quote?.totalPaise ?? null,
        }),
      });
      const d = await res.json();
      if (res.status === 409 && d?.error?.code === 'PRICES_CHANGED') {
        setPricesChanged(d.data?.quote?.totalPaise ?? d?.context?.quote?.totalPaise ?? null);
        setQuote((q) => q ? { ...q, totalPaise: d.data?.quote?.totalPaise ?? null } : q);
        setError('Prices changed while you were ordering. Check the new total and confirm again.');
        return;
      }
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not place the order');
      setPlaced({ pickupCode: d.data.pickupCode, orderNumber: d.data.orderNumber, token: d.data.token });
      setStep('pay');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the order');
    } finally {
      setPlacing(false);
    }
  };

  const submitUtr = async () => {
    if (!placed) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'upi', utr: utr.replace(/\D/g, '') }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not submit the payment');
      window.location.href = `/o/${placed.token}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    }
  };

  const counterPayment = async () => {
    if (!placed) return;
    const res = await fetch(`/api/v1/o/${placed.token}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'counter_cash' }),
    });
    if (res.ok) window.location.href = `/o/${placed.token}`;
  };

  const totals = useMemo(() => {
    const counts = active?.pageModes ? [...active.pageModes.values()] : [];
    return {
      color: counts.filter(m => m === 'color').length,
      bw: counts.filter(m => m === 'bw').length,
      skipped: counts.filter(m => m === 'skip').length,
    };
  }, [active?.pageModes]);

  // ── render ──────────────────────────────────────────────────────────────
  if (placed) {
    // payment step (brief §4.6) — the pickup code stays on /o/[token]
    return (
      <section className="mt-6">
        <h2 className="text-lg font-semibold tracking-tight">Order {placed.orderNumber} placed</h2>
        <div className="mt-3 rounded-lg border border-ink/20 bg-white p-4">
          <p className="text-sm text-ink/70">Total to pay</p>
          <p className="text-2xl font-bold tabular-nums">{formatPaise(quote?.totalPaise)}</p>
          {paymentMode !== 'PRINT_THEN_PAY' && (
            <>
              <a
                href={`upi://pay?pa=TODO&pn=TODO&am=0&cu=INR`}
                className="mt-4 hidden"
                aria-hidden="true"
              />
              <div className="mt-3 rounded-md border border-ink/15 bg-paper p-3 text-sm">
                Pay the shop directly by UPI. The shop confirms your payment — the app never marks it paid by itself.
              </div>
              <label className="mt-4 block text-sm font-medium" htmlFor="utr">
                After paying, enter the 12-digit UTR / reference number
              </label>
              <input
                id="utr"
                inputMode="numeric"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-ink/25 bg-white px-3 py-2.5 tabular-nums"
                placeholder="441234567890"
                value={utr}
                onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
              {utr.length > 0 && utr.length !== 12 && (
                <p className="mt-1 text-xs text-[color:var(--p-magenta)]">The UTR has 12 digits — {12 - utr.length} more.</p>
              )}
              <button
                onClick={submitUtr}
                disabled={utr.length !== 12}
                className="mt-3 min-h-11 w-full rounded-md bg-ink px-4 py-2.5 font-medium text-paper disabled:opacity-40"
              >
                Submit payment reference
              </button>
            </>
          )}
          <button
            onClick={counterPayment}
            className="mt-2 min-h-11 w-full rounded-md border border-ink/25 bg-white px-4 py-2.5 font-medium"
          >
            Pay at the counter instead
          </button>
          {error && <p className="mt-3 text-sm text-[color:var(--p-magenta)]">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      {/* ── 1. the paper-tray dropzone ── */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files to print"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        className="cursor-pointer rounded-xl border-2 border-dashed border-ink/30 bg-white px-4 py-8 text-center transition-colors hover:border-[color:var(--p-cyan)] focus-visible:outline-2 focus-visible:outline-[color:var(--p-cyan)]"
      >
        <p className="font-medium">Drop files here, or tap to pick</p>
        <p className="mt-1 text-xs text-ink/60">PDF, JPG, PNG, WEBP, HEIC, DOCX, PPTX, XLSX · up to 50 MB each</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.doc,.pptx,.xlsx"
        onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }}
      />
      {error && <p className="mt-2 text-sm text-[color:var(--p-magenta)]" role="alert">{error}</p>}

      {/* per-file rows */}
      <ul className="mt-3 space-y-2">
        {files.map((f, i) => (
          <li key={f.fileId}>
            <button
              onClick={() => setActiveIdx(i)}
              className={`w-full rounded-lg border bg-white px-3 py-2.5 text-left ${i === activeIdx ? 'border-[color:var(--p-cyan)]' : 'border-ink/15'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{f.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink/60">
                  {f.status === 'uploading' && `${f.progress}%`}
                  {f.status === 'converting' && 'converting…'}
                  {f.status === 'ready' && `${f.pageCount} page${f.pageCount === 1 ? '' : 's'} · ${formatBytes(f.sizeBytes)}`}
                  {f.status === 'failed' && 'failed'}
                </span>
              </div>
              {f.status === 'uploading' && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={f.progress}>
                  <div className="h-full rounded-full bg-[color:var(--p-cyan)]" style={{ width: `${f.progress}%` }} />
                </div>
              )}
              {f.status === 'failed' && (
                <p className="mt-1 text-xs text-[color:var(--p-magenta)]">{f.failReason ?? 'This file could not be processed.'}</p>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* ── 2. the page strip (the bold moment) ── */}
      {active?.status === 'ready' && (active.pageCount ?? 0) > 0 && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold tracking-tight">{active.name}</h3>
            <span className="text-xs tabular-nums text-ink/60">{totals.bw} B&W · {totals.color} color{totals.skipped > 0 ? ` · ${totals.skipped} skipped` : ''}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Page color selection">
            <button onClick={() => setAllModes(active.fileId, 'bw')} className="min-h-9 rounded-md border border-ink/25 bg-white px-2.5 text-xs font-medium">All B&W</button>
            <button onClick={() => setAllModes(active.fileId, 'color')} className="min-h-9 rounded-md border border-ink/25 bg-white px-2.5 text-xs font-medium">All color</button>
            {active.suggestion && (
              <button onClick={() => applySuggestion(active.fileId)} className="min-h-9 rounded-md border border-ink/25 bg-white px-2.5 text-xs font-medium">Use suggestion</button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              className="w-32 min-h-9 rounded-md border border-ink/25 bg-white px-2 text-sm"
              placeholder="e.g. 1-5, 8"
              aria-label="Pages to mark as color"
              value={active.pageRangeText}
              onChange={(e) => patchFile(active.fileId, { pageRangeText: e.target.value })}
            />
            <button onClick={() => markRange(active.fileId, active.pageRangeText, 'color')} className="min-h-9 rounded-md bg-[color:var(--p-cyan)] px-2.5 text-xs font-medium text-white">Mark color</button>
            <button onClick={() => markRange(active.fileId, active.pageRangeText, 'bw')} className="min-h-9 rounded-md border border-ink/25 bg-white px-2.5 text-xs font-medium">Mark B&W</button>
          </div>

          {/* page strip — tap cycles B&W → color → skip; duplex pairs share a bracket */}
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {Array.from({ length: active.pageCount ?? 0 }, (_, i) => {
              const page = i + 1;
              const mode = active.pageModes.get(page) ?? 'bw';
              const thumb = active.thumbnails.find(t => t.page === page)?.url;
              const isSheetStart = active.sides === 'DOUBLE' && page % 2 === 1;
              return (
                <div key={page}>
                  <button
                    onClick={() => toggleMode(active.fileId, page)}
                    aria-pressed={mode === 'color'}
                    aria-label={`Page ${page}: ${mode}. Tap to change.`}
                    className={`relative block w-full overflow-hidden rounded-md border-2 bg-white text-left transition-transform active:scale-95 ${mode === 'color' ? 'border-[color:var(--p-cyan)]' : mode === 'skip' ? 'border-ink/15 opacity-40' : 'border-ink/40'}`}
                  >
                    {thumb
                      ? <img src={thumb} alt="" className="aspect-[3/4] w-full object-cover" loading="lazy" />
                      : <div className={`aspect-[3/4] w-full ${mode === 'color' ? 'bg-[color:var(--p-yellow-tint)]' : 'halftone bg-white'}`} />}
                    {mode === 'color' && (
                      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-[color:var(--p-cyan)] px-1 py-0.5 text-[10px] font-semibold text-white">
                        <span className="inline-block size-2 rounded-full bg-white" /> Color
                      </span>
                    )}
                    {mode === 'bw' && (
                      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-ink px-1 py-0.5 text-[10px] font-semibold text-paper">
                        <span className="halftone inline-block size-2 rounded-full bg-white" /> B&W
                      </span>
                    )}
                    {mode === 'skip' && (
                      <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1 py-0.5 text-[10px] font-semibold text-white">Skipped</span>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-white/85 px-1 text-[10px] font-semibold tabular-nums text-ink">{page}</span>
                  </button>
                  {/* duplex bracket — the pair lives on one physical sheet */}
                  {isSheetStart && active.sides === 'DOUBLE' && (
                    <div className="mt-0.5 text-center text-[10px] text-ink/50">⌐ {page}–{page + 1} one sheet</div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink/60">Tap a page to switch it between B&W, color, and skipped. With two-sided printing, a sheet prints on the color printer if any page on it is color.</p>

          {/* options form */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-ink/70">Copies</span>
              <input
                type="number" min={1} max={100} value={active.copies}
                onChange={(e) => patchFile(active.fileId, { copies: Math.max(1, Math.min(100, parseInt(e.target.value || '1', 10))) })}
                className="mt-1 w-full rounded-md border border-ink/25 bg-white px-3 py-2 tabular-nums"
              />
            </label>
            <label className="text-sm">
              <span className="text-ink/70">Paper</span>
              <select value={active.paperSize} onChange={(e) => patchFile(active.fileId, { paperSize: e.target.value })} className="mt-1 w-full rounded-md border border-ink/25 bg-white px-3 py-2">
                <option value="A4">A4</option>
                <option value="A3">A3</option>
                <option value="Letter">Letter</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-ink/70">Sides</span>
              <select value={active.sides} onChange={(e) => patchFile(active.fileId, { sides: e.target.value as 'SINGLE' | 'DOUBLE' })} className="mt-1 w-full rounded-md border border-ink/25 bg-white px-3 py-2">
                <option value="SINGLE">One-sided</option>
                <option value="DOUBLE">Two-sided</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-ink/70">Pages per sheet</span>
              <select value={active.pagesPerSheet} onChange={(e) => patchFile(active.fileId, { pagesPerSheet: parseInt(e.target.value, 10) as 1 | 2 | 4 | 6 | 9 })} className="mt-1 w-full rounded-md border border-ink/25 bg-white px-3 py-2">
                {[1, 2, 4, 6, 9].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* ── 3. sticky price bar + details ── */}
      {readyFiles.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-ink/15 bg-paper/95 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              {quoting ? (
                <div className="h-6 w-24 animate-pulse rounded bg-ink/10" aria-label="Updating price" />
              ) : (
                <>
                  <span className="block text-lg font-bold tabular-nums leading-6">{formatPaise(quote?.totalPaise)}</span>
                  <span className="block truncate text-xs text-ink/60">
                    {quote?.lines.map(l => `${l.pages} ${l.colorMode === 'COLOR' ? 'color' : 'B&W'} × ${formatPaise(l.perPagePaise)}`).join(' · ') || '—'}
                  </span>
                </>
              )}
            </div>
            {step === 'options' && (
              <button
                onClick={() => setStep('details')}
                disabled={quoting || quote?.totalPaise === null}
                className="min-h-11 shrink-0 rounded-md bg-ink px-4 font-medium text-paper disabled:opacity-40"
              >
                Continue
              </button>
            )}
            {step === 'details' && (
              <button
                onClick={place}
                disabled={placing || quoting}
                className="min-h-11 shrink-0 rounded-md bg-ink px-4 font-medium text-paper disabled:opacity-40"
              >
                {placing ? 'Placing…' : `Place order · ${formatPaise(quote?.totalPaise)}`}
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'details' && (
        <div className="mb-24 mt-5 rounded-lg border border-ink/20 bg-white p-4">
          <h3 className="font-semibold tracking-tight">Your details</h3>
          <label className="mt-3 block text-sm">
            <span className="text-ink/70">Name (optional)</span>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 w-full rounded-md border border-ink/25 px-3 py-2.5" autoComplete="name" />
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-ink/70">Mobile number</span>
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric" className="mt-1 w-full rounded-md border border-ink/25 px-3 py-2.5 tabular-nums" placeholder="9876543210"
            />
            {customerPhone.length > 0 && customerPhone.length !== 10 && (
              <span className="mt-1 block text-xs text-[color:var(--p-magenta)]">Enter all 10 digits.</span>
            )}
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-ink/70">Note to the shop (optional, max 300)</span>
            <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-ink/25 px-3 py-2.5" />
          </label>
          {pricesChanged !== null && (
            <p className="mt-3 rounded-md border border-[color:var(--p-yellow)]/40 bg-[color:var(--p-yellow-tint)] p-2 text-sm">
              The total is now {formatPaise(pricesChanged)}. Confirm again to place the order.
            </p>
          )}
        </div>
      )}
      <div className="h-16" />
    </section>
  );
}
