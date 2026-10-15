'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Server, Play, FileUp, CreditCard, Printer, CheckCircle2, Loader2 } from 'lucide-react';
import { useApiClient } from './use-api-client';
import { ResponseConsole } from './response-console';
import { formatINRFromPaise } from '@platform/utils';

interface ShopMe {
  id: string; name: string; slug: string; upiId: string; pricingConfig: { bw_a4_per_page: number; color_a4_per_page: number };
}
interface OrderDetail {
  id: string; customerToken: string; status: string; totalAmountPaise: number; files: { id: string; originalFilename: string; status: string; copies: number; colorMode: string; duplex: boolean; pricePaise: number }[];
}

export function BackendExplorer() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopMe | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [token, setOrderToken] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [checkout, setCheckout] = useState<{ upiUri?: string; pngDataUrl?: string } | null>(null);
  const [analytics, setAnalytics] = useState<{ revenue?: { formatted?: string }; orderCount?: { total?: number } } | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);

  // Print settings
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<'bw' | 'color'>('bw');
  const [duplex, setDuplex] = useState(false);

  const [phone, setPhone] = useState('');

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  // Boot: seed + login + load shop.
  useEffect(() => {
    void (async () => {
      await run('boot', async () => {
        await api.request('POST', '/api/v1/dev/seed');
        const loginRes = await api.request<{ data?: { accessToken?: string } }>('POST', '/api/v1/auth/login', {
          body: { email: 'owner@quickprint.demo', password: 'demo1234' },
        });
        if (loginRes.data?.data?.accessToken) {
          api.setToken(loginRes.data.data.accessToken);
        }
      });
    })();
  }, []);

  // After token lands, load the shop.
  useEffect(() => {
    if (api.token && !shop) {
      void api.request<{ data?: ShopMe }>('GET', '/api/v1/shops/me').then((r) => {
        if (r.data?.data) setShop(r.data.data);
      });
    }
  }, [api.token]);

  const refreshOrder = async (id: string) => {
    const r = await api.request<{ data?: OrderDetail }>('GET', `/api/v1/shops/me/orders/${id}`);
    if (r.data?.data) setOrder(r.data.data);
    const s = await api.request<{ data?: { status?: string } }>('GET', `/api/v1/orders/${id}/status`);
    setStatus(s.data?.data?.status ?? 'unknown');
  };

  const stepCreateOrder = () => run('create', async () => {
    setCheckout(null); setOrder(null); setFileId(null); setStatus('idle');
    const r = await api.request<{ data?: { orderId?: string; customerToken?: string } }>('POST', '/api/v1/shops/quickprint/orders', { body: { customerPhone: phone || undefined } });
    if (r.data?.data?.orderId) {
      setOrderId(r.data.data.orderId);
      setOrderToken(r.data.data.customerToken ?? null);
      await refreshOrder(r.data.data.orderId);
    }
  });

  const stepUpload = (file: File) => run('upload', async () => {
    if (!orderId) return;
    const urlR = await api.request<{ data?: { fileId?: string; storageKey?: string; uploadUrl?: string } }>('POST', `/api/v1/orders/${orderId}/files/upload-url`, { body: { filename: file.name, mimeType: file.type || 'application/pdf', size: file.size } });
    const u = urlR.data?.data;
    if (!u?.uploadUrl) return;
    // PUT the bytes directly to storage (relative URL → gateway).
    await fetch(u.uploadUrl, { method: 'PUT', body: file });
    const cR = await api.request<{ data?: { fileId?: string; pageCount?: number } }>('POST', `/api/v1/orders/${orderId}/files`, { body: { fileId: u.fileId, storageKey: u.storageKey, filename: file.name, mimeType: file.type || 'application/pdf', size: file.size } });
    setFileId(cR.data?.data?.fileId ?? null);
    await refreshOrder(orderId);
  });

  const stepSettings = () => run('settings', async () => {
    if (!orderId || !fileId) return;
    await api.request('PATCH', `/api/v1/orders/${orderId}/files/${fileId}`, { body: { copies, colorMode, paperSize: 'a4', duplex } });
    await refreshOrder(orderId);
  });

  const stepCheckout = () => run('checkout', async () => {
    if (!orderId) return;
    const r = await api.request<{ data?: { upiUri?: string; qrPayload?: string } }>('POST', `/api/v1/orders/${orderId}/checkout`);
    setCheckout({ upiUri: r.data?.data?.upiUri });
    await refreshOrder(orderId);
  });

  const stepMarkPaid = () => run('paid', async () => {
    if (!orderId) return;
    await api.request('POST', `/api/v1/dev/orders/${orderId}/mark-paid`, { body: {} });
    await refreshOrder(orderId);
  });

  const stepPrint = () => run('print', async () => {
    if (!orderId) return;
    await api.request('POST', `/api/v1/shops/me/orders/${orderId}/print`);
    await refreshOrder(orderId);
    // Poll until ready/collected (the queue handler simulates ~1.5s/file).
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 800));
      await refreshOrder(orderId);
      if (status === 'ready' || order?.status === 'ready') break;
    }
  });

  const stepComplete = () => run('complete', async () => {
    if (!orderId) return;
    await api.request('POST', `/api/v1/shops/me/orders/${orderId}/complete`);
    await refreshOrder(orderId);
  });

  const stepAnalytics = () => run('analytics', async () => {
    const r = await api.request<{ data?: typeof analytics }>('GET', '/api/v1/shops/me/analytics');
    setAnalytics(r.data?.data ?? null);
    const qr = await api.request<{ data?: { pngDataUrl?: string } }>('GET', '/api/v1/shops/me/qr?format=png');
    setQrPng(qr.data?.data?.pngDataUrl ?? null);
  });

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <Server className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Phase 2 — backend, live</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Every button below calls a real <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/api/v1/*</code> route
        handler backed by the composition-root adapters, the repository layer, and the pricing engine. Seeded the demo shop and
        logged in as <code className="font-mono text-xs">owner@quickprint.demo</code> on mount — drive the full lifecycle: order → upload → price → checkout → pay → print → collect.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={api.token ? 'default' : 'secondary'} className={api.token ? 'bg-emerald-600 text-white' : ''}>
          {api.token ? '✓ auth token acquired' : '… booting'}
        </Badge>
        {shop && (
          <Badge variant="outline" className="font-mono">
            {shop.name} · UPI {shop.upiId}
          </Badge>
        )}
        {order && (
          <Badge variant="outline" className="font-mono">
            order {order.customerToken} · {order.status} · {order.totalAmountPaise ? formatINRFromPaise(order.totalAmountPaise) : '—'}
          </Badge>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Step 1: create order */}
        <StepCard n={1} icon={Play} title="Create draft order" busy={busy === 'create'} disabled={!shop}>
          <Input placeholder="Customer phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button onClick={stepCreateOrder} disabled={!shop || busy === 'create'} className="w-full">POST /shops/quickprint/orders</Button>
          {token && <p className="text-xs text-muted-foreground">Token: <code className="font-mono">{token}</code></p>}
        </StepCard>

        {/* Step 2: upload */}
        <StepCard n={2} icon={FileUp} title="Upload a file" busy={busy === 'upload'} disabled={!orderId}>
          <Label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">Pick a PDF (any size &lt; 25MB)</span>
            <Input
              type="file"
              accept=".pdf,application/pdf"
              disabled={!orderId || busy === 'upload'}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void stepUpload(f); }}
            />
          </Label>
          <p className="text-xs text-muted-foreground">upload-url → PUT → confirm parses page count via pdf-lib.</p>
        </StepCard>

        {/* Step 3: settings */}
        <StepCard n={3} icon={Server} title="Print settings" busy={busy === 'settings'} disabled={!fileId}>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Copies</Label>
            <Input type="number" min={1} max={500} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} className="w-20" />
          </div>
          <ToggleGroup type="single" value={colorMode} onValueChange={(v) => v && setColorMode(v as 'bw' | 'color')}>
            <ToggleGroupItem value="bw" className="flex-1">B&W</ToggleGroupItem>
            <ToggleGroupItem value="color" className="flex-1">Colour</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Duplex</Label>
            <Switch checked={duplex} onCheckedChange={setDuplex} />
          </div>
          <Button onClick={stepSettings} disabled={!fileId || busy === 'settings'} className="w-full">PATCH file → reprice</Button>
          {order?.files?.[0] && (
            <p className="text-xs text-muted-foreground">
              file price: <strong className="text-foreground">{formatINRFromPaise(order.files[0].pricePaise)}</strong>
            </p>
          )}
        </StepCard>

        {/* Step 4: checkout */}
        <StepCard n={4} icon={CreditCard} title="Checkout (UPI)" busy={busy === 'checkout'} disabled={!fileId}>
          <Button onClick={stepCheckout} disabled={!fileId || busy === 'checkout'} className="w-full">POST /orders/:id/checkout</Button>
          {checkout?.upiUri && (
            <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[10px]">{checkout.upiUri}</code>
          )}
        </StepCard>

        {/* Step 5: mark paid */}
        <StepCard n={5} icon={CreditCard} title="Confirm payment" busy={busy === 'paid'} disabled={!orderId}>
          <Button onClick={stepMarkPaid} disabled={!orderId || busy === 'paid'} className="w-full">POST /dev/orders/:id/mark-paid</Button>
          <p className="text-xs text-amber-700">dev-only: simulates the PhonePe webhook (Phase 3).</p>
        </StepCard>

        {/* Step 6: print */}
        <StepCard n={6} icon={Printer} title="Dispatch to print agent" busy={busy === 'print'} disabled={!orderId}>
          <Button onClick={stepPrint} disabled={!orderId || busy === 'print'} className="w-full">POST /shops/me/orders/:id/print</Button>
          <p className="text-xs text-muted-foreground">queue handler simulates printing → ready.</p>
        </StepCard>

        {/* Step 7: complete */}
        <StepCard n={7} icon={CheckCircle2} title="Mark collected" busy={busy === 'complete'} disabled={!orderId}>
          <Button onClick={stepComplete} disabled={!orderId || busy === 'complete'} className="w-full">POST /shops/me/orders/:id/complete</Button>
          <p className="text-xs text-muted-foreground">privacy: files deleted from storage.</p>
        </StepCard>

        {/* Step 8: analytics + qr */}
        <StepCard n={8} icon={Server} title="Analytics + QR" busy={busy === 'analytics'} disabled={!shop}>
          <Button onClick={stepAnalytics} disabled={!shop || busy === 'analytics'} className="w-full">GET analytics + QR</Button>
          {analytics?.revenue?.formatted && (
            <p className="text-xs text-muted-foreground">Revenue: <strong className="text-foreground">{analytics.revenue.formatted}</strong> · orders: {analytics.orderCount?.total}</p>
          )}
          {qrPng && <img src={qrPng} alt="Shop QR" className="mx-auto w-24" />}
        </StepCard>
      </div>

      <div className="mt-6">
        <ResponseConsole log={api.log} />
      </div>

      {/* order detail table */}
      {order && (
        <Card className="mt-6 border-border">
          <CardHeader className="pb-2"><CardTitle className="text-base">Order detail (from GET /shops/me/orders/:id)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground"><tr>
                <th className="py-1.5">File</th><th>Status</th><th>Copies</th><th>Mode</th><th>Duplex</th><th>Price</th>
              </tr></thead>
              <tbody>
                {order.files.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{f.originalFilename}</td>
                    <td><Badge variant="outline">{f.status}</Badge></td>
                    <td>{f.copies}</td><td className="uppercase">{f.colorMode}</td><td>{f.duplex ? 'yes' : 'no'}</td>
                    <td className="font-mono">{formatINRFromPaise(f.pricePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function StepCard(props: { n: number; icon: typeof Server; title: string; busy: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Card className={`border-border transition-opacity ${props.disabled ? 'opacity-50' : ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><props.icon className="h-4 w-4 text-amber-600" />{props.title}</span>
          <Badge variant="outline" className="font-mono text-[10px]">step {props.n}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {props.busy ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> running…</div>
        ) : (
          props.children
        )}
      </CardContent>
    </Card>
  );
}
