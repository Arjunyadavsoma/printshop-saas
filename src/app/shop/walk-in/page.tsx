'use client';

/**
 * /shop/walk-in — spec screen 32: Print a file (walk-in customer).
 *
 * End-to-end, all real API calls (the same public upload pipeline the
 * customer flow uses, driven here by the shopkeeper):
 *   1. POST /api/v1/s/{slug}/uploads/init → chunked PUT
 *      /uploads/chunk (2 MB chunks, SHA-256 checksums) → POST
 *      /uploads/complete, then poll GET /files/{fileId} until the
 *      pipeline reports the real page count.
 *   2. PUT /api/v1/s/{slug}/specs (copies, sides, colour pages).
 *   3. POST /api/v1/s/{slug}/quote → server total.
 *   4. POST /api/v1/s/{slug}/orders → the order (awaiting payment).
 *   5. POST /api/v1/shops/me/orders/{id}/confirm-payment
 *      { action: 'confirm', method: 'counter_cash' } → paid, queued.
 *   Then redirect to the order detail page.
 *
 * The price shown before upload is an estimate from the shop's price
 * list (GET /api/v1/shops/me pricingConfig); the server quote after
 * upload is authoritative.
 *
 * Printer choice: the specs API takes no printer — the dispatcher
 * assigns the device. The chosen printer is recorded in the order note
 * so the counter staff can see the preference.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  SegmentedControl,
  PrimaryButton,
  TintedButton,
  Input,
  EmptyState,
} from '@/components/clear';
import { FileUp, Printer } from 'lucide-react';

const CHUNK_SIZE = 2 * 1024 * 1024;
const SUPPORTED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|docx?|pptx?|xlsx?)$/i;

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  pricingConfig: {
    bw_a4_per_page: number;
    color_a4_per_page: number;
  };
}

interface AgentRow {
  id: string;
  name: string;
  isOnline: boolean;
  isEnabled: boolean;
  printerName?: string | null;
}

type Phase =
  | 'form'
  | 'uploading'
  | 'processing'
  | 'pricing'
  | 'placing'
  | 'confirming'
  | 'done';

const PHASE_LABEL: Record<Exclude<Phase, 'form' | 'done'>, string> = {
  uploading: 'Uploading file…',
  processing: 'Reading pages…',
  pricing: 'Getting the server price…',
  placing: 'Placing the order…',
  confirming: 'Confirming counter payment…',
};

export default function ShopWalkInPage() {
  const api = useApiClient();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState('8');
  const [copies, setCopies] = useState(1);
  const [colour, setColour] = useState<'bw' | 'color'>('bw');
  const [printerId, setPrinterId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState(0);
  const [serverTotalPaise, setServerTotalPaise] = useState<number | null>(null);
  const [serverPages, setServerPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Print a file · Printelyx';
  }, []);

  useEffect(() => {
    if (!api.token) return;
    void (async () => {
      try {
        const [shopR, agentsR] = await Promise.all([
          api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
          api.request<{ data?: AgentRow[] }>('GET', '/api/v1/shops/me/agents'),
        ]);
        if (shopR.status === 200 && shopR.data?.data) setShop(shopR.data.data);
        if (agentsR.status === 200 && agentsR.data?.data) setAgents(agentsR.data.data);
      } catch {
        /* estimate falls back to "—" without pricing */
      }
    })();
  }, [api, api.token]);

  // Live estimate from the price list (single-sided A4 rates).
  const estimatePaise = useMemo(() => {
    if (!shop) return null;
    const n = Math.max(0, parseInt(pages, 10) || 0);
    const rate =
      colour === 'color' ? shop.pricingConfig.color_a4_per_page : shop.pricingConfig.bw_a4_per_page;
    return n * copies * rate;
  }, [shop, pages, copies, colour]);

  const busy = phase !== 'form' && phase !== 'done';

  const onPickFile = (picked: FileList | null) => {
    const f = picked?.[0];
    if (!f) return;
    if (!SUPPORTED_EXT.test(f.name)) {
      setError(`Unsupported file type: ${f.name}. Supported: PDF, JPG, PNG, WEBP, HEIC, DOCX, PPTX, XLSX.`);
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('File is too big. The limit is 50 MB.');
      return;
    }
    setError(null);
    setFile(f);
    setServerPages(null);
    setServerTotalPaise(null);
  };

  const print = useCallback(async () => {
    if (!file || !shop || busy) return;
    setError(null);
    setPhase('uploading');
    setProgress(0);
    try {
      const slug = shop.slug;
      // 1. Init a draft order with the first file.
      const initRes = await fetch(`/api/v1/s/${slug}/uploads/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      const init = (await initRes.json()) as {
        data?: { orderId: string; orderToken: string; fileId: string; uploadId: string };
        error?: { message?: string };
      };
      if (!initRes.ok || !init.data) throw new Error(init?.error?.message ?? 'Upload init failed');
      const { orderId, orderToken, fileId, uploadId } = init.data;

      // 2. Chunk upload.
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const checksum = await sha256Hex(chunk);
        const res = await fetch(
          `/api/v1/s/${slug}/uploads/chunk?uploadId=${uploadId}&index=${index}&checksum=${checksum}`,
          { method: 'PUT', body: chunk },
        );
        if (!res.ok) {
          const e = (await res.json().catch(() => null)) as { error?: { message?: string } };
          throw new Error(e?.error?.message ?? 'Chunk upload failed');
        }
        setProgress(Math.round((end / file.size) * 100));
      }

      // 3. Complete → pipeline.
      const compRes = await fetch(`/api/v1/s/${slug}/uploads/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (!compRes.ok) {
        const e = (await compRes.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(e?.error?.message ?? 'Processing failed');
      }

      // 4. Poll until the pipeline reports the page count.
      setPhase('processing');
      let pageCount: number | null = null;
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const stRes = await fetch(
          `/api/v1/s/${slug}/files/${fileId}?token=${encodeURIComponent(orderToken)}`,
        );
        const st = (await stRes.json()) as {
          data?: { status?: string; pageCount?: number | null };
        };
        if (st.data?.status === 'failed') throw new Error('The file could not be read. Try a different file.');
        if (st.data?.status === 'ready' && (st.data.pageCount ?? 0) > 0) {
          pageCount = st.data.pageCount ?? 0;
          break;
        }
      }
      if (pageCount === null) throw new Error('Still reading the file after 90 seconds. Try again.');
      setServerPages(pageCount);

      // 5. Specs: copies + colour for every page (or all B&W).
      const colorPages = colour === 'color' ? Array.from({ length: pageCount }, (_, i) => i + 1) : [];
      const specRes = await fetch(`/api/v1/s/${slug}/specs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderToken,
          fileId,
          pageRangeText: '',
          copies,
          sides: 'SINGLE',
          pagesPerSheet: 1,
          paperSize: 'A4',
          paperType: 'PLAIN',
          collate: true,
          colorPages,
          skipPages: [],
        }),
      });
      if (!specRes.ok) {
        const e = (await specRes.json().catch(() => null)) as { error?: { message?: string } };
        throw new Error(e?.error?.message ?? 'Could not save print options');
      }

      // 6. Server quote (authoritative total).
      setPhase('pricing');
      const pageModes = Array.from({ length: pageCount }, (_, i) => ({
        page: i + 1,
        mode: (colour === 'color' ? 'color' : 'bw') as 'color' | 'bw',
      }));
      const quoteRes = await fetch(`/api/v1/s/${slug}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            {
              fileId,
              spec: {
                pageModes,
                copies,
                sides: 'SINGLE',
                pagesPerSheet: 1,
                paperSize: 'A4',
                paperType: 'PLAIN',
                collate: true,
              },
            },
          ],
          addonIds: [],
          urgent: false,
        }),
      });
      const quote = (await quoteRes.json()) as {
        data?: { totalPaise?: number };
        error?: { message?: string };
      };
      if (!quoteRes.ok || !quote.data || quote.data.totalPaise == null) {
        throw new Error(quote?.error?.message ?? 'Could not price the order');
      }
      const totalPaise = quote.data.totalPaise;
      setServerTotalPaise(totalPaise);

      // 7. Place the order, then confirm counter payment.
      setPhase('placing');
      const chosenPrinter = agents.find((a) => a.id === printerId);
      const noteParts: string[] = ['Walk-in order at the counter.'];
      if (chosenPrinter) {
        noteParts.push(
          `Preferred printer: ${chosenPrinter.printerName ?? chosenPrinter.name}.`,
        );
      }
      const orderRes = await fetch(`/api/v1/s/${slug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderToken,
          addonIds: [],
          urgent: false,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.replace(/\D/g, '') || null,
          note: noteParts.join(' '),
          clientTotalPaise: totalPaise,
        }),
      });
      const placed = (await orderRes.json()) as { error?: { message?: string } };
      if (!orderRes.ok) throw new Error(placed?.error?.message ?? 'Could not place the order');

      setPhase('confirming');
      const confirmR = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/confirm-payment`,
        { body: { action: 'confirm', method: 'counter_cash' } },
      );
      if (confirmR.status >= 400) {
        throw new Error(
          confirmR.data?.error?.message ??
            'Order placed but counter payment could not be confirmed — open it from Orders to confirm.',
        );
      }
      setPhase('done');
      router.push(`/shop/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed');
      setPhase('form');
    }
  }, [file, shop, busy, colour, copies, printerId, agents, customerName, customerPhone, api, router]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Print a file</h1>
        <p className="text-sm text-[var(--label-2)]">For walk-in customers.</p>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            {error}
          </p>
        </Group>
      ) : null}

      <Group title="File">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.doc,.pptx,.xlsx"
          className="hidden"
          aria-label="Choose a file to print"
          onChange={(e) => {
            onPickFile(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-[var(--radius-input)] bg-[var(--fill)] px-3.5 text-left text-[15px] text-[var(--label)] disabled:opacity-50"
        >
          <FileUp className="size-5 shrink-0 text-[var(--label-2)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {file ? file.name : 'Choose or scan a file'}
          </span>
          <span className="shrink-0 rounded-full bg-[var(--accent-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-tint-text)]">
            Choose
          </span>
        </button>
        <p className="pt-2 text-xs text-[var(--label-2)]">
          PDF, photos or Word files, up to 50 MB each.
        </p>
      </Group>

      <Group title="Print options">
        <div className="flex flex-col gap-4">
          <Input
            label="Pages"
            value={pages}
            onChange={setPages}
            type="number"
            inputMode="numeric"
            hint="How many pages to print. The file is re-counted after upload and the server total wins."
          />
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-[var(--label-2)]">Copies</p>
            <div className="flex items-center gap-3">
              <TintedButton
                aria-label="Fewer copies"
                disabled={busy || copies <= 1}
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
              >
                −
              </TintedButton>
              <span className="min-w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                {copies}
              </span>
              <TintedButton
                aria-label="More copies"
                disabled={busy || copies >= 100}
                onClick={() => setCopies((c) => Math.min(100, c + 1))}
              >
                +
              </TintedButton>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-[var(--label-2)]">Colour</p>
            <SegmentedControl
              ariaLabel="Colour mode"
              value={colour}
              onChange={(v) => setColour(v as 'bw' | 'color')}
              options={[
                { value: 'bw', label: 'B&W' },
                { value: 'color', label: 'Colour' },
              ]}
            />
          </div>
          <div>
            <label
              htmlFor="walkin-printer"
              className="mb-1.5 block text-[13px] font-medium text-[var(--label-2)]"
            >
              Printer
            </label>
            <select
              id="walkin-printer"
              value={printerId}
              onChange={(e) => setPrinterId(e.target.value)}
              disabled={busy}
              className="min-h-[48px] w-full rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] px-3.5 text-base text-[var(--label)]"
            >
              <option value="">Auto (dispatcher picks)</option>
              {agents
                .filter((a) => a.isEnabled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.printerName ?? a.name}
                    {a.isOnline ? '' : ' (offline)'}
                  </option>
                ))}
            </select>
            <p className="pt-1.5 text-xs text-[var(--label-2)]">
              A preference only — the dispatcher assigns the device. It is
              saved in the order note.
            </p>
          </div>
          <Input
            label="Customer name (optional)"
            value={customerName}
            onChange={setCustomerName}
            placeholder="Walk-in customer"
          />
          <Input
            label="Customer phone (optional)"
            value={customerPhone}
            onChange={setCustomerPhone}
            type="tel"
            inputMode="tel"
            placeholder="98765 43210"
          />
        </div>
      </Group>

      <Group>
        {busy ? (
          <div className="flex flex-col gap-2">
            <p className="text-[15px] font-medium text-[var(--label)]">
              {PHASE_LABEL[phase as Exclude<Phase, 'form' | 'done'>]}
            </p>
            {phase === 'uploading' ? (
              <div
                className="h-2 overflow-hidden rounded-full bg-[var(--fill)]"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
            {serverPages !== null ? (
              <p className="text-sm text-[var(--label-2)]">
                File has {serverPages} pages
                {serverTotalPaise !== null
                  ? ` · server total ${formatINRFromPaise(serverTotalPaise)}`
                  : ''}
              </p>
            ) : null}
          </div>
        ) : file ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-[var(--label)]">
              {pages} pages × {copies} {copies === 1 ? 'copy' : 'copies'} ·{' '}
              {colour === 'color' ? 'Colour' : 'B&W'}
            </span>
            <span className="text-xl font-bold tabular-nums text-[var(--label)]">
              {estimatePaise === null ? '—' : formatINRFromPaise(estimatePaise)}
            </span>
          </div>
        ) : (
          <EmptyState
            icon={<Printer className="size-7" />}
            title="No file chosen yet"
            description="Choose a file above — the price is charged at your price list."
          />
        )}
      </Group>

      <PrimaryButton disabled={!file || busy || !shop} onClick={() => void print()}>
        {busy ? 'Printing…' : `Print${estimatePaise !== null && file ? ` · ${formatINRFromPaise(estimatePaise)}` : ''}`}
      </PrimaryButton>
      <p className="-mt-1 text-xs text-[var(--label-2)]">
        Charged at your price list as counter cash. The order is confirmed
        as paid at the counter, so it queues for printing immediately.
      </p>
    </div>
  );
}
