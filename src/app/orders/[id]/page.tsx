'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiClient } from '@/components/portal/use-api-client';
import { formatINRFromPaise } from '@platform/utils';
import { priceFile, type PricingInput } from '@platform/core/pricing';
import type {
  ShopPricingConfig, ColorMode, PaperSize, OrderStatus, FileStatus,
} from '@platform/core/domain';
import {
  UploadCloud, FileText, Trash2, Loader2, AlertCircle, ArrowLeft, ArrowRight,
  CheckCircle2, RefreshCw, CreditCard, QrCode, ShieldCheck, Info,
  Home, Download, XCircle,
} from 'lucide-react';

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
  printedAt: string | null;
}

interface OrderStatusResponse {
  orderId: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  totalFormatted: string;
  currency: string;
  paidAt: string | null;
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
  status: FileStatus;
  needsReview: boolean;
}

interface PatchFileResponse {
  file: {
    id: string;
    copies: number;
    colorMode: ColorMode;
    paperSize: PaperSize;
    duplex: boolean;
    pricePaise: number;
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
}

const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: 'upload', label: 'Upload' },
  { key: 'configure', label: 'Configure' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'pay', label: 'Pay' },
  { key: 'track', label: 'Track' },
];

const STATUS_AFTER_PAYMENT: OrderStatus[] = ['paid', 'printing', 'ready', 'collected', 'cancelled', 'refunded'];

function statusLabel(s: OrderStatus | null): string {
  switch (s) {
    case 'awaiting_payment': return 'Awaiting payment';
    case 'paid': return 'Payment confirmed';
    case 'printing': return 'Printing now';
    case 'ready': return 'Ready to collect';
    case 'collected': return 'Collected — thank you!';
    case 'cancelled': return 'Cancelled';
    case 'refunded': return 'Refunded';
    default: return 'Loading…';
  }
}

// ──────────────────────────── Page ────────────────────────────

export default function OrderFlowPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const api = useApiClient();
  const search = useSearchParams();
  const shopSlug = search.get('shop');

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

  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

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
    const r = await api.request<{ data?: OrderStatusResponse; error?: { message?: string } }>('GET', `/api/v1/orders/${orderId}/status`);
    if (!opts?.silent) setLoading(false);
    if (r.status >= 400 || !r.data?.data) {
      setFatalError(r.data?.error?.message ?? 'Order not found.');
      return;
    }
    const data = r.data.data;
    setOrder(data);
    setOrderTotalPaise(data.totalAmountPaise);
    setServerCalculated(true);

    // Hydrate local file state from the server (only basic fields).
    setFiles((prev) => {
      const byId = new Map(prev.map((f) => [f.fileId, f]));
      const next: LocalFile[] = data.files.map((f) => {
        const existing = byId.get(f.id);
        if (existing) {
          return {
            ...existing,
            filename: f.filename,
            copies: f.copies,
            colorMode: f.colorMode,
            duplex: f.duplex,
            status: f.status === 'needs_review' ? 'needs_review' : 'uploaded',
          };
        }
        return {
          fileId: f.id,
          filename: f.filename,
          pageCount: 0,
          size: 0,
          copies: f.copies,
          colorMode: f.colorMode,
          duplex: f.duplex,
          paperSize: 'a4' as PaperSize,
          pageRange: '',
          pricePaise: 0,
          status: f.status === 'needs_review' ? 'needs_review' : 'uploaded',
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
  }, [api, orderId]);

  // Fetch shop info (if slug in query) so we can do client-side price estimates.
  const loadShop = useCallback(async () => {
    if (!shopSlug) return;
    const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>('GET', `/api/v1/shops/${shopSlug}`);
    if (r.status >= 400 || !r.data?.data) return;
    setShop(r.data.data);
  }, [api, shopSlug]);

  useEffect(() => {
    if (!api.ready || !orderId) return;
    void (async () => {
      await Promise.all([loadOrder(), loadShop()]);
    })();
  }, [api.ready, orderId, loadOrder, loadShop]);

  // ─── Client-side price estimate ───
  const clientEstimate = useCallback((f: LocalFile): number => {
    if (!shop) return f.pricePaise;
    try {
      const input: PricingInput = {
        pages: f.pageCount || 1,
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
      };
      setFiles((prev) => [...prev, placeholder]);

      try {
        // 1) Mint a presigned upload URL.
        const uu = await api.request<{ data?: UploadUrlResponse; error?: { message?: string } }>(
          'POST',
          `/api/v1/orders/${orderId}/files/upload-url`,
          { body: { filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size } },
        );
        const u = uu.data?.data;
        if (!u?.uploadUrl) {
          throw new Error(uu.data?.error?.message ?? 'Could not mint upload URL');
        }

        // 2) PUT the bytes to the presigned URL (relative path) with progress.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
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
          xhr.onabort = () => reject(new Error('Upload aborted.'));
          xhr.send(file);
        });

        // 3) Confirm via POST /files → server parses page count.
        const cf = await api.request<{ data?: ConfirmFileResponse; error?: { message?: string } }>(
          'POST',
          `/api/v1/orders/${orderId}/files`,
          { body: { fileId: u.fileId, storageKey: u.storageKey, filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size } },
        );
        const c = cf.data?.data;
        if (!c?.fileId) {
          throw new Error(cf.data?.error?.message ?? 'File confirmation failed');
        }

        // 4) Replace placeholder with the real file.
        const needsReview = c.needsReview;
        const finalStatus: LocalFile['status'] = needsReview ? 'needs_review' : 'uploaded';
        setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? {
          ...f,
          fileId: c.fileId,
          pageCount: c.pageCount ?? 0,
          status: finalStatus,
          uploadProgress: 100,
          dirty: false,
        } : f));

        // 5) Auto-PATCH the default settings so the server prices the file.
        if (!needsReview) {
          const def = { copies: 1, colorMode: 'bw' as ColorMode, paperSize: 'a4' as PaperSize, duplex: false };
          const pr = await api.request<{ data?: PatchFileResponse; error?: { message?: string } }>(
            'PATCH',
            `/api/v1/orders/${orderId}/files/${c.fileId}`,
            { body: def },
          );
          const d = pr.data?.data;
          if (d) {
            setFiles((prev) => prev.map((f) => f.fileId === c.fileId ? {
              ...f,
              copies: d.file.copies,
              colorMode: d.file.colorMode,
              paperSize: d.file.paperSize,
              duplex: d.file.duplex,
              pricePaise: d.file.pricePaise,
              dirty: false,
            } : f));
            setOrderTotalPaise(d.orderTotalPaise);
            setServerCalculated(true);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed.';
        setFiles((prev) => prev.map((f) => f.fileId === placeholderId ? { ...f, status: 'failed', uploadError: msg } : f));
        setUploadError(msg);
      }
    }
  }, [api, orderId]);

  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
    // The API has no delete-file endpoint; the file is left out of the priced set.
  }, []);

  // ─── File settings update ───
  const updateFile = useCallback(async (fileId: string, patch: Partial<LocalFile>) => {
    setFiles((prev) => prev.map((f) => {
      if (f.fileId !== fileId) return f;
      return { ...f, ...patch, dirty: true };
    }));

    // If the file hasn't been confirmed yet, defer PATCH.
    const f = files.find((x) => x.fileId === fileId);
    if (!f || f.status === 'uploading' || f.status === 'failed' || f.status === 'needs_review') return;

    // PATCH the patch to the server. The server recalculates the price.
    setFiles((prev) => prev.map((x) => x.fileId === fileId ? { ...x, patching: true } : x));
    const body: Record<string, unknown> = {};
    if (patch.copies !== undefined) body.copies = patch.copies;
    if (patch.colorMode !== undefined) body.colorMode = patch.colorMode;
    if (patch.paperSize !== undefined) body.paperSize = patch.paperSize;
    if (patch.duplex !== undefined) body.duplex = patch.duplex;
    if (patch.pageRange !== undefined) body.pageRange = patch.pageRange === '' ? null : patch.pageRange;

    const r = await api.request<{ data?: PatchFileResponse; error?: { message?: string } }>(
      'PATCH',
      `/api/v1/orders/${orderId}/files/${fileId}`,
      { body },
    );
    const d = r.data?.data;
    setFiles((prev) => prev.map((x) => {
      if (x.fileId !== fileId) return x;
      if (!d) return { ...x, patching: false };
      return {
        ...x,
        copies: d.file.copies,
        colorMode: d.file.colorMode,
        paperSize: d.file.paperSize,
        duplex: d.file.duplex,
        pricePaise: d.file.pricePaise,
        dirty: false,
        patching: false,
      };
    }));
    if (d) {
      setOrderTotalPaise(d.orderTotalPaise);
      setServerCalculated(true);
    }
  }, [api, orderId, files]);

  // ─── Checkout ───
  const doCheckout = useCallback(async () => {
    setBusy(true);
    setCheckoutError(null);
    setQrDataUrl(null);
    const r = await api.request<{ data?: CheckoutResponse; error?: { message?: string } }>('POST', `/api/v1/orders/${orderId}/checkout`);
    setBusy(false);
    if (r.status >= 400 || !r.data?.data) {
      setCheckoutError(r.data?.error?.message ?? 'Checkout failed. Make sure all files have settings applied.');
      return;
    }
    setCheckout(r.data.data);
    // Render a QR from the upiUri (if present) for desktop scanning.
    const payload = r.data.data.upiUri ?? r.data.data.qrPayload;
    if (payload) {
      const qr = await api.request<{ data?: { pngDataUrl?: string }; error?: { message?: string } }>('GET', `/api/v1/qr?data=${encodeURIComponent(payload)}`);
      if (qr.data?.data?.pngDataUrl) setQrDataUrl(qr.data.data.pngDataUrl);
    }
    setStep('pay');
  }, [api, orderId]);

  // ─── Pay (dev simulate) ───
  const doPay = useCallback(async () => {
    if (!checkout) return;
    setBusy(true);
    setPaymentError(null);
    const r = await api.request<{ data?: SimulateResponse; error?: { message?: string } }>('POST', '/api/v1/payments/dev/phonepe/simulate', {
      body: { orderId, merchantOrderId: checkout.merchantOrderId, outcome: 'paid' },
    });
    setBusy(false);
    const d = r.data?.data;
    if (r.status >= 400 || !d || !d.processed.applied) {
      setPaymentError(d?.processed?.summary ?? r.data?.error?.message ?? 'Payment simulation failed.');
      return;
    }
    setSimulated(true);
    setStep('track');
    // Pull the fresh status immediately.
    void loadOrder({ silent: true });
  }, [api, orderId, checkout, loadOrder]);

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
    const id = setInterval(() => { void loadOrder({ silent: true }); }, 2500);
    return () => clearInterval(id);
  }, [step, order, loadOrder]);

  // ─── Receipt download ───
  const downloadReceipt = useCallback(async () => {
    const r = await api.request('GET', `/api/v1/orders/${orderId}/receipt`, { raw: 'bytes' });
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
  }, [api, orderId]);

  // ─── Render ───
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Order</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">{orderId.slice(0, 8)}</code>
            {order?.customerToken && (
              <Badge variant="secondary" className="ml-1 font-mono">{order.customerToken}</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : fatalError ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex flex-col items-start gap-3 p-6">
                <div className="flex items-center gap-2 text-destructive">
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
              {/* Stepper */}
              <OrderStepper current={step} />

              {/* Payment notice — always visible until payment */}
              {step !== 'track' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Demo payment — no real money is charged.</p>
                      <p className="mt-0.5 text-amber-800">
                        {'This portal is a sandbox. The Pay step simulates a UPI webhook using the dev PhonePe simulator. No money leaves your account.'}
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
                  onCheckout={() => setStep('checkout')}
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

      <footer className="mt-auto border-t border-border bg-card">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{'PrintShop SaaS · 0% commission · files auto-delete on collection'}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
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
    <ol className="flex items-center justify-between gap-1" aria-label="Order progress">
      {STEP_LABELS.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${done ? 'bg-emerald-600 text-white' : active ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'}`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-[10px] sm:text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
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
  onConfigure: () => void;
  onCheckout: () => void;
  uploadError: string | null;
}) {
  const readyFiles = props.files.filter((f) => f.status !== 'uploading' && f.status !== 'failed');
  const hasUploading = props.files.some((f) => f.status === 'uploading');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UploadCloud className="h-5 w-5 text-amber-600" /> Step 1 · Upload your files
          </CardTitle>
          <CardDescription>PDFs, JPG, PNG, or Word docs up to 25MB each.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${props.dragOver ? 'border-amber-500 bg-amber-50' : 'border-border'}`}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-foreground">Drag files here, or</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => props.fileInputRef.current?.click()}
            >
              Browse files
            </Button>
            <input
              ref={props.fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,image/jpeg,image/png,application/pdf"
              multiple
              className="hidden"
              onChange={props.onPick}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">Max 25MB per file.</p>
          </div>
          {props.uploadError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.uploadError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File list */}
      {props.files.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">No files uploaded yet</p>
            <p className="text-sm text-muted-foreground">Add at least one file to continue.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {props.files.map((f) => (
            <FileCard key={f.fileId} file={f} shop={null} onUpdate={props.onUpdate} onRemove={props.onRemove} />
          ))}
        </div>
      )}

      {/* Sticky summary + next */}
      <div className="flex flex-col items-stretch gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Estimated total</p>
          <p className="text-2xl font-bold text-foreground">{formatINRFromPaise(props.orderTotal)}</p>
          <p className="text-[11px] text-muted-foreground">
            {props.serverCalculated
              ? 'Server-confirmed total · may change if you adjust settings.'
              : props.hasShop
                ? 'Client estimate · server recalculates at checkout.'
                : 'Will be set when you upload your first file.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onCheckout} disabled={readyFiles.length === 0 || hasUploading}>
            Skip to checkout <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={props.onConfigure} disabled={readyFiles.length === 0 || hasUploading}>
            Configure files <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-amber-600" /> Step 2 · Configure print settings
          </CardTitle>
          <CardDescription>
            Set copies, colour, paper, and duplex per file. The price updates live using the shop&apos;s pricing engine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {props.files.map((f) => (
              <FileCard key={f.fileId} file={f} shop={props.shop} onUpdate={props.onUpdate} onRemove={() => {}} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col items-stretch gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {props.serverCalculated ? 'Server-confirmed total' : 'Estimated total'}
          </p>
          <p className="text-2xl font-bold text-foreground">{formatINRFromPaise(props.orderTotal)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" onClick={props.onCheckout}>
            Review &amp; checkout <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
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
  const priced = props.files.filter((f) => f.status === 'uploaded' || f.status === 'needs_review');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5 text-amber-600" /> Step 3 · Review &amp; checkout
          </CardTitle>
          <CardDescription>The server recalculates the final price at checkout. We never trust the client&apos;s number.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">File</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Settings</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {priced.map((f) => (
                  <tr key={f.fileId}>
                    <td className="px-3 py-2 text-foreground">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.filename}</span>
                      </div>
                      <span className="ml-6 text-[11px] text-muted-foreground">{f.pageCount} pages</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {f.copies}× · {f.colorMode === 'bw' ? 'B&W' : 'Colour'} · {f.paperSize.toUpperCase()}
                      {f.duplex ? ' · duplex' : ''}
                      {f.pageRange ? ` · ${f.pageRange}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">{formatINRFromPaise(f.pricePaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40">
                  <td className="px-3 py-2 font-medium text-foreground" colSpan={2}>Server-confirmed total</td>
                  <td className="px-3 py-2 text-right font-bold text-foreground">{formatINRFromPaise(props.orderTotalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {props.shop && (
            <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm">
              <p className="flex items-center gap-2 text-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Pay to <strong className="font-mono">{props.shop.upiId}</strong> · {props.shop.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {'Provider: '}{props.shop.paymentProvider}{'. The shopkeeper receives money directly — zero commission.'}
              </p>
            </div>
          )}

          {props.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between gap-2">
          <Button variant="outline" size="sm" onClick={props.onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" onClick={props.onCheckout} disabled={props.busy || priced.length === 0}>
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
  busy: boolean;
  error: string | null;
  simulated: boolean;
  onPay: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="border-amber-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-amber-600" /> Step 4 · Pay
          </CardTitle>
          <CardDescription>Scan the QR with any UPI app to pay the shopkeeper directly.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Amount */}
            <div className="flex flex-col items-center justify-center text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount to pay</p>
              <p className="mt-1 text-4xl font-bold text-foreground">
                {props.checkout ? formatINRFromPaise(props.checkout.amountPaise) : '—'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">direct to shopkeeper&apos;s UPI · 0% commission</p>
              {props.checkout?.merchantOrderId && (
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Merchant ref: <code className="font-mono">{props.checkout.merchantOrderId.slice(0, 8)}…</code>
                </p>
              )}
            </div>

            {/* QR */}
            <div className="flex flex-col items-center justify-center">
              {props.qrDataUrl ? (
                <div className="rounded-lg bg-white p-2 ring-1 ring-border">
                  <img src={props.qrDataUrl} alt="UPI payment QR code" className="h-44 w-44" />
                </div>
              ) : props.checkout ? (
                <div className="flex h-44 w-44 items-center justify-center rounded-lg bg-muted/60">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                  No QR
                </div>
              )}
              {props.checkout?.upiUri && (
                <a href={props.checkout.upiUri} className="mt-2 inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                  Open in UPI app
                </a>
              )}
            </div>
          </div>

          {/* Demo notice — prominent */}
          <div className="mt-4 rounded-lg border border-amber-400 bg-amber-100 p-3 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Demo payment — no real money is charged.</p>
                <p className="mt-0.5 text-amber-800">
                  {'Click "I\'ve paid" below to simulate the PhonePe paid webhook. The order flips to "paid" and printing is queued. In production, a real UPI payment triggers this automatically.'}
                </p>
              </div>
            </div>
          </div>

          {props.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between gap-2">
          <Button variant="outline" size="sm" onClick={props.onBack} disabled={props.busy}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" onClick={props.onPay} disabled={props.busy || !props.checkout || props.simulated}>
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {props.simulated ? 'Paid — tracking…' : 'I\'ve paid — track my order'}
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : cancelled ? <XCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin text-amber-600" />}
            Step 5 · Track your order
          </CardTitle>
          <CardDescription>Refreshed automatically every 2.5 seconds while printing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Confirmation */}
          <div className="rounded-lg bg-muted/60 p-4 text-center">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your token</p>
            <p className="font-mono text-4xl font-bold tracking-widest text-amber-600">{props.order.customerToken}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Show this at the counter.</p>
          </div>

          {/* Status banner */}
          <div className={`rounded-xl p-4 text-center ${done ? 'bg-emerald-50 ring-1 ring-emerald-200' : cancelled ? 'bg-destructive/5 ring-1 ring-destructive/30' : 'bg-amber-50 ring-1 ring-amber-200'}`}>
            {done ? <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /> : cancelled ? <XCircle className="mx-auto h-8 w-8 text-destructive" /> : <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-600" />}
            <p className={`mt-1 text-sm font-semibold ${done ? 'text-emerald-700' : cancelled ? 'text-destructive' : 'text-amber-800'}`}>
              {statusLabel(s)}
            </p>
            <p className="text-[10px] text-muted-foreground">status: {s}</p>
          </div>

          {/* Order ID + amount */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Order ID</p>
              <p className="mt-0.5 font-mono text-xs text-foreground">{props.order.orderId.slice(0, 8)}…</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">{formatINRFromPaise(props.order.totalAmountPaise)}</p>
            </div>
          </div>

          {/* Files table */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Files</p>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
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
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{props.trackError}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" size="sm" onClick={props.onRefresh}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <div className="flex flex-wrap gap-2">
            {done && (
              <Button variant="outline" size="sm" onClick={props.onDownloadReceipt}>
                <Download className="h-4 w-4" /> Download receipt
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/"><Home className="h-4 w-4" /> Back to home</Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function FileStatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: 'Pending', variant: 'secondary' },
    queued: { label: 'Queued', variant: 'secondary' },
    printing: { label: 'Printing', variant: 'default' },
    completed: { label: 'Completed', variant: 'default' },
    failed: { label: 'Failed', variant: 'destructive' },
    needs_review: { label: 'Needs review', variant: 'outline' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function FileCard(props: {
  file: LocalFile;
  shop: ShopInfo | null;
  onUpdate: (fileId: string, patch: Partial<LocalFile>) => void;
  onRemove: (fileId: string) => void;
}) {
  const { file: f } = props;
  const isUploading = f.status === 'uploading';
  const isFailed = f.status === 'failed';
  const isReview = f.status === 'needs_review';

  return (
    <Card className={isFailed ? 'border-destructive/50' : isReview ? 'border-amber-400' : 'border-border'}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{f.filename}</p>
              <p className="text-[11px] text-muted-foreground">
                {f.pageCount > 0 ? `${f.pageCount} pages · ` : ''}{f.size > 0 ? `${(f.size / 1024).toFixed(0)} KB` : '—'}
              </p>
              {isReview && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Needs shopkeeper review — settings may be locked until the shopkeeper sets a page count.
                </p>
              )}
              {isFailed && f.uploadError && (
                <p className="mt-1 text-[11px] text-destructive">{f.uploadError}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {f.patching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={() => props.onRemove(f.fileId)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-rose-600"
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
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{f.uploadProgress}%</p>
          </div>
        )}

        {/* Settings — only for uploaded files */}
        {!isUploading && !isFailed && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-[10px] text-muted-foreground">Copies</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={f.copies}
                onChange={(e) => props.onUpdate(f.fileId, { copies: Math.max(1, Number(e.target.value) || 1) })}
                disabled={isReview}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Colour</Label>
              <ToggleGroup
                type="single"
                value={f.colorMode}
                onValueChange={(v) => v && props.onUpdate(f.fileId, { colorMode: v as ColorMode })}
                disabled={isReview}
                className="h-8"
              >
                <ToggleGroupItem value="bw" className="h-8 px-2 text-[11px]">B&W</ToggleGroupItem>
                <ToggleGroupItem value="color" className="h-8 px-2 text-[11px]">Color</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Paper</Label>
              <ToggleGroup
                type="single"
                value={f.paperSize}
                onValueChange={(v) => v && props.onUpdate(f.fileId, { paperSize: v as PaperSize })}
                disabled={isReview}
                className="h-8"
              >
                <ToggleGroupItem value="a4" className="h-8 px-2 text-[11px]">A4</ToggleGroupItem>
                <ToggleGroupItem value="a3" className="h-8 px-2 text-[11px]">A3</ToggleGroupItem>
                <ToggleGroupItem value="letter" className="h-8 px-2 text-[11px]">LTR</ToggleGroupItem>
                <ToggleGroupItem value="legal" className="h-8 px-2 text-[11px]">LGL</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Duplex</Label>
              <div className="flex h-8 items-center">
                <Switch
                  checked={f.duplex}
                  onCheckedChange={(v) => props.onUpdate(f.fileId, { duplex: v })}
                  disabled={isReview}
                />
                <span className="ml-2 text-[11px] text-muted-foreground">{f.duplex ? 'On' : 'Off'}</span>
              </div>
            </div>
            <div className="sm:col-span-4">
              <Label className="text-[10px] text-muted-foreground">Page range (optional)</Label>
              <Input
                type="text"
                value={f.pageRange}
                onChange={(e) => props.onUpdate(f.fileId, { pageRange: e.target.value })}
                placeholder={'e.g. 1-5, 8, 12-14 — leave blank to print all'}
                disabled={isReview}
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}

        {!isUploading && !isFailed && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {f.dirty ? 'Unsaved — applying…' : f.patching ? 'Saving…' : 'Saved'}
            </span>
            <span className="text-sm font-semibold text-foreground">{formatINRFromPaise(displayPriceForFile(f, props.shop))}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Live client-side price (or last-known server price) for a single file card.
function displayPriceForFile(f: LocalFile, shop: ShopInfo | null): number {
  if (!shop) return f.pricePaise;
  if (!f.dirty) return f.pricePaise;
  try {
    const input: PricingInput = {
      pages: f.pageCount || 1,
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
}
