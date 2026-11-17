'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Smartphone, UploadCloud, FileText, CreditCard, Receipt, Loader2, CheckCircle2,
  Plus, Trash2, ArrowRight, QrCode, RefreshCw,
} from 'lucide-react';
import { useApiClient } from '@/components/phase2/use-api-client';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import type { ShopPricingConfig, ColorMode, PaperSize } from '@platform/core/domain';
import { formatINRFromPaise } from '@platform/utils';

type Step = 'shop' | 'upload' | 'pay' | 'status';

interface PublicShop {
  name: string; slug: string; upiId: string; paymentProvider: string;
  pricingConfig: ShopPricingConfig; privacy: { autoDeleteAfterCollectSeconds: number; autoDeleteCronHours: number };
}
interface UploadedFile {
  fileId: string; storageKey: string; filename: string; pages: number; size: number;
  copies: number; colorMode: ColorMode; duplex: boolean; paperSize: PaperSize; pricePaise: number;
  uploaded: boolean;
}

const VALID_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Root 1 0 R>>\n%%EOF';

export function CustomerApp() {
  const api = useApiClient();
  const [step, setStep] = useState<Step>('shop');
  const [shop, setShop] = useState<PublicShop | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<{ upiUri?: string; amountPaise?: number; qrPng?: string } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load the shop on mount (the customer "scanned the QR" → quickprint).
  useEffect(() => {
    void (async () => {
      const r = await api.request<{ data?: PublicShop }>('GET', '/api/v1/shops/quickprint');
      if (r.data?.data) setShop(r.data.data);
    })();
  }, []);

  const recomputePrice = (f: UploadedFile, cfg: ShopPricingConfig): number => {
    const input: PricingInput = { pages: f.pages, copies: f.copies, colorMode: f.colorMode, paperSize: f.paperSize, duplex: f.duplex, shopPricingConfig: cfg };
    try { return priceFile(input).totalPaise; } catch { return 0; }
  };

  const orderTotal = files.reduce((acc, f) => acc + f.pricePaise, 0);

  // --- Step: start an order ---
  const startOrder = async () => {
    if (!shop) return;
    setBusy(true);
    const r = await api.request<{ data?: { orderId?: string; customerToken?: string } }>('POST', `/api/v1/shops/${shop.slug}/orders`, { body: {} });
    if (r.data?.data?.orderId) {
      setOrderId(r.data.data.orderId);
      setToken(r.data.data.customerToken ?? null);
      setStep('upload');
    }
    setBusy(false);
  };

  // --- Step: handle dropped/selected files ---
  const handleFiles = useCallback(async (selected: FileList | File[]) => {
    if (!shop || !orderId) return;
    const cfg = shop.pricingConfig;
    setBusy(true);
    const arr = Array.from(selected);
    for (const file of arr) {
      const pdf = new Blob([VALID_PDF], { type: 'application/pdf' }); // demo: valid 1-page PDF
      const size = pdf.size;
      const uu = await api.request<{ data?: { uploadUrl?: string; storageKey?: string; fileId?: string } }>('POST', `/api/v1/orders/${orderId}/files/upload-url`, { body: { filename: file.name, mimeType: 'application/pdf', size } });
      const u = uu.data?.data;
      if (!u?.uploadUrl) continue;
      await fetch(u.uploadUrl, { method: 'PUT', body: pdf });
      const cf = await api.request<{ data?: { fileId?: string; pageCount?: number } }>('POST', `/api/v1/orders/${orderId}/files`, { body: { fileId: u.fileId, storageKey: u.storageKey, filename: file.name, mimeType: 'application/pdf', size } });
      const fid = cf.data?.data?.fileId;
      const pages = cf.data?.data?.pageCount ?? 1;
      const f: UploadedFile = { fileId: fid ?? '', storageKey: u.storageKey ?? '', filename: file.name, pages, size, copies: 1, colorMode: 'bw', duplex: false, paperSize: 'a4', pricePaise: 0, uploaded: !!fid };
      f.pricePaise = recomputePrice(f, cfg);
      setFiles((prev) => [...prev, f]);
      // PATCH to sync the (default) settings + price to the server.
      if (fid) await api.request('PATCH', `/api/v1/orders/${orderId}/files/${fid}`, { body: { copies: f.copies, colorMode: f.colorMode, paperSize: f.paperSize, duplex: f.duplex } });
    }
    setBusy(false);
  }, [shop, orderId, api]);

  const addDemoFile = () => {
    const fake = new File([new Blob([VALID_PDF])], `document-${files.length + 1}.pdf`, { type: 'application/pdf' });
    void handleFiles({ length: 1, 0: fake } as unknown as FileList);
  };

  // Update one file's settings → live reprice + PATCH.
  const updateFile = async (idx: number, patch: Partial<UploadedFile>) => {
    if (!shop || !orderId) return;
    setFiles((prev) => {
      const next = [...prev];
      const merged = { ...next[idx]!, ...patch };
      merged.pricePaise = recomputePrice(merged, shop.pricingConfig);
      next[idx] = merged;
      return next;
    });
    const f = files[idx]!;
    const fid = f.fileId;
    if (fid) await api.request('PATCH', `/api/v1/orders/${orderId}/files/${fid}`, { body: patch });
  };

  const removeFile = async (idx: number) => {
    const f = files[idx]!;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    // The API has no delete-file endpoint in the MVP; the file is simply left
    // out of the priced set. The order total recomputes from remaining files.
    void f;
  };

  // --- Step: checkout ---
  const doCheckout = async () => {
    if (!orderId) return;
    setBusy(true);
    const r = await api.request<{ data?: { upiUri?: string; qrPayload?: string; amountPaise?: number } }>('POST', `/api/v1/orders/${orderId}/checkout`);
    const c = r.data?.data;
    if (c?.upiUri) {
      // Render the UPI payload as a QR (server-side via /api/v1/qr — production-legal).
      const qr = await api.request<{ data?: { pngDataUrl?: string } }>('GET', `/api/v1/qr?data=${encodeURIComponent(c.upiUri)}`);
      setCheckout({ upiUri: c.upiUri, amountPaise: c.amountPaise, qrPng: qr.data?.data?.pngDataUrl });
      setStep('pay');
    }
    setBusy(false);
  };

  // --- Step: mark paid (dev simulate PhonePe webhook) + go to status ---
  const markPaid = async () => {
    if (!orderId) return;
    setBusy(true);
    await api.request('POST', `/api/v1/payments/dev/phonepe/simulate`, { body: { orderId, outcome: 'paid' } });
    setStep('status');
    setBusy(false);
  };

  // --- Status polling ---
  useEffect(() => {
    if (step !== 'status' || !orderId) return;
    let active = true;
    const poll = async () => {
      const r = await api.request<{ data?: { status?: string; files?: { filename: string; status: string }[] } }>('GET', `/api/v1/orders/${orderId}/status`);
      if (active && r.data?.data) setOrderStatus(r.data.data.status ?? null);
    };
    void poll();
    const id = setInterval(poll, 1500);
    return () => { active = false; clearInterval(id); };
  }, [step, orderId]);

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Phase 4 — the customer's phone</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        What a customer sees after scanning the shop's QR: a mobile web app (no download) — pick files, set print
        options, watch the price recompute live from the real <code className="rounded bg-muted px-1 font-mono text-xs">priceFile()</code> engine,
        pay via UPI directly to the shopkeeper, then track the job to <em>ready</em>.
      </p>

      <div className="mt-8 flex justify-center">
        <div className="w-full max-w-[400px]">
          {/* Phone frame (desktop) */}
          <div className="rounded-[2.2rem] border-[6px] border-zinc-900 bg-zinc-900 p-1.5 shadow-2xl sm:rounded-[2.4rem]">
            <div className="rounded-[1.7rem] bg-background overflow-hidden">
              <div className="flex items-center justify-center bg-zinc-900 py-1.5"><div className="h-1 w-16 rounded-full bg-zinc-700" /></div>
              <div className="px-4 pb-5 pt-3">
                <Stepper step={step} />
                <div className="mt-4 min-h-[420px]">
                  {step === 'shop' && <ShopStep shop={shop} busy={busy} onStart={startOrder} />}
                  {step === 'upload' && (
                    <UploadStep
                      files={files} orderTotal={orderTotal} busy={busy} dragOver={dragOver}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
                      onPick={(e) => { const fs = e.target.files; if (fs) void handleFiles(fs); }}
                      onAddDemo={addDemoFile}
                      onUpdate={updateFile}
                      onRemove={removeFile}
                      onCheckout={doCheckout}
                      disabled={files.length === 0}
                    />
                  )}
                  {step === 'pay' && (
                    <PayStep token={token} checkout={checkout} busy={busy} onPaid={markPaid} />
                  )}
                  {step === 'status' && (
                    <StatusStep token={token} status={orderStatus} onRestart={() => { setStep('shop'); setFiles([]); setOrderId(null); setToken(null); setCheckout(null); setOrderStatus(null); }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { k: Step; label: string; icon: typeof Smartphone }[] = [
    { k: 'shop', label: 'Shop', icon: Smartphone },
    { k: 'upload', label: 'Upload', icon: UploadCloud },
    { k: 'pay', label: 'Pay', icon: CreditCard },
    { k: 'status', label: 'Status', icon: Receipt },
  ];
  const idx = steps.findIndex((s) => s.k === step);
  return (
    <div className="flex items-center justify-between gap-1">
      {steps.map((s, i) => (
        <div key={s.k} className="flex flex-1 flex-col items-center gap-1">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${i <= idx ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'}`}>
            <s.icon className="h-3.5 w-3.5" />
          </div>
          <span className={`text-[9px] ${i <= idx ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function ShopStep({ shop, busy, onStart }: { shop: PublicShop | null; busy: boolean; onStart: () => void }) {
  if (!shop) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading shop…</div>;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold text-foreground">{shop.name}</h3>
        <p className="text-xs text-muted-foreground">Scan → upload → pay → collect. Zero commission, files auto-deleted.</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <p className="font-medium text-foreground">Pricing</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1 text-muted-foreground">
          <span>B&W A4: <strong className="text-foreground">{formatINRFromPaise(shop.pricingConfig.bw_a4_per_page)}</strong>/pg</span>
          <span>Colour A4: <strong className="text-foreground">{formatINRFromPaise(shop.pricingConfig.color_a4_per_page)}</strong>/pg</span>
          <span>Duplex: <strong className="text-foreground">{shop.pricingConfig.duplex_discount}% off</strong></span>
          <span>Bulk ≥{shop.pricingConfig.bulk_threshold}: <strong className="text-foreground">{shop.pricingConfig.bulk_discount_pct}% off</strong></span>
        </div>
      </div>
      <div className="rounded-lg bg-rose-50 p-2.5 text-[11px] text-rose-700 ring-1 ring-rose-200">
        🔒 Privacy: files deleted from storage within {shop.privacy.autoDeleteAfterCollectSeconds}s of collection, and nightly after {shop.privacy.autoDeleteCronHours}h regardless.
      </div>
      <Button onClick={onStart} disabled={busy} className="w-full">Start order <ArrowRight className="ml-2 h-4 w-4" /></Button>
    </div>
  );
}

function UploadStep(props: {
  files: UploadedFile[]; orderTotal: number; busy: boolean; dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void; onAddDemo: () => void;
  onUpdate: (idx: number, patch: Partial<UploadedFile>) => void; onRemove: (idx: number) => void;
  onCheckout: () => void; disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div
        onDragOver={props.onDragOver} onDragLeave={props.onDragLeave} onDrop={props.onDrop}
        className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${props.dragOver ? 'border-amber-500 bg-amber-50' : 'border-border'}`}
      >
        <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-1 text-xs text-muted-foreground">Drag PDFs here, or</p>
        <Label className="mt-1 inline-flex cursor-pointer items-center justify-center rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700">
          <Plus className="mr-1 h-3 w-3" /> Choose files
          <Input type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={props.onPick} />
        </Label>
        <button onClick={props.onAddDemo} className="mt-1 block w-full text-[10px] text-muted-foreground underline">+ add a demo file</button>
      </div>

      {props.files.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No files yet. Add at least one to continue.</p>
      ) : (
        <div className="space-y-2">
          {props.files.map((f, i) => (
            <Card key={i} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{f.filename}</p>
                      <p className="text-[10px] text-muted-foreground">{f.pages} pg · {formatINRFromPaise(f.pricePaise)}</p>
                    </div>
                  </div>
                  <button onClick={() => props.onRemove(i)} className="text-muted-foreground hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[9px] text-muted-foreground">Copies</Label>
                    <Input type="number" min={1} max={500} value={f.copies} onChange={(e) => props.onUpdate(i, { copies: Math.max(1, Number(e.target.value) || 1) })} className="h-7 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[9px] text-muted-foreground">Colour</Label>
                    <ToggleGroup type="single" value={f.colorMode} onValueChange={(v) => v && props.onUpdate(i, { colorMode: v as ColorMode })} className="h-7">
                      <ToggleGroupItem value="bw" className="h-7 px-2 text-[10px]">B&W</ToggleGroupItem>
                      <ToggleGroupItem value="color" className="h-7 px-2 text-[10px]">Clr</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div>
                    <Label className="text-[9px] text-muted-foreground">Duplex</Label>
                    <div className="flex h-7 items-center"><Switch checked={f.duplex} onCheckedChange={(v) => props.onUpdate(i, { duplex: v })} /></div>
                  </div>
                </div>
                <div className="mt-1 text-right text-[11px] font-medium text-foreground">{formatINRFromPaise(f.pricePaise)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-border bg-background p-2.5">
        <div>
          <p className="text-[10px] text-muted-foreground">Total</p>
          <p className="text-lg font-bold text-foreground">{formatINRFromPaise(props.orderTotal)}</p>
        </div>
        <Button onClick={props.onCheckout} disabled={props.disabled || props.busy} size="sm">
          {props.busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1 h-4 w-4" />} Pay
        </Button>
      </div>
    </div>
  );
}

function PayStep({ token, checkout, busy, onPaid }: { token: string | null; checkout: { upiUri?: string; amountPaise?: number; qrPng?: string } | null; busy: boolean; onPaid: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount to pay</p>
        <p className="text-3xl font-bold text-foreground">{checkout?.amountPaise ? formatINRFromPaise(checkout.amountPaise) : '—'}</p>
        <p className="text-[10px] text-muted-foreground">directly to the shopkeeper's UPI · 0% commission</p>
      </div>
      {checkout?.qrPng ? (
        <div className="flex flex-col items-center">
          <div className="rounded-lg bg-white p-2 ring-1 ring-border"><img src={checkout.qrPng} alt="UPI QR" className="w-40" /></div>
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><QrCode className="h-3 w-3" /> Scan with any UPI app</p>
        </div>
      ) : (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}
      {checkout?.upiUri && (
        <a href={checkout.upiUri} className="inline-block rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700">Open in UPI app</a>
      )}
      <div className="rounded-lg bg-amber-50 p-2.5 text-[10px] text-amber-800 ring-1 ring-amber-200">
        On mobile this opens GPay/PhonePe automatically. Here, simulate the paid webhook:
      </div>
      <Button onClick={onPaid} disabled={busy} className="w-full" variant="outline">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />} I've paid — track my order
      </Button>
      {token && <p className="text-[10px] text-muted-foreground">Token: <strong className="font-mono text-foreground">{token}</strong></p>}
    </div>
  );
}

function StatusStep({ token, status, onRestart }: { token: string | null; status: string | null; onRestart: () => void }) {
  const done = status === 'ready' || status === 'collected';
  const stage = status === 'paid' ? 'Payment confirmed' : status === 'printing' ? 'Printing now…' : status === 'ready' ? 'Ready to collect!' : status === 'collected' ? 'Collected — thank you!' : 'Waiting…';
  return (
    <div className="space-y-4 text-center">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Your token</p>
        <p className="font-mono text-5xl font-bold tracking-widest text-amber-600">{token ?? '——'}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Show this at the counter</p>
      </div>
      <div className={`rounded-xl p-4 ${done ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-amber-50 ring-1 ring-amber-200'}`}>
        {done ? <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /> : <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-600" />}
        <p className={`mt-1 text-sm font-semibold ${done ? 'text-emerald-700' : 'text-amber-800'}`}>{stage}</p>
        <p className="text-[10px] text-muted-foreground">status: {status ?? '…'}</p>
      </div>
      {!done && <p className="text-[10px] text-muted-foreground">Polling every 1.5s — the shopkeeper's dashboard prints & marks ready.</p>}
      {done && <Button onClick={onRestart} variant="outline" size="sm" className="w-full"><RefreshCw className="mr-2 h-3.5 w-3.5" /> Start another order</Button>}
    </div>
  );
}
